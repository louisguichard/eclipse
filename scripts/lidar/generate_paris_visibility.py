#!/usr/bin/env python3
"""Build a regional eclipse-visibility tile pyramid from IGN elevation data.

The source elevations are requested from the public IGN WMS as raw float32
BIL, directly on a two-metre Lambert-93 grid.  Full-resolution 50 cm source
tiles are therefore not committed or shipped to the browser.  The generated
PNG tiles contain only the independent geometric classification.
"""

from __future__ import annotations

import argparse
import json
import math
import time
import urllib.parse
import urllib.request
from io import BytesIO
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Iterable

import numpy as np
from PIL import Image, ImageDraw
from pyproj import Geod, Transformer

from visibility_model import (
    CLASS_BLOCKED,
    CLASS_CLEAR,
    CLASS_NO_DATA,
    CLASS_SENSITIVE,
    CLASS_UNCERTAIN,
    RasterGeometry,
    SolarGeometry,
    classify_visibility,
    detect_deck_cells,
    dilate_mask,
    estimate_water_planes,
    sanitize_elevation,
)
from region_pipeline import (
    EclipseGeometry,
    HaloDefinition,
    RegionCentroid,
    RegionDefinition,
    boundary_centroid,
    calculate_eclipse_geometry,
    dataclass_json,
    derive_halo,
    load_or_fetch_boundary,
    load_region_definition,
    polygon_groups as regional_polygon_groups,
    projected_polygon_groups,
)


PARIS_CONTOUR_URL = "https://geo.api.gouv.fr/communes/75056?format=geojson&geometry=contour"
IGN_WMS_URL = "https://data.geopf.fr/wms-r/wms"
MNT_LAYER = "IGNF_LIDAR-HD_MNT_ELEVATION.ELEVATIONGRIDCOVERAGE.LAMB93"
MNS_LAYER = "IGNF_LIDAR-HD_MNS_ELEVATION.ELEVATIONGRIDCOVERAGE.LAMB93"
MNT_FALLBACK_LAYER = "ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES"
MNS_FALLBACK_LAYER = "ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES.MNS"
DATASET_VERSION = "paris-2026-max-v1"

# Exact local maximum calculated by Astronomy Engine for central Paris.
MAXIMUM_UTC = "2026-08-12T18:17:11.916Z"
SUN_AZIMUTH_DEGREES = 283.804835
SUN_APPARENT_ALTITUDE_DEGREES = 7.723762
SUN_ANGULAR_RADIUS_DEGREES = 0.26296

OBSERVER_HEIGHT_METERS = 1.7
MODEL_MARGIN_DEGREES = 0.5
SUNWARD_HALO_METERS = 4_000
LATERAL_HALO_METERS = 40

ATTRIBUTION = (
    "© IGN — LiDAR HD MNT/MNS, bloc KE, acquisition 03-03-2023, "
    "édition 06-06-2025, Licence Ouverte 2.0"
)
GENERIC_ATTRIBUTION = "© IGN — LiDAR HD, MNS Correl et RGE ALTI · Licence Ouverte 2.0"

# The map answers one question — will the Sun be visible from here — so only
# the robustly clear class is painted. Every other outcome stays transparent.
# The published PNG needs only two palette entries and one bit per pixel; the
# richer geometric classes remain available in the local NumPy classification.
TRANSPARENT_PALETTE_INDEX = 0
CLEAR_PALETTE_INDEX = 1
CLEAR_TILE_COLOR = (255, 201, 51, 235)
PNG_PALETTE = [
    0, 0, 0,
    *CLEAR_TILE_COLOR[:3],
    *([0] * (256 * 3 - 6)),
]
PNG_TRANSPARENCY = bytes((0, CLEAR_TILE_COLOR[3]))
CLASS_COUNT = CLASS_BLOCKED + 1

# A clear pavement is often only a few cells wide. Painted at that width it is
# invisible at city zoom, so the class is widened for rendering only; the saved
# classification keeps its true extent.
# Keep a small render-only halo so narrow clear pavements survive resampling,
# while preserving more of the 2 m classification detail at street zooms.
RENDER_DILATION_CELLS = 2

# Web-Mercator ground resolution of a 256 px tile at the equator, in metres.
EQUATORIAL_METERS_PER_PIXEL = 2 * math.pi * 6_378_137 / 256
PARIS_LATITUDE_DEGREES = 48.8566


def meters_per_pixel(zoom: int) -> float:
    """Ground size of one tile pixel over Paris at `zoom`."""

    return (
        EQUATORIAL_METERS_PER_PIXEL
        * math.cos(math.radians(PARIS_LATITUDE_DEGREES))
        / (2 ** zoom)
    )


def render_dilation_cells(zoom: int, resolution_meters: float) -> int:
    """Cells to grow the painted class by before sampling tiles at `zoom`.

    Tiles are point-sampled, so a feature narrower than one pixel is hit only
    by chance and a zoomed-out map loses the layer entirely.  Growing the mask
    by half a pixel makes the sample answer "is there a clear cell anywhere in
    this pixel", which is the honest way to shrink a categorical raster: the
    painted band thins as you zoom out instead of vanishing, and it never
    spreads wider than the single pixel that carries it.

    `RENDER_DILATION_CELLS` remains the floor, for the close zooms where a
    pavement would otherwise be a hairline.
    """

    footprint = math.ceil(meters_per_pixel(zoom) / (2 * resolution_meters))
    return max(RENDER_DILATION_CELLS, footprint)


def encode_visibility_tile(codes: np.ndarray) -> bytes | None:
    """Return a compact one-bit indexed PNG, or ``None`` for an empty tile.

    Empty tiles are deliberately not published: the custom map type turns a
    missing image into transparency, while R2 avoids storing and uploading an
    object that cannot paint a pixel. The dataset directory is versioned, so a
    missing object remains a stable negative result just like a present PNG.
    """

    if codes.shape != (256, 256):
        raise ValueError(f"Expected a 256 × 256 tile, got {codes.shape}")
    visible = codes == CLASS_CLEAR
    if not visible.any():
        return None

    palette_indexes = np.where(
        visible,
        CLEAR_PALETTE_INDEX,
        TRANSPARENT_PALETTE_INDEX,
    ).astype(np.uint8)
    image = Image.fromarray(palette_indexes, mode="P")
    image.putpalette(PNG_PALETTE)
    image.info["transparency"] = PNG_TRANSPARENCY
    payload = BytesIO()
    image.save(
        payload,
        format="PNG",
        bits=1,
        optimize=True,
        compress_level=9,
    )
    return payload.getvalue()


def write_visibility_tile(path: Path, codes: np.ndarray) -> bool:
    """Write one publishable tile and remove stale output when it is empty."""

    payload = encode_visibility_tile(codes)
    if payload is None:
        path.unlink(missing_ok=True)
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(f"{path.suffix}.tmp")
    temporary.write_bytes(payload)
    temporary.replace(path)
    return True


@dataclass(frozen=True)
class Bounds:
    west: float
    south: float
    east: float
    north: float


@dataclass(frozen=True)
class GridDefinition:
    crs: str
    resolution_meters: float
    width: int
    height: int
    input_bounds: Bounds
    output_bounds: Bounds
    output_rows: tuple[int, int]
    output_columns: tuple[int, int]
    true_solar_azimuth_degrees: float
    grid_solar_azimuth_degrees: float
    grid_ray_east_component: float
    grid_ray_north_component: float


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(f"{path.suffix}.tmp")
    temporary.write_text(
        json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    temporary.replace(path)


def fetch_json(url: str, timeout: int = 60) -> dict[str, Any]:
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "eclipse-2026-lidar-pipeline/1.0"},
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def load_boundary(path: Path) -> dict[str, Any]:
    if not path.exists():
        print("Téléchargement du contour administratif officiel de Paris…", flush=True)
        write_json(path, fetch_json(PARIS_CONTOUR_URL))
    return json.loads(path.read_text(encoding="utf-8"))


def coordinate_rings(geometry: dict[str, Any]) -> Iterable[list[list[float]]]:
    geometry_type = geometry["type"]
    coordinates = geometry["coordinates"]
    if geometry_type == "Polygon":
        yield from coordinates
        return
    if geometry_type == "MultiPolygon":
        for polygon in coordinates:
            yield from polygon
        return
    raise ValueError(f"Unsupported Paris boundary geometry: {geometry_type}")


def polygon_groups(geometry: dict[str, Any]) -> Iterable[list[list[list[float]]]]:
    if geometry.get("type") in ("Feature", "FeatureCollection"):
        yield from regional_polygon_groups(geometry)
        return
    if geometry["type"] == "Polygon":
        yield geometry["coordinates"]
        return
    if geometry["type"] == "MultiPolygon":
        yield from geometry["coordinates"]
        return
    raise ValueError(f"Unsupported Paris boundary geometry: {geometry['type']}")


def project_boundary(
    feature: dict[str, Any], transformer: Transformer
) -> list[list[list[tuple[float, float]]]]:
    if feature.get("type") in ("Feature", "FeatureCollection"):
        return projected_polygon_groups(feature, transformer)
    return projected_polygon_groups(
        {"type": "Feature", "properties": {}, "geometry": feature}, transformer
    )


def snapped_floor(value: float, step: float) -> float:
    return math.floor(value / step) * step


def snapped_ceil(value: float, step: float) -> float:
    return math.ceil(value / step) * step


def projected_boundary_bounds(feature: dict[str, Any]) -> Bounds:
    transformer = Transformer.from_crs("EPSG:4326", "EPSG:2154", always_xy=True)
    projected = project_boundary(feature, transformer)
    points = [point for polygon in projected for ring in polygon for point in ring]
    if not points:
        raise ValueError("Boundary contains no coordinates")
    return Bounds(
        west=min(point[0] for point in points),
        south=min(point[1] for point in points),
        east=max(point[0] for point in points),
        north=max(point[1] for point in points),
    )


def estimate_relief_range(
    feature: dict[str, Any],
    cache_path: Path,
    policy: dict[str, Any] | None,
) -> float:
    """Estimate regional relief with one coarse, cached RGE ALTI request."""

    options = policy or {}
    if "reliefRangeMeters" in options:
        return float(options["reliefRangeMeters"])
    if cache_path.exists():
        return float(json.loads(cache_path.read_text(encoding="utf-8"))["rangeMeters"])
    bounds = projected_boundary_bounds(feature)
    longest = max(bounds.east - bounds.west, bounds.north - bounds.south)
    sample_limit = int(options.get("reliefSamplePixels", 512))
    width = max(1, round(sample_limit * (bounds.east - bounds.west) / longest))
    height = max(1, round(sample_limit * (bounds.north - bounds.south) / longest))
    parameters = {
        "SERVICE": "WMS",
        "VERSION": "1.3.0",
        "REQUEST": "GetMap",
        "LAYERS": MNT_FALLBACK_LAYER,
        "STYLES": "normal",
        "CRS": "EPSG:2154",
        "BBOX": f"{bounds.west},{bounds.south},{bounds.east},{bounds.north}",
        "WIDTH": str(width),
        "HEIGHT": str(height),
        "FORMAT": "image/x-bil;bits=32",
    }
    url = f"{IGN_WMS_URL}?{urllib.parse.urlencode(parameters)}"
    request = urllib.request.Request(
        url, headers={"User-Agent": "eclipse-2026-lidar-pipeline/2.0"}
    )
    with urllib.request.urlopen(request, timeout=180) as response:
        payload = response.read()
    expected_size = width * height * 4
    if len(payload) != expected_size:
        raise RuntimeError(
            f"IGN relief sample returned {len(payload)} bytes; expected {expected_size}"
        )
    values = sanitize_elevation(
        np.frombuffer(payload, dtype="<f4").reshape(height, width)
    )
    finite = values[np.isfinite(values)]
    if finite.size < width * height * 0.25:
        raise RuntimeError("Too little valid RGE ALTI coverage to estimate the halo")
    # Robust extrema prevent one corrupt pixel from inflating the halo; the
    # structure allowance and safety distance remain conservative afterwards.
    minimum, maximum = np.percentile(finite, (0.5, 99.5))
    result = max(0.0, float(maximum - minimum))
    write_json(
        cache_path,
        {
            "rangeMeters": result,
            "minimumMeters": float(minimum),
            "maximumMeters": float(maximum),
            "sample": {"width": width, "height": height, "layer": MNT_FALLBACK_LAYER},
        },
    )
    return result


def build_grid(
    feature: dict[str, Any],
    resolution: float,
    *,
    centroid: RegionCentroid | None = None,
    solar_azimuth_degrees: float = SUN_AZIMUTH_DEGREES,
    sunward_halo_meters: float = SUNWARD_HALO_METERS,
    lateral_halo_meters: float = LATERAL_HALO_METERS,
) -> GridDefinition:
    to_lambert = Transformer.from_crs("EPSG:4326", "EPSG:2154", always_xy=True)
    projected = project_boundary(feature, to_lambert)
    points = [point for polygon in projected for ring in polygon for point in ring]
    xs = [point[0] for point in points]
    ys = [point[1] for point in points]
    output = Bounds(
        west=snapped_floor(min(xs), resolution),
        south=snapped_floor(min(ys), resolution),
        east=snapped_ceil(max(xs), resolution),
        north=snapped_ceil(max(ys), resolution),
    )

    region_center = centroid or boundary_centroid(feature)
    center_lon = region_center.longitude
    center_lat = region_center.latitude
    endpoint_lon, endpoint_lat, _ = Geod(ellps="WGS84").fwd(
        center_lon,
        center_lat,
        solar_azimuth_degrees,
        1_000,
    )
    center_x, center_y = to_lambert.transform(center_lon, center_lat)
    endpoint_x, endpoint_y = to_lambert.transform(endpoint_lon, endpoint_lat)
    ray_dx = endpoint_x - center_x
    ray_dy = endpoint_y - center_y
    ray_length = math.hypot(ray_dx, ray_dy)
    ray_east = ray_dx / ray_length
    ray_north = ray_dy / ray_length
    if ray_east >= 0 or ray_north <= 0:
        raise RuntimeError("Expected a west-north-west projected solar ray")
    grid_azimuth = math.degrees(math.atan2(ray_east, ray_north)) % 360

    input_west = snapped_floor(
        output.west + ray_east * sunward_halo_meters - lateral_halo_meters,
        resolution,
    )
    input_east = snapped_ceil(output.east + lateral_halo_meters, resolution)
    # The linear pass keeps predecessors for the complete west-east span.  Its
    # northward digital rays therefore need a matching northern halo even when
    # distant obstacles have already fallen far below the solar ray.
    total_horizontal_span = input_east - input_west
    required_north_span = total_horizontal_span * ray_north / -ray_east
    input_north = snapped_ceil(
        output.north + required_north_span + lateral_halo_meters,
        resolution,
    )
    input_south = snapped_floor(output.south - lateral_halo_meters, resolution)
    input_bounds = Bounds(input_west, input_south, input_east, input_north)

    width = round((input_east - input_west) / resolution)
    height = round((input_north - input_south) / resolution)
    output_columns = (
        round((output.west - input_west) / resolution),
        round((output.east - input_west) / resolution),
    )
    output_rows = (
        round((input_north - output.north) / resolution),
        round((input_north - output.south) / resolution),
    )
    return GridDefinition(
        crs="EPSG:2154",
        resolution_meters=resolution,
        width=width,
        height=height,
        input_bounds=input_bounds,
        output_bounds=output,
        output_rows=output_rows,
        output_columns=output_columns,
        true_solar_azimuth_degrees=solar_azimuth_degrees,
        grid_solar_azimuth_degrees=grid_azimuth,
        grid_ray_east_component=ray_east,
        grid_ray_north_component=ray_north,
    )


def grid_as_json(grid: GridDefinition) -> dict[str, Any]:
    value = asdict(grid)
    value["output_rows"] = list(grid.output_rows)
    value["output_columns"] = list(grid.output_columns)
    return value


def merge_elevation_sources(
    primary: np.ndarray,
    fallback: np.ndarray | None,
) -> tuple[np.ndarray, dict[str, int]]:
    """Fill only invalid primary cells and report the resulting source tiers."""

    values = np.asarray(primary, dtype=np.float32).copy()
    primary_valid = np.isfinite(sanitize_elevation(values))
    fallback_cells = 0
    if fallback is not None:
        fallback_values = np.asarray(fallback, dtype=np.float32)
        if fallback_values.shape != values.shape:
            raise ValueError("Primary and fallback rasters must have the same shape")
        fallback_valid = np.isfinite(sanitize_elevation(fallback_values))
        use_fallback = ~primary_valid & fallback_valid
        values[use_fallback] = fallback_values[use_fallback]
        fallback_cells = int(use_fallback.sum())
    final_valid = np.isfinite(sanitize_elevation(values))
    return values, {
        "lidar": int(primary_valid.sum()),
        "fallback": fallback_cells,
        "noData": int((~final_valid).sum()),
    }


def expected_chunk_keys(grid: GridDefinition, chunk_size: int) -> set[str]:
    return {
        f"{row}:{column}"
        for row in range(0, grid.height, chunk_size)
        for column in range(0, grid.width, chunk_size)
    }


def download_signature(
    layer: str,
    grid: GridDefinition,
    chunk_size: int,
    fallback_layer: str | None,
) -> dict[str, Any]:
    signature: dict[str, Any] = {
        "layer": layer,
        "grid": grid_as_json(grid),
        "chunk_size": chunk_size,
    }
    if fallback_layer is not None:
        signature["fallback_layer"] = fallback_layer
    return signature


def ensure_downloads_complete(
    data_dir: Path,
    grid: GridDefinition,
    chunk_size: int,
    *,
    fallback: bool,
) -> None:
    """Refuse classification until every MNT and MNS chunk is durable.

    Completion may be spread over several shard state files.  Their union must
    cover the exact current grid, and the shared float32 raster must have its
    complete byte size.  This prevents untouched sparse/memmap cells from being
    silently interpreted as valid elevations after a partial download.
    """

    expected_chunks = expected_chunk_keys(grid, chunk_size)
    expected_bytes = grid.width * grid.height * np.dtype("<f4").itemsize
    rasters = (
        ("mnt", MNT_LAYER, MNT_FALLBACK_LAYER if fallback else None),
        ("mns", MNS_LAYER, MNS_FALLBACK_LAYER if fallback else None),
    )
    for name, layer, fallback_layer in rasters:
        raster_path = data_dir / f"{name}.f32"
        if not raster_path.is_file():
            raise RuntimeError(
                f"Incomplete {name.upper()} download: missing {raster_path}"
            )
        actual_bytes = raster_path.stat().st_size
        if actual_bytes != expected_bytes:
            raise RuntimeError(
                f"Incomplete {name.upper()} raster: {actual_bytes} bytes, "
                f"expected {expected_bytes}"
            )

        expected_signature = download_signature(
            layer, grid, chunk_size, fallback_layer
        )
        state_paths = sorted(data_dir.glob(f"{name}-download*.json"))
        if not state_paths:
            raise RuntimeError(
                f"Incomplete {name.upper()} download: no state file found"
            )
        completed: set[str] = set()
        for state_path in state_paths:
            state = json.loads(state_path.read_text(encoding="utf-8"))
            signature = dict(state.get("signature", {}))
            signature.pop("shard_index", None)
            signature.pop("shard_count", None)
            if signature != expected_signature:
                raise RuntimeError(
                    f"Download state does not match the current grid: {state_path}"
                )
            completed.update(str(key) for key in state.get("completed", []))
        missing = expected_chunks - completed
        if missing:
            preview = ", ".join(sorted(missing)[:3])
            raise RuntimeError(
                f"Incomplete {name.upper()} download: missing {len(missing)}/"
                f"{len(expected_chunks)} chunks (for example {preview})"
            )


def download_wms_raster(
    layer: str,
    destination: Path,
    state_path: Path,
    grid: GridDefinition,
    chunk_size: int,
    *,
    fallback_layer: str | None = None,
    shard_index: int = 0,
    shard_count: int = 1,
) -> None:
    if shard_count < 1 or shard_index < 0 or shard_index >= shard_count:
        raise ValueError("Download shard index must be within the shard count")
    base_signature = download_signature(layer, grid, chunk_size, fallback_layer)
    signature = dict(base_signature)
    actual_state_path = state_path
    if shard_count > 1:
        signature.update({"shard_index": shard_index, "shard_count": shard_count})
        actual_state_path = state_path.with_name(
            f"{state_path.stem}-shard-{shard_index + 1}-of-{shard_count}{state_path.suffix}"
        )
    state: dict[str, Any] = {
        "signature": signature,
        "completed": [],
        "sourceCellsByChunk": {},
    }
    if actual_state_path.exists():
        state = json.loads(actual_state_path.read_text(encoding="utf-8"))
        if state.get("signature") != signature:
            raise RuntimeError(
                f"Grid changed for {destination}. Move the existing data/lidar directory before regenerating."
            )

    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists():
        raster = np.memmap(
            destination,
            dtype="<f4",
            mode="r+",
            shape=(grid.height, grid.width),
        )
    else:
        raster = np.memmap(
            destination,
            dtype="<f4",
            mode="w+",
            shape=(grid.height, grid.width),
        )
        raster[:] = np.nan
        raster.flush()

    completed = set(state.get("completed", []))
    if shard_count > 1 and state_path.exists():
        base_state = json.loads(state_path.read_text(encoding="utf-8"))
        if base_state.get("signature") != base_signature:
            raise RuntimeError(
                f"Grid changed for {destination}. Move the existing data/lidar directory before regenerating."
            )
        completed.update(base_state.get("completed", []))
    chunks = [
        (row, column)
        for row in range(0, grid.height, chunk_size)
        for column in range(0, grid.width, chunk_size)
    ]
    owned_chunks = {
        f"{row}:{column}"
        for index, (row, column) in enumerate(chunks)
        if index % shard_count == shard_index
    }
    last_request_at = 0.0

    for index, (row, column) in enumerate(chunks, start=1):
        key = f"{row}:{column}"
        if key not in owned_chunks:
            continue
        if key in completed:
            continue
        chunk_height = min(chunk_size, grid.height - row)
        chunk_width = min(chunk_size, grid.width - column)
        left = grid.input_bounds.west + column * grid.resolution_meters
        right = left + chunk_width * grid.resolution_meters
        top = grid.input_bounds.north - row * grid.resolution_meters
        bottom = top - chunk_height * grid.resolution_meters
        base_parameters = {
            "SERVICE": "WMS",
            "VERSION": "1.3.0",
            "REQUEST": "GetMap",
            "STYLES": "normal",
            "CRS": grid.crs,
            "BBOX": f"{left},{bottom},{right},{top}",
            "WIDTH": str(chunk_width),
            "HEIGHT": str(chunk_height),
            "FORMAT": "image/x-bil;bits=32",
        }
        expected_size = chunk_height * chunk_width * 4
        def request_layer(requested_layer: str) -> bytes:
            nonlocal last_request_at
            parameters = dict(base_parameters, LAYERS=requested_layer)
            url = f"{IGN_WMS_URL}?{urllib.parse.urlencode(parameters)}"
            for attempt in range(5):
                delay = 1.05 - (time.monotonic() - last_request_at)
                if delay > 0:
                    time.sleep(delay)
                request = urllib.request.Request(
                    url,
                    headers={"User-Agent": "eclipse-2026-lidar-pipeline/2.0"},
                )
                try:
                    last_request_at = time.monotonic()
                    with urllib.request.urlopen(request, timeout=180) as response:
                        payload = response.read()
                    if len(payload) != expected_size:
                        preview = payload[:300].decode("utf-8", errors="replace")
                        raise RuntimeError(
                            f"IGN returned {len(payload)} bytes, expected {expected_size}: {preview}"
                        )
                    return payload
                except Exception as error:
                    if attempt == 4:
                        raise RuntimeError(
                            f"IGN WMS {requested_layer} failed for chunk {key}"
                        ) from error
                    time.sleep(2 ** attempt)
            raise AssertionError("unreachable")

        primary_values = np.frombuffer(request_layer(layer), dtype="<f4").reshape(
            chunk_height, chunk_width
        )
        fallback_values: np.ndarray | None = None
        if fallback_layer is not None and not np.isfinite(
            sanitize_elevation(primary_values)
        ).all():
            fallback_values = np.frombuffer(
                request_layer(fallback_layer), dtype="<f4"
            ).reshape(chunk_height, chunk_width)
        values, source_counts = merge_elevation_sources(primary_values, fallback_values)
        raster[row : row + chunk_height, column : column + chunk_width] = values
        raster.flush()
        completed.add(key)
        state["completed"] = sorted(completed)
        state.setdefault("sourceCellsByChunk", {})[key] = source_counts
        write_json(actual_state_path, state)
        completed_owned = len(owned_chunks.intersection(completed))
        print(
            f"{destination.stem}: bloc {index}/{len(chunks)} "
            f"({100 * completed_owned / len(owned_chunks):.0f} % du shard)",
            flush=True,
        )


def rasterize_region_mask(
    feature: dict[str, Any],
    grid: GridDefinition,
) -> np.ndarray:
    to_lambert = Transformer.from_crs("EPSG:4326", grid.crs, always_xy=True)
    projected = project_boundary(feature, to_lambert)
    row_start, row_stop = grid.output_rows
    column_start, column_stop = grid.output_columns
    output_width = column_stop - column_start
    output_height = row_stop - row_start
    result = np.zeros((output_height, output_width), dtype=bool)

    def pixel(point: tuple[float, float]) -> tuple[float, float]:
        x, y = point
        return (
            (x - grid.output_bounds.west) / grid.resolution_meters,
            (grid.output_bounds.north - y) / grid.resolution_meters,
        )

    for polygon in projected:
        # Compose each polygon independently. Drawing every geometry on one
        # canvas makes a later polygon's hole erase an earlier enclave that is
        # itself a valid part of a MultiPolygon/FeatureCollection.
        image = Image.new("L", (output_width, output_height), 0)
        draw = ImageDraw.Draw(image)
        draw.polygon([pixel(point) for point in polygon[0]], fill=255)
        for hole in polygon[1:]:
            draw.polygon([pixel(point) for point in hole], fill=0)
        result |= np.asarray(image, dtype=np.uint8) > 0
    return result


# Backward-compatible import name used by earlier local tooling.
rasterize_paris_mask = rasterize_region_mask


def _source_tier_counts(data_dir: Path) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for name in ("mnt", "mns"):
        totals = {"lidar": 0, "fallback": 0, "noData": 0}
        counts_by_chunk: dict[str, dict[str, int]] = {}
        for path in sorted(data_dir.glob(f"{name}-download*.json")):
            state = json.loads(path.read_text(encoding="utf-8"))
            for chunk, counts in state.get("sourceCellsByChunk", {}).items():
                counts_by_chunk[chunk] = counts
        for counts in counts_by_chunk.values():
            for key in totals:
                totals[key] += int(counts.get(key, 0))
        result[name] = totals
    return result


def classify_region(
    data_dir: Path,
    feature: dict[str, Any],
    grid: GridDefinition,
    *,
    region_id: str = "paris",
    eclipse: EclipseGeometry | None = None,
    observer_height_meters: float = OBSERVER_HEIGHT_METERS,
    model_margin_degrees: float = MODEL_MARGIN_DEGREES,
    deck_correction: bool = True,
) -> Path:
    shape = (grid.height, grid.width)
    mnt = np.memmap(data_dir / "mnt.f32", dtype="<f4", mode="r", shape=shape)
    mns = np.memmap(data_dir / "mns.f32", dtype="<f4", mode="r", shape=shape)
    last_percent = -1

    def progress(column: int, width: int) -> None:
        nonlocal last_percent
        percent = int(column * 100 / max(1, width - 1))
        if percent >= last_percent + 5:
            last_percent = percent
            print(f"Calcul de visibilité : {percent} %", flush=True)

    if eclipse is None:
        eclipse = EclipseGeometry(
            search_start_utc="2026-08-01T00:00:00.000Z",
            kind="partial",
            obscuration=0.92,
            partial_begin_utc="2026-08-12T17:22:00.000Z",
            maximum_utc=MAXIMUM_UTC,
            partial_end_utc="2026-08-12T19:09:00.000Z",
            sun_azimuth_degrees=SUN_AZIMUTH_DEGREES,
            sun_apparent_altitude_degrees=SUN_APPARENT_ALTITUDE_DEGREES,
            sun_angular_radius_degrees=SUN_ANGULAR_RADIUS_DEGREES,
        )

    water_planes: list[float] = []
    deck: np.ndarray | None = None
    if deck_correction:
        water_planes = estimate_water_planes(mnt)
        print(
            "Plans d’eau estimés : "
            + ", ".join(f"{plane:.2f} m NGF" for plane in water_planes),
            flush=True,
        )
        deck = detect_deck_cells(mnt, mns, water_planes)
        print(f"Tabliers détectés : {int(deck.sum())} cellules", flush=True)
    else:
        print("Correction des tabliers désactivée (mode régional conservateur)", flush=True)

    classes = classify_visibility(
        mnt,
        mns,
        RasterGeometry(
            pixel_east_meters=grid.resolution_meters,
            pixel_north_meters=grid.resolution_meters,
        ),
        SolarGeometry(
            azimuth_degrees=eclipse.sun_azimuth_degrees,
            grid_azimuth_degrees=grid.grid_solar_azimuth_degrees,
            altitude_degrees=eclipse.sun_apparent_altitude_degrees,
            angular_radius_degrees=eclipse.sun_angular_radius_degrees,
            model_margin_degrees=model_margin_degrees,
        ),
        slice(*grid.output_rows),
        slice(*grid.output_columns),
        observer_height_meters=observer_height_meters,
        deck=deck,
        progress=progress,
    )
    classes[~rasterize_region_mask(feature, grid)] = CLASS_NO_DATA
    class_path = data_dir / f"{region_id}-visibility-classes.npy"
    np.save(class_path, classes)
    counts = np.bincount(classes.ravel(), minlength=CLASS_COUNT)
    write_json(
        data_dir / "classification.json",
        {
            "classes": {
                "noData": int(counts[CLASS_NO_DATA]),
                "clear": int(counts[CLASS_CLEAR]),
                "sensitive": int(counts[CLASS_SENSITIVE]),
                "uncertain": int(counts[CLASS_UNCERTAIN]),
                "blocked": int(counts[CLASS_BLOCKED]),
            },
            "solar": {
                "timeUtc": eclipse.maximum_utc,
                "azimuthDegrees": eclipse.sun_azimuth_degrees,
                "apparentAltitudeDegrees": eclipse.sun_apparent_altitude_degrees,
                "angularRadiusDegrees": eclipse.sun_angular_radius_degrees,
                "modelMarginDegrees": model_margin_degrees,
                "obscuration": eclipse.obscuration,
            },
            "deck": {
                "waterPlanesMeters": [round(float(p), 3) for p in water_planes],
                "enabled": deck_correction,
                "cells": 0 if deck is None else int(deck.sum()),
            },
            "sourceTiers": _source_tier_counts(data_dir),
        },
    )
    print(f"Classification écrite dans {class_path}", flush=True)
    return class_path


classify_paris = classify_region


def longitude_to_tile_x(longitude: float, zoom: int) -> float:
    return (longitude + 180) / 360 * (2 ** zoom)


def latitude_to_tile_y(latitude: float, zoom: int) -> float:
    latitude_radians = math.radians(latitude)
    return (
        1 - math.asinh(math.tan(latitude_radians)) / math.pi
    ) / 2 * (2 ** zoom)


def grid_wgs84_bounds(grid: GridDefinition) -> Bounds:
    to_wgs84 = Transformer.from_crs(grid.crs, "EPSG:4326", always_xy=True)
    corners = [
        to_wgs84.transform(grid.output_bounds.west, grid.output_bounds.south),
        to_wgs84.transform(grid.output_bounds.west, grid.output_bounds.north),
        to_wgs84.transform(grid.output_bounds.east, grid.output_bounds.south),
        to_wgs84.transform(grid.output_bounds.east, grid.output_bounds.north),
    ]
    return Bounds(
        west=min(point[0] for point in corners),
        south=min(point[1] for point in corners),
        east=max(point[0] for point in corners),
        north=max(point[1] for point in corners),
    )


def generate_tiles(
    class_path: Path,
    destination: Path,
    grid: GridDefinition,
    min_zoom: int,
    max_zoom: int,
    *,
    region: RegionDefinition | None = None,
    centroid: RegionCentroid | None = None,
    eclipse: EclipseGeometry | None = None,
    halo: HaloDefinition | None = None,
) -> None:
    dataset_version = DATASET_VERSION if region is None else region.dataset_version
    region_label = "Paris" if region is None else region.label
    observer_height = OBSERVER_HEIGHT_METERS if region is None else region.observer_height_meters
    maximum_utc = MAXIMUM_UTC if eclipse is None else eclipse.maximum_utc
    source_classes = np.load(class_path)
    clear = source_classes == CLASS_CLEAR
    # Never paint outside the dataset: dilation must not bleed into the cells
    # that carry no estimate at all.
    inside = source_classes != CLASS_NO_DATA
    to_lambert = Transformer.from_crs("EPSG:4326", grid.crs, always_xy=True)
    coverage = grid_wgs84_bounds(grid)
    destination.mkdir(parents=True, exist_ok=True)
    tile_count = 0
    empty_tile_count = 0
    dilation_by_zoom: dict[int, int] = {}

    for zoom in range(min_zoom, max_zoom + 1):
        scale = 2 ** zoom
        dilation = render_dilation_cells(zoom, grid.resolution_meters)
        dilation_by_zoom[zoom] = dilation
        classes = np.where(
            dilate_mask(clear, dilation) & inside, CLASS_CLEAR, source_classes
        ).astype(np.uint8)
        print(
            f"Zoom {zoom} : {meters_per_pixel(zoom):.1f} m/pixel, classe visible "
            f"élargie de {dilation} cellules "
            f"({dilation * grid.resolution_meters:g} m) pour le rendu",
            flush=True,
        )
        x_start = math.floor(longitude_to_tile_x(coverage.west, zoom))
        x_stop = math.floor(longitude_to_tile_x(coverage.east, zoom))
        y_start = math.floor(latitude_to_tile_y(coverage.north, zoom))
        y_stop = math.floor(latitude_to_tile_y(coverage.south, zoom))
        pixel_offsets = np.arange(256, dtype=np.float64) + 0.5

        for tile_y in range(y_start, y_stop + 1):
            world_y = (tile_y * 256 + pixel_offsets) / (256 * scale)
            latitudes = np.degrees(np.arctan(np.sinh(math.pi * (1 - 2 * world_y))))
            for tile_x in range(x_start, x_stop + 1):
                world_x = (tile_x * 256 + pixel_offsets) / (256 * scale)
                longitudes = world_x * 360 - 180
                longitude_grid, latitude_grid = np.meshgrid(longitudes, latitudes)
                eastings, northings = to_lambert.transform(longitude_grid, latitude_grid)
                columns = np.floor(
                    (eastings - grid.output_bounds.west) / grid.resolution_meters
                ).astype(np.int32)
                rows = np.floor(
                    (grid.output_bounds.north - northings) / grid.resolution_meters
                ).astype(np.int32)
                valid = (
                    (rows >= 0)
                    & (rows < classes.shape[0])
                    & (columns >= 0)
                    & (columns < classes.shape[1])
                )
                codes = np.zeros((256, 256), dtype=np.uint8)
                codes[valid] = classes[rows[valid], columns[valid]]
                tile_path = destination / str(zoom) / str(tile_x) / f"{tile_y}.png"
                if write_visibility_tile(tile_path, codes):
                    tile_count += 1
                else:
                    empty_tile_count += 1
        print(f"Tuiles zoom {zoom} terminées", flush=True)

    classification = json.loads(
        (class_path.parent / "classification.json").read_text(encoding="utf-8")
    )
    manifest = {
        "id": f"{('paris' if region is None else region.id)}-maximum-geometry",
        "version": dataset_version,
        "generatedAt": datetime.now(UTC).isoformat(),
        "reference": {
            "mode": "fixed-instant",
            "timeUtc": maximum_utc,
            "label": f"{region_label} · maximum local au centroïde",
            "centroid": None if centroid is None else dataclass_json(centroid),
        },
        "coverage": asdict(coverage),
        "surface": {
            "resolutionMeters": grid.resolution_meters,
            "observerHeightMeters": observer_height,
            "includesBuildings": True,
            "includesVegetation": True,
            "sourceTiers": ["IGN LiDAR HD", "MNS Correl (fallback)", "RGE ALTI (fallback)"],
        },
        "tiles": {
            "scheme": "xyz",
            "tileSize": 256,
            "minZoom": min_zoom,
            "maxZoom": max_zoom,
            "count": tile_count,
            "emptyTileCount": empty_tile_count,
            "format": "png-palette-1bit",
            "emptyTileBehavior": "omitted",
            "renderDilationMetersByZoom": {
                str(zoom): round(cells * grid.resolution_meters, 1)
                for zoom, cells in sorted(dilation_by_zoom.items())
            },
        },
        "classification": classification,
        "halo": None if halo is None else dataclass_json(halo),
        "attribution": ATTRIBUTION if region is None else region.attribution,
        "license": "https://www.etalab.gouv.fr/licence-ouverte-open-licence/",
        "limitations": [
            "Le modèle ne prédit pas les nuages.",
            "Le millésime des surfaces peut être hétérogène et le feuillage d’août sous-estimé.",
            "La couche ne garantit pas que le pixel soit accessible au public.",
            f"La résolution de calcul est dérivée à {grid.resolution_meters:g} m des sources IGN.",
            "Les trous LiDAR utilisent MNS Correl/RGE ALTI quand ils sont disponibles, avec une précision moindre.",
            (
                "Les zones jaunes sont élargies pour rester lisibles — d’au moins "
                f"{RENDER_DILATION_CELLS * grid.resolution_meters:g} m, et jusqu’à "
                "la taille d’un pixel aux zooms lointains : leurs contours sont "
                "indicatifs."
            ),
            "Sur les ponts, l’observateur est placé sur le tablier détecté et non sur l’eau.",
        ],
    }
    write_json(destination / "manifest.json", manifest)
    print(
        f"{tile_count} tuiles écrites, {empty_tile_count} tuiles vides omises "
        f"dans {destination}",
        flush=True,
    )


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--stage",
        choices=("all", "prepare", "download", "classify", "tiles"),
        default="all",
    )
    parser.add_argument(
        "--region-config",
        help="JSON path or built-in name from scripts/lidar/regions (for example idf-77)",
    )
    parser.add_argument(
        "--download-raster",
        choices=("all", "mnt", "mns"),
        default="all",
        help="Limit the download stage to one resumable raster (default: both)",
    )
    parser.add_argument(
        "--download-shards",
        type=int,
        default=1,
        help="Split one raster into this many disjoint download workers",
    )
    parser.add_argument(
        "--download-shard-index",
        type=int,
        default=0,
        help="Zero-based worker index used with --download-shards",
    )
    parser.add_argument("--resolution", type=float)
    parser.add_argument("--chunk-size", type=int)
    parser.add_argument("--min-zoom", type=int)
    parser.add_argument("--max-zoom", type=int)
    parser.add_argument("--data-dir", type=Path)
    parser.add_argument(
        "--public-dir",
        type=Path,
    )
    return parser.parse_args()


def resolve_region_config(value: str) -> Path:
    candidate = Path(value)
    if candidate.exists():
        return candidate
    built_in = Path(__file__).with_name("regions") / f"{value.removesuffix('.json')}.json"
    if built_in.exists():
        return built_in
    raise FileNotFoundError(f"Unknown region config: {value}")


def main() -> None:
    arguments = parse_arguments()
    region = (
        load_region_definition(resolve_region_config(arguments.region_config))
        if arguments.region_config
        else None
    )
    resolution = arguments.resolution or (2.0 if region is None else region.resolution_meters)
    chunk_size = arguments.chunk_size or (2_000 if region is None else region.chunk_size)
    min_zoom = arguments.min_zoom if arguments.min_zoom is not None else (13 if region is None else region.min_zoom)
    max_zoom = arguments.max_zoom if arguments.max_zoom is not None else (16 if region is None else region.max_zoom)
    data_dir = arguments.data_dir or Path("data/lidar") / ("paris" if region is None else region.id)
    public_dir = arguments.public_dir or (
        Path("public/visibility") / DATASET_VERSION
        if region is None
        else Path("data/lidar/publish") / region.dataset_version
    )
    if resolution <= 0:
        raise ValueError("Resolution must be positive")
    if chunk_size <= 0 or chunk_size > 4_000:
        raise ValueError("Chunk size must be between 1 and 4000")
    if (
        arguments.download_shards < 1
        or arguments.download_shard_index < 0
        or arguments.download_shard_index >= arguments.download_shards
    ):
        raise ValueError("Download shard index must be within the shard count")
    if min_zoom > max_zoom:
        raise ValueError("Minimum zoom must not exceed maximum zoom")

    boundary_path = data_dir / "boundary.geojson"
    if region is None:
        # Preserve the legacy cache name and exact Paris source.
        boundary_path = data_dir / "paris-boundary.geojson"
        boundary = load_boundary(boundary_path)
        # The published v1 grid used this Astronomy Engine reference point;
        # retaining it keeps existing grid/download signatures resumable.
        centroid = RegionCentroid(longitude=2.3522, latitude=48.8566)
        eclipse = EclipseGeometry(
            "2026-08-01T00:00:00.000Z", "partial", 0.92,
            "2026-08-12T17:22:00.000Z", MAXIMUM_UTC,
            "2026-08-12T19:09:00.000Z", SUN_AZIMUTH_DEGREES,
            SUN_APPARENT_ALTITUDE_DEGREES, SUN_ANGULAR_RADIUS_DEGREES,
        )
        halo = derive_halo(
            eclipse, 0, {"strategy": "fixed", "sunwardMeters": SUNWARD_HALO_METERS,
                         "lateralMeters": LATERAL_HALO_METERS}, MODEL_MARGIN_DEGREES
        )
    else:
        boundary = load_or_fetch_boundary(region, boundary_path)
        centroid = boundary_centroid(boundary)
        eclipse = calculate_eclipse_geometry(centroid, region.search_start_utc)
        relief = estimate_relief_range(boundary, data_dir / "relief.json", region.halo)
        halo = derive_halo(eclipse, relief, region.halo, region.model_margin_degrees)
        write_json(
            data_dir / "preparation.json",
            {"region": dataclass_json(region), "centroid": dataclass_json(centroid),
             "eclipse": dataclass_json(eclipse), "halo": dataclass_json(halo)},
        )
    grid = build_grid(
        boundary, resolution, centroid=centroid,
        solar_azimuth_degrees=eclipse.sun_azimuth_degrees,
        sunward_halo_meters=halo.sunward_meters,
        lateral_halo_meters=halo.lateral_meters,
    )
    grid_path = data_dir / "grid.json"
    if grid_path.exists():
        existing = json.loads(grid_path.read_text(encoding="utf-8"))
        if existing != grid_as_json(grid):
            raise RuntimeError(
                "Grid definition changed. Move data/lidar/paris before starting a new dataset."
            )
    else:
        write_json(grid_path, grid_as_json(grid))
    print(
        f"Grille Lambert-93 : {grid.width} × {grid.height} à "
        f"{grid.resolution_meters:g} m",
        flush=True,
    )

    if arguments.stage == "prepare":
        return
    fallback = region is not None
    if arguments.stage in ("all", "download"):
        if arguments.download_raster in ("all", "mnt"):
            download_wms_raster(
                MNT_LAYER,
                data_dir / "mnt.f32",
                data_dir / "mnt-download.json",
                grid,
                chunk_size,
                fallback_layer=MNT_FALLBACK_LAYER if fallback else None,
                shard_index=arguments.download_shard_index,
                shard_count=arguments.download_shards,
            )
        if arguments.download_raster in ("all", "mns"):
            download_wms_raster(
                MNS_LAYER,
                data_dir / "mns.f32",
                data_dir / "mns-download.json",
                grid,
                chunk_size,
                fallback_layer=MNS_FALLBACK_LAYER if fallback else None,
                shard_index=arguments.download_shard_index,
                shard_count=arguments.download_shards,
            )
    region_id = "paris" if region is None else region.id
    class_path = data_dir / f"{region_id}-visibility-classes.npy"
    if arguments.stage in ("all", "classify"):
        ensure_downloads_complete(
            data_dir,
            grid,
            chunk_size,
            fallback=fallback,
        )
        class_path = classify_region(
            data_dir, boundary, grid, region_id=region_id, eclipse=eclipse,
            observer_height_meters=(OBSERVER_HEIGHT_METERS if region is None else region.observer_height_meters),
            model_margin_degrees=(MODEL_MARGIN_DEGREES if region is None else region.model_margin_degrees),
            deck_correction=True if region is None else region.deck_correction,
        )
    if arguments.stage in ("all", "tiles"):
        if not class_path.exists():
            raise FileNotFoundError(f"Run the classify stage first: {class_path}")
        generate_tiles(
            class_path,
            public_dir,
            grid,
            min_zoom,
            max_zoom,
            region=region,
            centroid=centroid,
            eclipse=eclipse,
            halo=halo,
        )


if __name__ == "__main__":
    main()
