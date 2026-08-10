#!/usr/bin/env python3
"""Build the static Paris eclipse-visibility tile pyramid from IGN LiDAR HD.

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
)


PARIS_CONTOUR_URL = "https://geo.api.gouv.fr/communes/75056?format=geojson&geometry=contour"
IGN_WMS_URL = "https://data.geopf.fr/wms-r/wms"
MNT_LAYER = "IGNF_LIDAR-HD_MNT_ELEVATION.ELEVATIONGRIDCOVERAGE.LAMB93"
MNS_LAYER = "IGNF_LIDAR-HD_MNS_ELEVATION.ELEVATIONGRIDCOVERAGE.LAMB93"
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

# The map answers one question — will the Sun be visible from here — so only
# the robustly clear class is painted. Every other outcome stays transparent
# rather than adding colours the reader has to decode.
CLASS_COLORS = np.asarray(
    [
        (0, 0, 0, 0),          # no data / outside Paris
        (255, 201, 51, 235),    # robustly clear
        (0, 0, 0, 0),           # sensitive
        (0, 0, 0, 0),           # grazing / uncertain
        (0, 0, 0, 0),           # blocked or local obstacle
    ],
    dtype=np.uint8,
)

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
    projected: list[list[list[tuple[float, float]]]] = []
    for polygon in polygon_groups(feature["geometry"]):
        projected_polygon: list[list[tuple[float, float]]] = []
        for ring in polygon:
            projected_polygon.append([transformer.transform(lon, lat) for lon, lat in ring])
        projected.append(projected_polygon)
    return projected


def snapped_floor(value: float, step: float) -> float:
    return math.floor(value / step) * step


def snapped_ceil(value: float, step: float) -> float:
    return math.ceil(value / step) * step


def build_grid(feature: dict[str, Any], resolution: float) -> GridDefinition:
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

    center_lon = 2.3522
    center_lat = 48.8566
    endpoint_lon, endpoint_lat, _ = Geod(ellps="WGS84").fwd(
        center_lon,
        center_lat,
        SUN_AZIMUTH_DEGREES,
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
        output.west + ray_east * SUNWARD_HALO_METERS - LATERAL_HALO_METERS,
        resolution,
    )
    input_east = snapped_ceil(output.east + LATERAL_HALO_METERS, resolution)
    # The linear pass keeps predecessors for the complete west-east span.  Its
    # northward digital rays therefore need a matching northern halo even when
    # distant obstacles have already fallen far below the solar ray.
    total_horizontal_span = input_east - input_west
    required_north_span = total_horizontal_span * ray_north / -ray_east
    input_north = snapped_ceil(
        output.north + required_north_span + LATERAL_HALO_METERS,
        resolution,
    )
    input_south = snapped_floor(output.south - LATERAL_HALO_METERS, resolution)
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
        true_solar_azimuth_degrees=SUN_AZIMUTH_DEGREES,
        grid_solar_azimuth_degrees=grid_azimuth,
        grid_ray_east_component=ray_east,
        grid_ray_north_component=ray_north,
    )


def grid_as_json(grid: GridDefinition) -> dict[str, Any]:
    value = asdict(grid)
    value["output_rows"] = list(grid.output_rows)
    value["output_columns"] = list(grid.output_columns)
    return value


def download_wms_raster(
    layer: str,
    destination: Path,
    state_path: Path,
    grid: GridDefinition,
    chunk_size: int,
) -> None:
    signature = {
        "layer": layer,
        "grid": grid_as_json(grid),
        "chunk_size": chunk_size,
    }
    state: dict[str, Any] = {"signature": signature, "completed": []}
    if state_path.exists():
        state = json.loads(state_path.read_text(encoding="utf-8"))
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
    chunks = [
        (row, column)
        for row in range(0, grid.height, chunk_size)
        for column in range(0, grid.width, chunk_size)
    ]
    last_request_at = 0.0

    for index, (row, column) in enumerate(chunks, start=1):
        key = f"{row}:{column}"
        if key in completed:
            continue
        chunk_height = min(chunk_size, grid.height - row)
        chunk_width = min(chunk_size, grid.width - column)
        left = grid.input_bounds.west + column * grid.resolution_meters
        right = left + chunk_width * grid.resolution_meters
        top = grid.input_bounds.north - row * grid.resolution_meters
        bottom = top - chunk_height * grid.resolution_meters
        parameters = {
            "SERVICE": "WMS",
            "VERSION": "1.3.0",
            "REQUEST": "GetMap",
            "LAYERS": layer,
            "STYLES": "normal",
            "CRS": grid.crs,
            "BBOX": f"{left},{bottom},{right},{top}",
            "WIDTH": str(chunk_width),
            "HEIGHT": str(chunk_height),
            "FORMAT": "image/x-bil;bits=32",
        }
        url = f"{IGN_WMS_URL}?{urllib.parse.urlencode(parameters)}"

        expected_size = chunk_height * chunk_width * 4
        payload: bytes | None = None
        for attempt in range(5):
            delay = 1.05 - (time.monotonic() - last_request_at)
            if delay > 0:
                time.sleep(delay)
            request = urllib.request.Request(
                url,
                headers={"User-Agent": "eclipse-2026-lidar-pipeline/1.0"},
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
                break
            except Exception as error:
                if attempt == 4:
                    raise RuntimeError(f"IGN WMS request failed for chunk {key}") from error
                time.sleep(2 ** attempt)

        assert payload is not None
        values = np.frombuffer(payload, dtype="<f4").reshape(chunk_height, chunk_width)
        raster[row : row + chunk_height, column : column + chunk_width] = values
        raster.flush()
        completed.add(key)
        state["completed"] = sorted(completed)
        write_json(state_path, state)
        print(
            f"{destination.stem}: bloc {index}/{len(chunks)} "
            f"({100 * len(completed) / len(chunks):.0f} %)",
            flush=True,
        )


def rasterize_paris_mask(
    feature: dict[str, Any],
    grid: GridDefinition,
) -> np.ndarray:
    to_lambert = Transformer.from_crs("EPSG:4326", grid.crs, always_xy=True)
    projected = project_boundary(feature, to_lambert)
    row_start, row_stop = grid.output_rows
    column_start, column_stop = grid.output_columns
    output_width = column_stop - column_start
    output_height = row_stop - row_start
    image = Image.new("L", (output_width, output_height), 0)
    draw = ImageDraw.Draw(image)

    def pixel(point: tuple[float, float]) -> tuple[float, float]:
        x, y = point
        return (
            (x - grid.output_bounds.west) / grid.resolution_meters,
            (grid.output_bounds.north - y) / grid.resolution_meters,
        )

    for polygon in projected:
        draw.polygon([pixel(point) for point in polygon[0]], fill=255)
        for hole in polygon[1:]:
            draw.polygon([pixel(point) for point in hole], fill=0)
    return np.asarray(image, dtype=np.uint8) > 0


def classify_paris(
    data_dir: Path,
    feature: dict[str, Any],
    grid: GridDefinition,
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

    water_planes = estimate_water_planes(mnt)
    print(
        "Plans d’eau estimés : "
        + ", ".join(f"{plane:.2f} m NGF" for plane in water_planes),
        flush=True,
    )
    deck = detect_deck_cells(mnt, mns, water_planes)
    print(f"Tabliers détectés : {int(deck.sum())} cellules", flush=True)

    classes = classify_visibility(
        mnt,
        mns,
        RasterGeometry(
            pixel_east_meters=grid.resolution_meters,
            pixel_north_meters=grid.resolution_meters,
        ),
        SolarGeometry(
            azimuth_degrees=SUN_AZIMUTH_DEGREES,
            grid_azimuth_degrees=grid.grid_solar_azimuth_degrees,
            altitude_degrees=SUN_APPARENT_ALTITUDE_DEGREES,
            angular_radius_degrees=SUN_ANGULAR_RADIUS_DEGREES,
            model_margin_degrees=MODEL_MARGIN_DEGREES,
        ),
        slice(*grid.output_rows),
        slice(*grid.output_columns),
        observer_height_meters=OBSERVER_HEIGHT_METERS,
        deck=deck,
        progress=progress,
    )
    classes[~rasterize_paris_mask(feature, grid)] = CLASS_NO_DATA
    class_path = data_dir / "paris-visibility-classes.npy"
    np.save(class_path, classes)
    counts = np.bincount(classes.ravel(), minlength=len(CLASS_COLORS))
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
                "timeUtc": MAXIMUM_UTC,
                "azimuthDegrees": SUN_AZIMUTH_DEGREES,
                "apparentAltitudeDegrees": SUN_APPARENT_ALTITUDE_DEGREES,
                "angularRadiusDegrees": SUN_ANGULAR_RADIUS_DEGREES,
                "modelMarginDegrees": MODEL_MARGIN_DEGREES,
            },
            "deck": {
                "waterPlanesMeters": [round(float(p), 3) for p in water_planes],
                "cells": int(deck.sum()),
            },
        },
    )
    print(f"Classification écrite dans {class_path}", flush=True)
    return class_path


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
) -> None:
    source_classes = np.load(class_path)
    clear = source_classes == CLASS_CLEAR
    # Never paint outside the dataset: dilation must not bleed into the cells
    # that carry no estimate at all.
    inside = source_classes != CLASS_NO_DATA
    to_lambert = Transformer.from_crs("EPSG:4326", grid.crs, always_xy=True)
    coverage = grid_wgs84_bounds(grid)
    destination.mkdir(parents=True, exist_ok=True)
    tile_count = 0
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
                rgba = CLASS_COLORS[codes]
                tile_path = destination / str(zoom) / str(tile_x) / f"{tile_y}.png"
                tile_path.parent.mkdir(parents=True, exist_ok=True)
                Image.fromarray(rgba, mode="RGBA").save(
                    tile_path,
                    format="PNG",
                    optimize=True,
                    compress_level=9,
                )
                tile_count += 1
        print(f"Tuiles zoom {zoom} terminées", flush=True)

    classification = json.loads(
        (class_path.parent / "classification.json").read_text(encoding="utf-8")
    )
    manifest = {
        "id": "paris-maximum-geometry",
        "version": DATASET_VERSION,
        "generatedAt": datetime.now(UTC).isoformat(),
        "reference": {
            "mode": "fixed-instant",
            "timeUtc": MAXIMUM_UTC,
            "label": "Paris uniquement · maximum à 20:17",
        },
        "coverage": asdict(coverage),
        "surface": {
            "resolutionMeters": grid.resolution_meters,
            "observerHeightMeters": OBSERVER_HEIGHT_METERS,
            "includesBuildings": True,
            "includesVegetation": True,
            "sourceAcquisitionDate": "2023-03-03",
            "sourceEditionDate": "2025-06-06",
        },
        "tiles": {
            "scheme": "xyz",
            "tileSize": 256,
            "minZoom": min_zoom,
            "maxZoom": max_zoom,
            "count": tile_count,
            "renderDilationMetersByZoom": {
                str(zoom): round(cells * grid.resolution_meters, 1)
                for zoom, cells in sorted(dilation_by_zoom.items())
            },
        },
        "classification": classification,
        "attribution": ATTRIBUTION,
        "license": "https://www.etalab.gouv.fr/licence-ouverte-open-licence/",
        "limitations": [
            "Le modèle ne prédit pas les nuages.",
            "Le MNS parisien a été acquis en mars 2023 et peut sous-estimer le feuillage d’août.",
            "La couche ne garantit pas que le pixel soit accessible au public.",
            "La résolution de calcul est dérivée à 2 m du LiDAR HD IGN à 50 cm.",
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
    print(f"{tile_count} tuiles écrites dans {destination}", flush=True)


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--stage",
        choices=("all", "download", "classify", "tiles"),
        default="all",
    )
    parser.add_argument("--resolution", type=float, default=2.0)
    parser.add_argument("--chunk-size", type=int, default=2_000)
    parser.add_argument("--min-zoom", type=int, default=13)
    parser.add_argument("--max-zoom", type=int, default=16)
    parser.add_argument("--data-dir", type=Path, default=Path("data/lidar/paris"))
    parser.add_argument(
        "--public-dir",
        type=Path,
        default=Path("public/visibility") / DATASET_VERSION,
    )
    return parser.parse_args()


def main() -> None:
    arguments = parse_arguments()
    if arguments.resolution <= 0:
        raise ValueError("Resolution must be positive")
    if arguments.chunk_size <= 0 or arguments.chunk_size > 4_000:
        raise ValueError("Chunk size must be between 1 and 4000")
    if arguments.min_zoom > arguments.max_zoom:
        raise ValueError("Minimum zoom must not exceed maximum zoom")

    boundary_path = arguments.data_dir / "paris-boundary.geojson"
    boundary = load_boundary(boundary_path)
    grid = build_grid(boundary, arguments.resolution)
    grid_path = arguments.data_dir / "grid.json"
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

    if arguments.stage in ("all", "download"):
        download_wms_raster(
            MNT_LAYER,
            arguments.data_dir / "mnt.f32",
            arguments.data_dir / "mnt-download.json",
            grid,
            arguments.chunk_size,
        )
        download_wms_raster(
            MNS_LAYER,
            arguments.data_dir / "mns.f32",
            arguments.data_dir / "mns-download.json",
            grid,
            arguments.chunk_size,
        )
    class_path = arguments.data_dir / "paris-visibility-classes.npy"
    if arguments.stage in ("all", "classify"):
        class_path = classify_paris(arguments.data_dir, boundary, grid)
    if arguments.stage in ("all", "tiles"):
        if not class_path.exists():
            raise FileNotFoundError(f"Run the classify stage first: {class_path}")
        generate_tiles(
            class_path,
            arguments.public_dir,
            grid,
            arguments.min_zoom,
            arguments.max_zoom,
        )


if __name__ == "__main__":
    main()
