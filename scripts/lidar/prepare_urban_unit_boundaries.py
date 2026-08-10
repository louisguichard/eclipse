#!/usr/bin/env python3
"""Build precise top-20 urban-unit boundaries from two pinned official sources.

INSEE defines the commune composition of every 2020 urban unit.  Its national
cartographic layer is deliberately generalised, though, so it cannot be used as
a five-metre raster mask.  This script joins that composition to Etalab's 2026
five-metre commune contours and writes one FeatureCollection per urban unit.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import shutil
import unicodedata
import urllib.request
from io import BytesIO
from pathlib import Path
from typing import Any
from zipfile import ZipFile

import ijson
import shapefile


SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent.parent
DEFAULT_CATALOG = SCRIPT_DIR / "urban_units_top20.json"
DEFAULT_ARCHIVE = PROJECT_ROOT / "data/lidar/sources/fonds_uu2020_2026.zip"
DEFAULT_BOUNDARY_ARCHIVE = (
    PROJECT_ROOT / "data/lidar/sources/communes-5m-2026.geojson.gz"
)
DEFAULT_OUTPUT_DIR = PROJECT_ROOT / "data/lidar/urban-units/boundaries"
UNIT_INNER_ARCHIVE = "uu2020_2026.zip"
UNIT_SHAPEFILE_STEM = "uu2020_2026"
COMPOSITION_INNER_ARCHIVE = "com_uu2020_2026.zip"
COMPOSITION_SHAPEFILE_STEM = "com_uu2020_2026"


def write_json_atomic(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(f"{path.suffix}.tmp")
    temporary.write_text(
        json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    temporary.replace(path)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def download_atomic(url: str, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(f"{destination.suffix}.tmp")
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "eclipse-2026-urban-unit-boundaries/1.0"},
    )
    try:
        with urllib.request.urlopen(request, timeout=180) as response:
            with temporary.open("wb") as target:
                shutil.copyfileobj(response, target)
        temporary.replace(destination)
    finally:
        temporary.unlink(missing_ok=True)


def read_catalog(path: Path) -> dict[str, Any]:
    catalog = json.loads(path.read_text(encoding="utf-8"))
    codes = [str(unit["code"]) for unit in catalog["units"]]
    if len(codes) != 20 or len(set(codes)) != 20:
        raise ValueError("The urban-unit catalogue must contain 20 unique codes")
    if [int(unit["rank"]) for unit in catalog["units"]] != list(range(1, 21)):
        raise ValueError("Urban-unit ranks must be consecutive from 1 to 20")
    return catalog


def open_reader(
    archive_path: Path, inner_archive: str, shapefile_stem: str
) -> shapefile.Reader:
    with ZipFile(archive_path) as outer:
        try:
            nested_payload = outer.read(inner_archive)
        except KeyError as error:
            raise ValueError(f"Missing {inner_archive} in {archive_path}") from error
    with ZipFile(BytesIO(nested_payload)) as nested:
        members = {
            suffix: nested.read(f"{shapefile_stem}.{suffix}")
            for suffix in ("shp", "shx", "dbf")
        }
    return shapefile.Reader(
        shp=BytesIO(members["shp"]),
        shx=BytesIO(members["shx"]),
        dbf=BytesIO(members["dbf"]),
        encoding="utf-8",
    )


def normalized_name(value: str) -> str:
    return unicodedata.normalize("NFKC", value).replace("’", "'")


def geometry_points(geometry: dict[str, Any]) -> list[tuple[float, float]]:
    coordinates = geometry.get("coordinates", [])
    polygons = [coordinates] if geometry.get("type") == "Polygon" else coordinates
    return [
        (float(point[0]), float(point[1]))
        for polygon in polygons
        for ring in polygon
        for point in ring
    ]


def copy_source(source: Path, destination: Path) -> None:
    if source.resolve() == destination.resolve():
        return
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(f"{destination.suffix}.tmp")
    shutil.copyfile(source, temporary)
    temporary.replace(destination)


def verify_source(path: Path, source: dict[str, Any], label: str) -> str:
    expected_digest = str(source["sha256"])
    actual_digest = sha256(path)
    if actual_digest != expected_digest:
        raise ValueError(
            f"{label} checksum changed: expected {expected_digest}, "
            f"received {actual_digest}. Review the new geography before "
            "updating the pinned checksum."
        )
    return actual_digest


def load_commune_contours(
    archive_path: Path, wanted_codes: set[str]
) -> dict[str, dict[str, Any]]:
    contours: dict[str, dict[str, Any]] = {}
    duplicates: list[str] = []
    with gzip.open(archive_path, "rb") as source:
        for feature in ijson.items(source, "features.item", use_float=True):
            properties = feature.get("properties", {})
            code = str(properties.get("code", ""))
            if code not in wanted_codes:
                continue
            if code in contours:
                duplicates.append(code)
            else:
                contours[code] = feature
    if duplicates:
        raise ValueError("Duplicate commune contours: " + ", ".join(sorted(duplicates)))
    missing = wanted_codes.difference(contours)
    if missing:
        raise ValueError("Missing commune contours: " + ", ".join(sorted(missing)))
    return contours


def extract_boundaries(
    archive_path: Path,
    boundary_archive_path: Path,
    output_dir: Path,
    catalog: dict[str, Any],
    *,
    include_existing: bool = False,
) -> list[dict[str, Any]]:
    source = catalog["source"]
    boundary_source = catalog["boundarySource"]
    source_digest = verify_source(archive_path, source, "INSEE archive")
    boundary_source_digest = verify_source(
        boundary_archive_path, boundary_source, "Etalab boundary archive"
    )

    unit_reader = open_reader(
        archive_path, UNIT_INNER_ARCHIVE, UNIT_SHAPEFILE_STEM
    )
    unit_records = {
        str(item.record.as_dict()["uu2020"]): item
        for item in unit_reader.iterShapeRecords()
    }
    selected = [
        unit for unit in catalog["units"]
        if include_existing or not unit.get("existingCoverage")
    ]
    missing = [
        str(unit["code"])
        for unit in selected
        if str(unit["code"]) not in unit_records
    ]
    if missing:
        raise ValueError("Missing urban units in INSEE shapefile: " + ", ".join(missing))

    selected_codes = {str(unit["code"]) for unit in selected}
    composition_reader = open_reader(
        archive_path, COMPOSITION_INNER_ARCHIVE, COMPOSITION_SHAPEFILE_STEM
    )
    communes_by_unit: dict[str, list[dict[str, Any]]] = {
        code: [] for code in selected_codes
    }
    for record in composition_reader.iterRecords():
        value = record.as_dict()
        code = str(value["uu2020"])
        if code in communes_by_unit:
            communes_by_unit[code].append(value)
    wanted_commune_codes = {
        str(commune["codgeo"])
        for communes in communes_by_unit.values()
        for commune in communes
    }
    if sum(len(communes) for communes in communes_by_unit.values()) != len(
        wanted_commune_codes
    ):
        raise ValueError("A commune appears in more than one selected urban unit")
    contours = load_commune_contours(boundary_archive_path, wanted_commune_codes)

    output_dir.mkdir(parents=True, exist_ok=True)
    summary: list[dict[str, Any]] = []
    for unit in selected:
        code = str(unit["code"])
        item = unit_records[code]
        record = item.record.as_dict()
        communes = sorted(communes_by_unit[code], key=lambda value: str(value["codgeo"]))
        expected_count = int(record["nb_com"])
        if len(communes) != expected_count:
            raise ValueError(
                f"Urban unit {code} has {len(communes)} communes in the composition "
                f"but {expected_count} in the unit record"
            )
        features: list[dict[str, Any]] = []
        points: list[tuple[float, float]] = []
        for commune in communes:
            commune_code = str(commune["codgeo"])
            contour = contours[commune_code]
            geometry = contour.get("geometry", {})
            if geometry.get("type") not in {"Polygon", "MultiPolygon"}:
                raise ValueError(
                    f"Unsupported geometry for commune {commune_code}: "
                    f"{geometry.get('type')}"
                )
            commune_points = geometry_points(geometry)
            if not commune_points:
                raise ValueError(f"Empty geometry for commune {commune_code}")
            contour_name = str(contour.get("properties", {}).get("nom", ""))
            composition_name = str(commune["libgeo"])
            if normalized_name(contour_name) != normalized_name(composition_name):
                raise ValueError(
                    f"Commune name mismatch for {commune_code}: "
                    f"{composition_name!r} != {contour_name!r}"
                )
            points.extend(commune_points)
            features.append({
                "type": "Feature",
                "properties": {
                    "code": commune_code,
                    "name": contour_name,
                    "urbanUnitCode": code,
                    "urbanUnitName": str(record["libuu2020"]),
                },
                "geometry": geometry,
            })
        west = min(point[0] for point in points)
        south = min(point[1] for point in points)
        east = max(point[0] for point in points)
        north = max(point[1] for point in points)
        if not (-6.0 <= west < east <= 10.0 and 41.0 <= south < north <= 52.0):
            raise ValueError(
                f"Urban unit {code} bounds are not metropolitan EPSG:4326: "
                f"{west}, {south}, {east}, {north}"
            )
        feature_collection = {
            "type": "FeatureCollection",
            "name": f"Unité urbaine 2020 {code} — {record['libuu2020']}",
            "properties": {
                "code": code,
                "name": str(record["libuu2020"]),
                "rank": int(unit["rank"]),
                "type": str(record["type"]),
                "communeCount": expected_count,
                "compositionSource": str(source["label"]),
                "compositionSourceUrl": str(source["url"]),
                "compositionSourceSha256": source_digest,
                "boundarySource": str(boundary_source["label"]),
                "boundarySourceUrl": str(boundary_source["url"]),
                "boundarySourceSha256": boundary_source_digest,
                "boundaryAccuracyMeters": int(boundary_source["accuracyMeters"]),
            },
            "features": features,
        }
        destination = output_dir / f"uu-{unit['slug']}.geojson"
        write_json_atomic(destination, feature_collection)
        summary.append({
            "rank": int(unit["rank"]),
            "code": code,
            "slug": str(unit["slug"]),
            "label": str(unit["label"]),
            "officialLabel": str(record["libuu2020"]),
            "communeCount": expected_count,
            "bounds": {
                "west": west, "south": south,
                "east": east, "north": north,
            },
            "path": str(destination),
        })

    write_json_atomic(
        output_dir / "catalog.json",
        {"source": source, "boundarySource": boundary_source, "units": summary},
    )
    return summary


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalog", type=Path, default=DEFAULT_CATALOG)
    parser.add_argument("--archive", type=Path, default=DEFAULT_ARCHIVE)
    parser.add_argument(
        "--boundary-archive", type=Path, default=DEFAULT_BOUNDARY_ARCHIVE
    )
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument(
        "--source-archive",
        type=Path,
        help="Use an already downloaded archive and cache a verified copy locally",
    )
    parser.add_argument(
        "--source-boundary-archive",
        type=Path,
        help="Use an already downloaded Etalab commune archive and cache it locally",
    )
    parser.add_argument(
        "--include-existing",
        action="store_true",
        help="Also extract Paris even though its coverage already exists",
    )
    return parser.parse_args()


def main() -> None:
    arguments = parse_arguments()
    catalog = read_catalog(arguments.catalog)
    archive = arguments.archive
    if arguments.source_archive:
        copy_source(arguments.source_archive, archive)
    elif not archive.exists():
        print(f"Téléchargement du fond INSEE : {catalog['source']['url']}", flush=True)
        download_atomic(str(catalog["source"]["url"]), archive)
    boundary_archive = arguments.boundary_archive
    if arguments.source_boundary_archive:
        copy_source(arguments.source_boundary_archive, boundary_archive)
    elif not boundary_archive.exists():
        print(
            f"Téléchargement des contours communaux : {catalog['boundarySource']['url']}",
            flush=True,
        )
        download_atomic(str(catalog["boundarySource"]["url"]), boundary_archive)
    boundaries = extract_boundaries(
        archive,
        boundary_archive,
        arguments.output_dir,
        catalog,
        include_existing=arguments.include_existing,
    )
    print(
        f"{len(boundaries)} contours INSEE + Etalab vérifiés dans "
        f"{arguments.output_dir}",
        flush=True,
    )


if __name__ == "__main__":
    main()
