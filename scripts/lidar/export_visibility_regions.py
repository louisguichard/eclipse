#!/usr/bin/env python3
"""Export the published urban-unit manifests as a deterministic TS catalogue.

The heavy raster outputs stay outside Git, while the small front-end contract
generated here is committed.  The exporter deliberately cross-checks the
INSEE catalogue, each regional pipeline config and its published manifest so a
stale version or an accidental code/slug mismatch cannot silently reach the
application.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_CATALOG = Path(__file__).with_name("urban_units_top20.json")
DEFAULT_REGIONS_DIR = Path(__file__).with_name("regions")
DEFAULT_PUBLISH_DIR = PROJECT_ROOT / "data" / "lidar" / "publish"
DEFAULT_OUTPUT = PROJECT_ROOT / "src" / "config" / "visibility-regions.generated.ts"


def read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as error:
        raise ValueError(f"Missing visibility catalogue input: {path}") from error
    if not isinstance(value, dict):
        raise ValueError(f"Expected a JSON object in {path}")
    return value


def require_object(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError(f"Expected {label} to be an object")
    return value


def require_number(value: Any, label: str) -> int | float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"Expected {label} to be a number")
    return value


def require_string(value: Any, label: str) -> str:
    if not isinstance(value, str) or not value:
        raise ValueError(f"Expected {label} to be a non-empty string")
    return value


def extract_coverage(manifest: dict[str, Any], version: str) -> dict[str, int | float]:
    source = require_object(manifest.get("coverage"), f"{version}.coverage")
    coverage = {
        direction: require_number(source.get(direction), f"{version}.coverage.{direction}")
        for direction in ("north", "south", "east", "west")
    }
    if coverage["north"] <= coverage["south"]:
        raise ValueError(f"Invalid north/south coverage in {version}")
    if coverage["east"] <= coverage["west"]:
        raise ValueError(f"Invalid east/west coverage in {version}")
    return coverage


def load_visibility_regions(
    catalog_path: Path = DEFAULT_CATALOG,
    regions_dir: Path = DEFAULT_REGIONS_DIR,
    publish_dir: Path = DEFAULT_PUBLISH_DIR,
) -> list[dict[str, Any]]:
    """Load and validate front-end metadata in INSEE rank order."""

    catalog = read_json(catalog_path)
    units = catalog.get("units")
    if not isinstance(units, list):
        raise ValueError(f"Expected units to be an array in {catalog_path}")

    selected: list[dict[str, Any]] = []
    seen_codes: set[str] = set()
    seen_ranks: set[int] = set()

    for raw_unit in units:
        unit = require_object(raw_unit, "catalogue unit")
        if unit.get("existingCoverage"):
            continue

        rank = unit.get("rank")
        if isinstance(rank, bool) or not isinstance(rank, int) or rank < 1:
            raise ValueError("Every urban unit must have a positive integer rank")
        code = require_string(unit.get("code"), f"rank {rank} code")
        slug = require_string(unit.get("slug"), f"urban unit {code} slug")
        name = require_string(unit.get("label"), f"urban unit {code} label")
        if code in seen_codes or rank in seen_ranks:
            raise ValueError(f"Duplicate urban-unit code or rank: {code} / {rank}")
        seen_codes.add(code)
        seen_ranks.add(rank)

        expected_id = f"uu-{code}"
        expected_version = f"{expected_id}-2026-max-v1"
        config_path = regions_dir / f"uu-{slug}.json"
        config = read_json(config_path)
        if config.get("id") != expected_id:
            raise ValueError(f"{config_path} must use id {expected_id}")
        if config.get("datasetVersion") != expected_version:
            raise ValueError(f"{config_path} must use version {expected_version}")
        if config.get("resolutionMeters") != 5:
            raise ValueError(f"{config_path} must use a 5 m calculation grid")

        manifest_path = publish_dir / expected_version / "manifest.json"
        manifest = read_json(manifest_path)
        expected_manifest_id = f"{expected_id}-maximum-geometry"
        if manifest.get("id") != expected_manifest_id:
            raise ValueError(f"{manifest_path} must use id {expected_manifest_id}")
        if manifest.get("version") != expected_version:
            raise ValueError(f"{manifest_path} must use version {expected_version}")

        reference = require_object(
            manifest.get("reference"), f"{expected_version}.reference"
        )
        reference_mode = require_string(
            reference.get("mode"), f"{expected_version}.reference.mode"
        )
        if reference_mode not in ("fixed-instant", "local-maximum"):
            raise ValueError(f"Unsupported reference mode in {expected_version}")
        reference_export: dict[str, str] = {
            "mode": reference_mode,
            "label": require_string(
                reference.get("label"), f"{expected_version}.reference.label"
            ),
        }
        if reference.get("timeUtc") is not None:
            reference_export["timeUtc"] = require_string(
                reference.get("timeUtc"), f"{expected_version}.reference.timeUtc"
            )

        surface = require_object(manifest.get("surface"), f"{expected_version}.surface")
        resolution = require_number(
            surface.get("resolutionMeters"),
            f"{expected_version}.surface.resolutionMeters",
        )
        if resolution != 5:
            raise ValueError(f"{manifest_path} must describe a 5 m surface")
        source_tiers = surface.get("sourceTiers")
        if not isinstance(source_tiers, list) or not all(
            isinstance(item, str) and item for item in source_tiers
        ):
            raise ValueError(f"Expected source tiers in {expected_version}")

        halo = require_object(manifest.get("halo"), f"{expected_version}.halo")
        halo_capped = halo.get("capped")
        if not isinstance(halo_capped, bool):
            raise ValueError(f"Expected {expected_version}.halo.capped to be a boolean")
        halo_sunward_meters = require_number(
            halo.get("sunward_meters"),
            f"{expected_version}.halo.sunward_meters",
        )
        if halo_sunward_meters <= 0:
            raise ValueError(f"Expected a positive sunward halo in {expected_version}")

        tiles = require_object(manifest.get("tiles"), f"{expected_version}.tiles")
        if tiles.get("scheme") != "xyz" or tiles.get("tileSize") != 256:
            raise ValueError(f"{expected_version} must use 256 px XYZ tiles")
        min_zoom = tiles.get("minZoom")
        max_zoom = tiles.get("maxZoom")
        if min_zoom != config.get("minZoom") or max_zoom != config.get("maxZoom"):
            raise ValueError(f"Tile zooms disagree between {config_path} and {manifest_path}")

        selected.append({
            "rank": rank,
            "code": code,
            "slug": slug,
            "name": name,
            "id": expected_manifest_id,
            "version": expected_version,
            "label": require_string(config.get("label"), f"{config_path} label"),
            "sourceNotes": require_string(
                config.get("sourceNotes"), f"{config_path} sourceNotes"
            ),
            # Coverage must remain the exact WGS84 raster envelope published by
            # the tile generator, rather than an approximation from INSEE data.
            "coverage": extract_coverage(manifest, expected_version),
            "reference": reference_export,
            "surface": {
                "resolutionMeters": resolution,
                "observerHeightMeters": require_number(
                    surface.get("observerHeightMeters"),
                    f"{expected_version}.surface.observerHeightMeters",
                ),
                "includesBuildings": surface.get("includesBuildings") is True,
                "includesVegetation": surface.get("includesVegetation") is True,
                "generatedAt": require_string(
                    manifest.get("generatedAt"), f"{expected_version}.generatedAt"
                ),
                "sourceTiers": source_tiers,
            },
            "halo": {
                "capped": halo_capped,
                "sunwardMeters": halo_sunward_meters,
            },
            "tiles": {
                "scheme": "xyz",
                "tileSize": 256,
                "minZoom": min_zoom,
                "maxZoom": max_zoom,
            },
            "attribution": require_string(
                manifest.get("attribution"), f"{expected_version}.attribution"
            ),
        })

    selected.sort(key=lambda region: region["rank"])
    if not selected:
        raise ValueError("No new urban-unit coverage found in the catalogue")
    return selected


def render_typescript(regions: list[dict[str, Any]]) -> str:
    payload = json.dumps(regions, ensure_ascii=False, indent=2, allow_nan=False)
    return (
        "// Generated by scripts/lidar/export_visibility_regions.py.\n"
        "// Do not edit by hand; regenerate it from the published manifests.\n\n"
        f"export const URBAN_UNIT_VISIBILITY_REGIONS = {payload} as const\n"
    )


def write_catalogue(output: Path, content: str, check: bool = False) -> None:
    if check:
        try:
            current = output.read_text(encoding="utf-8")
        except FileNotFoundError as error:
            raise ValueError(f"Generated catalogue is missing: {output}") from error
        if current != content:
            raise ValueError(
                f"Generated catalogue is stale: run {Path(__file__).name}"
            )
        return

    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(f"{output.suffix}.tmp")
    temporary.write_text(content, encoding="utf-8")
    temporary.replace(output)


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalog", type=Path, default=DEFAULT_CATALOG)
    parser.add_argument("--regions-dir", type=Path, default=DEFAULT_REGIONS_DIR)
    parser.add_argument("--publish-dir", type=Path, default=DEFAULT_PUBLISH_DIR)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument(
        "--check",
        action="store_true",
        help="Fail if the committed generated file differs from the inputs.",
    )
    return parser.parse_args()


def main() -> None:
    arguments = parse_arguments()
    regions = load_visibility_regions(
        arguments.catalog,
        arguments.regions_dir,
        arguments.publish_dir,
    )
    write_catalogue(arguments.output, render_typescript(regions), arguments.check)
    action = "Validated" if arguments.check else "Exported"
    print(f"{action} {len(regions)} urban-unit visibility regions: {arguments.output}")


if __name__ == "__main__":
    main()
