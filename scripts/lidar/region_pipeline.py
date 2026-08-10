"""Configuration and preparation helpers for regional LiDAR datasets."""

from __future__ import annotations

import json
import math
import subprocess
import urllib.parse
import urllib.request
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Callable, Iterable

import numpy as np
from pyproj import Transformer


GEO_API_BASE = "https://geo.api.gouv.fr"
DEFAULT_SEARCH_START_UTC = "2026-08-01T00:00:00.000Z"


@dataclass(frozen=True)
class RegionDefinition:
    id: str
    label: str
    dataset_version: str
    boundary: dict[str, Any]
    resolution_meters: float = 5.0
    min_zoom: int = 8
    max_zoom: int = 15
    chunk_size: int = 2_000
    search_start_utc: str = DEFAULT_SEARCH_START_UTC
    observer_height_meters: float = 1.7
    model_margin_degrees: float = 0.5
    deck_correction: bool = False
    attribution: str = "© IGN — LiDAR HD, MNS Correl et RGE ALTI · Licence Ouverte 2.0"
    source_notes: str | None = None
    halo: dict[str, Any] | None = None


@dataclass(frozen=True)
class RegionCentroid:
    longitude: float
    latitude: float


@dataclass(frozen=True)
class EclipseGeometry:
    search_start_utc: str
    kind: str
    obscuration: float
    partial_begin_utc: str
    maximum_utc: str
    partial_end_utc: str
    sun_azimuth_degrees: float
    sun_apparent_altitude_degrees: float
    sun_angular_radius_degrees: float


@dataclass(frozen=True)
class HaloDefinition:
    strategy: str
    sunward_meters: float
    lateral_meters: float
    relief_range_meters: float | None
    vertical_budget_meters: float | None
    conservative_altitude_degrees: float
    capped: bool


def write_json_atomic(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(f"{path.suffix}.tmp")
    temporary.write_text(
        json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    temporary.replace(path)


def load_region_definition(path: Path) -> RegionDefinition:
    raw = json.loads(path.read_text(encoding="utf-8"))
    boundary = dict(raw["boundary"])
    if boundary.get("type") == "file":
        source = Path(str(boundary["path"]))
        if not source.is_absolute():
            boundary["path"] = str((path.parent / source).resolve())
    return RegionDefinition(
        id=str(raw["id"]),
        label=str(raw["label"]),
        dataset_version=str(raw["datasetVersion"]),
        boundary=boundary,
        resolution_meters=float(raw.get("resolutionMeters", 5.0)),
        min_zoom=int(raw.get("minZoom", 8)),
        max_zoom=int(raw.get("maxZoom", 15)),
        chunk_size=int(raw.get("chunkSize", 2_000)),
        search_start_utc=str(raw.get("searchStartUtc", DEFAULT_SEARCH_START_UTC)),
        observer_height_meters=float(raw.get("observerHeightMeters", 1.7)),
        model_margin_degrees=float(raw.get("modelMarginDegrees", 0.5)),
        deck_correction=bool(raw.get("deckCorrection", False)),
        attribution=str(
            raw.get(
                "attribution",
                "© IGN — LiDAR HD, MNS Correl et RGE ALTI · Licence Ouverte 2.0",
            )
        ),
        source_notes=raw.get("sourceNotes"),
        halo=dict(raw.get("halo", {})),
    )


def official_boundary_url(level: str, code: str) -> str:
    parameters = urllib.parse.urlencode({"format": "geojson", "geometry": "contour"})
    if level == "commune":
        return f"{GEO_API_BASE}/communes/{code}?{parameters}"
    if level == "department":
        return f"{GEO_API_BASE}/departements/{code}/communes?{parameters}"
    if level == "region":
        query = urllib.parse.urlencode(
            {"codeRegion": code, "format": "geojson", "geometry": "contour"}
        )
        return f"{GEO_API_BASE}/communes?{query}"
    raise ValueError("Official boundary level must be commune, department, or region")


def boundary_source_url(specification: dict[str, Any]) -> str | None:
    kind = specification.get("type", "official")
    if kind == "official":
        return official_boundary_url(str(specification["level"]), str(specification["code"]))
    if kind == "url":
        return str(specification["url"])
    if kind == "file":
        return None
    raise ValueError(f"Unsupported boundary type: {kind}")


def fetch_json(url: str, timeout: int = 120) -> dict[str, Any]:
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "eclipse-2026-lidar-pipeline/2.0"},
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def load_or_fetch_boundary(
    definition: RegionDefinition,
    cache_path: Path,
    *,
    fetcher: Callable[[str], dict[str, Any]] = fetch_json,
) -> dict[str, Any]:
    if cache_path.exists():
        value = json.loads(cache_path.read_text(encoding="utf-8"))
    elif definition.boundary.get("type") == "file":
        source = Path(str(definition.boundary["path"]))
        value = json.loads(source.read_text(encoding="utf-8"))
        write_json_atomic(cache_path, value)
    else:
        url = boundary_source_url(definition.boundary)
        assert url is not None
        value = fetcher(url)
        write_json_atomic(cache_path, value)
    # Validate eagerly; an API error JSON must never become an empty raster.
    if not list(polygon_features(value)):
        raise ValueError("Boundary contains no Polygon or MultiPolygon feature")
    return value


def polygon_features(value: dict[str, Any]) -> Iterable[dict[str, Any]]:
    value_type = value.get("type")
    if value_type == "FeatureCollection":
        for feature in value.get("features", []):
            if feature.get("geometry", {}).get("type") in ("Polygon", "MultiPolygon"):
                yield feature
        return
    if value_type == "Feature":
        if value.get("geometry", {}).get("type") in ("Polygon", "MultiPolygon"):
            yield value
        return
    if value_type in ("Polygon", "MultiPolygon"):
        yield {"type": "Feature", "properties": {}, "geometry": value}


def polygon_groups(value: dict[str, Any]) -> Iterable[list[list[list[float]]]]:
    for feature in polygon_features(value):
        geometry = feature["geometry"]
        if geometry["type"] == "Polygon":
            yield geometry["coordinates"]
        else:
            yield from geometry["coordinates"]


def projected_polygon_groups(
    value: dict[str, Any], transformer: Transformer
) -> list[list[list[tuple[float, float]]]]:
    return [
        [
            [transformer.transform(float(point[0]), float(point[1])) for point in ring]
            for ring in polygon
        ]
        for polygon in polygon_groups(value)
    ]


def _ring_area_centroid(ring: list[tuple[float, float]]) -> tuple[float, float, float]:
    if len(ring) < 3:
        return 0.0, 0.0, 0.0
    twice_area = 0.0
    x_sum = 0.0
    y_sum = 0.0
    for first, second in zip(ring, ring[1:] + ring[:1]):
        cross = first[0] * second[1] - second[0] * first[1]
        twice_area += cross
        x_sum += (first[0] + second[0]) * cross
        y_sum += (first[1] + second[1]) * cross
    if abs(twice_area) < 1e-9:
        return 0.0, 0.0, 0.0
    return twice_area / 2, x_sum / (3 * twice_area), y_sum / (3 * twice_area)


def boundary_centroid(value: dict[str, Any]) -> RegionCentroid:
    to_lambert = Transformer.from_crs("EPSG:4326", "EPSG:2154", always_xy=True)
    to_wgs84 = Transformer.from_crs("EPSG:2154", "EPSG:4326", always_xy=True)
    weighted_x = 0.0
    weighted_y = 0.0
    total_weight = 0.0
    for polygon in projected_polygon_groups(value, to_lambert):
        for index, ring in enumerate(polygon):
            area, x, y = _ring_area_centroid(ring)
            weight = abs(area) * (1 if index == 0 else -1)
            if weight > 0 or (index > 0 and weight < 0):
                weighted_x += x * weight
                weighted_y += y * weight
                total_weight += weight
    if total_weight <= 0:
        points = [point for polygon in projected_polygon_groups(value, to_lambert) for ring in polygon for point in ring]
        if not points:
            raise ValueError("Cannot calculate centroid of an empty boundary")
        x = sum(point[0] for point in points) / len(points)
        y = sum(point[1] for point in points) / len(points)
    else:
        x = weighted_x / total_weight
        y = weighted_y / total_weight
    longitude, latitude = to_wgs84.transform(x, y)
    return RegionCentroid(longitude=longitude, latitude=latitude)


def calculate_eclipse_geometry(
    centroid: RegionCentroid,
    search_start_utc: str,
    *,
    helper_path: Path | None = None,
    node_binary: str = "node",
) -> EclipseGeometry:
    helper = helper_path or Path(__file__).with_name("eclipse_geometry.mjs")
    completed = subprocess.run(
        [
            node_binary,
            str(helper),
            "--lat",
            f"{centroid.latitude:.10f}",
            "--lng",
            f"{centroid.longitude:.10f}",
            "--search-start",
            search_start_utc,
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    raw = json.loads(completed.stdout)
    geometry = EclipseGeometry(
        search_start_utc=str(raw["searchStartUtc"]),
        kind=str(raw["kind"]),
        obscuration=float(raw["obscuration"]),
        partial_begin_utc=str(raw["partialBeginUtc"]),
        maximum_utc=str(raw["maximumUtc"]),
        partial_end_utc=str(raw["partialEndUtc"]),
        sun_azimuth_degrees=float(raw["sunAzimuthDegrees"]),
        sun_apparent_altitude_degrees=float(raw["sunApparentAltitudeDegrees"]),
        sun_angular_radius_degrees=float(raw["sunAngularRadiusDegrees"]),
    )
    if not (270 < geometry.sun_azimuth_degrees < 315):
        raise ValueError(
            "The optimized raster pass currently supports a west-north-west Sun only; "
            f"got {geometry.sun_azimuth_degrees:.2f}°"
        )
    if geometry.sun_apparent_altitude_degrees <= 0:
        raise ValueError("The Sun is below the horizon at local eclipse maximum")
    return geometry


def derive_halo(
    eclipse: EclipseGeometry,
    relief_range_meters: float,
    policy: dict[str, Any] | None,
    model_margin_degrees: float,
) -> HaloDefinition:
    options = policy or {}
    lateral = float(options.get("lateralMeters", 50.0))
    conservative_altitude = (
        eclipse.sun_apparent_altitude_degrees
        - eclipse.sun_angular_radius_degrees
        - model_margin_degrees
    )
    if conservative_altitude <= 0.25:
        raise ValueError(
            "The conservative lower solar limb is too close to the horizon for a bounded model"
        )
    if options.get("strategy", "automatic") == "fixed":
        distance = float(options["sunwardMeters"])
        return HaloDefinition(
            strategy="fixed",
            sunward_meters=distance,
            lateral_meters=lateral,
            relief_range_meters=None,
            vertical_budget_meters=None,
            conservative_altitude_degrees=conservative_altitude,
            capped=False,
        )

    minimum = float(options.get("minimumMeters", 4_000.0))
    maximum = float(options.get("maximumMeters", 15_000.0))
    structures = float(options.get("structureAllowanceMeters", 80.0))
    safety = float(options.get("safetyMeters", 750.0))
    vertical_budget = max(0.0, relief_range_meters) + structures
    geometric = vertical_budget / math.tan(math.radians(conservative_altitude))
    uncapped = max(minimum, geometric + safety)
    distance = min(maximum, uncapped)
    return HaloDefinition(
        strategy="automatic",
        sunward_meters=distance,
        lateral_meters=lateral,
        relief_range_meters=relief_range_meters,
        vertical_budget_meters=vertical_budget,
        conservative_altitude_degrees=conservative_altitude,
        capped=uncapped > maximum,
    )


def dataclass_json(value: Any) -> dict[str, Any]:
    return asdict(value)
