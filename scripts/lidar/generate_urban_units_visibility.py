#!/usr/bin/env python3
"""Run the resumable 5 m generator for the top-20 urban units outside Paris."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any, Callable, Iterable


SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parents[1]
CATALOG_PATH = SCRIPT_DIR / "urban_units_top20.json"
GENERATOR = SCRIPT_DIR / "generate_paris_visibility.py"
REGION_DIR = SCRIPT_DIR / "regions"
PIPELINE_STAGES = ("prepare", "download", "classify", "tiles")
SAFE_JOBS = {
    "prepare": 4,
    "download": 2,
    "classify": 1,
    "tiles": 1,
}

Unit = dict[str, Any]
StageRunner = Callable[
    [list[Unit], str, argparse.Namespace],
    tuple[list[Unit], list[str]],
]


def load_units() -> list[Unit]:
    catalog = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    return [unit for unit in catalog["units"] if not unit.get("existingCoverage")]


def select_units(requested: list[str] | None) -> list[Unit]:
    units = load_units()
    if not requested:
        return units
    by_key = {
        key: unit
        for unit in units
        for key in (
            str(unit["code"]),
            str(unit["slug"]),
            f"uu-{unit['code']}",
            f"uu-{unit['slug']}",
        )
    }
    unknown = [value for value in requested if value not in by_key]
    if unknown:
        raise ValueError("Unknown urban units: " + ", ".join(unknown))
    selected: list[Unit] = []
    seen: set[str] = set()
    for value in requested:
        unit = by_key[value]
        code = str(unit["code"])
        if code not in seen:
            seen.add(code)
            selected.append(unit)
    return selected


def pipeline_stages(requested_stage: str) -> tuple[str, ...]:
    if requested_stage == "all":
        return PIPELINE_STAGES
    if requested_stage not in SAFE_JOBS:
        raise ValueError(f"Unknown pipeline stage: {requested_stage}")
    return (requested_stage,)


def stage_worker_count(stage: str, requested_jobs: int, unit_count: int) -> int:
    if stage not in SAFE_JOBS:
        raise ValueError(f"Unknown pipeline stage: {stage}")
    return max(1, min(requested_jobs, SAFE_JOBS[stage], unit_count))


def validate_region_config(unit: Unit) -> Path:
    config = REGION_DIR / f"uu-{unit['slug']}.json"
    raw = json.loads(config.read_text(encoding="utf-8"))
    expected_id = f"uu-{unit['code']}"
    expected_version = f"{expected_id}-2026-max-v1"
    if raw.get("id") != expected_id or raw.get("datasetVersion") != expected_version:
        raise ValueError(
            f"{config.name} must use id {expected_id!r} and "
            f"datasetVersion {expected_version!r}"
        )
    return config


def run_unit(unit: Unit, stage: str, arguments: argparse.Namespace) -> None:
    config = validate_region_config(unit)
    command = [
        sys.executable,
        str(GENERATOR),
        "--region-config", str(config),
        "--stage", stage,
    ]
    if stage == "download":
        command.extend(["--download-raster", arguments.download_raster])
    print(
        f"\n=== #{unit['rank']} {unit['label']} · {stage} ===",
        flush=True,
    )
    subprocess.run(command, cwd=PROJECT_ROOT, check=True)


def run_stage(
    units: list[Unit],
    stage: str,
    arguments: argparse.Namespace,
    *,
    runner: Callable[[Unit, str, argparse.Namespace], None] = run_unit,
) -> tuple[list[Unit], list[str]]:
    """Run one global stage and wait for every region before returning."""

    if not units:
        return [], []
    successes: list[Unit] = []
    failures: list[str] = []
    workers = stage_worker_count(stage, arguments.jobs, len(units))
    print(
        f"\n--- Étape {stage} · {len(units)} région(s) · {workers} job(s) ---",
        flush=True,
    )
    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = {executor.submit(runner, unit, stage, arguments): unit for unit in units}
        for future in as_completed(futures):
            unit = futures[future]
            try:
                future.result()
                successes.append(unit)
            except subprocess.CalledProcessError as error:
                failures.append(
                    f"{unit['label']} · {stage} (exit {error.returncode})"
                )
            except Exception as error:  # keep unrelated regions running
                failures.append(f"{unit['label']} · {stage} ({error})")
    successful_codes = {str(unit["code"]) for unit in successes}
    # Preserve catalog/rank order even though futures complete out of order.
    return (
        [unit for unit in units if str(unit["code"]) in successful_codes],
        failures,
    )


def run_pipeline(
    units: list[Unit],
    arguments: argparse.Namespace,
    *,
    stage_runner: StageRunner = run_stage,
) -> tuple[list[Unit], list[str]]:
    """Run stage barriers, removing only failed regions from later stages."""

    active_units = list(units)
    failures: list[str] = []
    for stage in pipeline_stages(arguments.stage):
        active_units, stage_failures = stage_runner(active_units, stage, arguments)
        failures.extend(stage_failures)
        if not active_units:
            break
    return active_units, failures


def parse_arguments(arguments: Iterable[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--stage",
        choices=("all", *PIPELINE_STAGES),
        default="all",
    )
    parser.add_argument(
        "--units",
        nargs="+",
        help="Codes or slugs to run; defaults to all 19 units outside Paris",
    )
    parser.add_argument(
        "--jobs",
        type=int,
        default=4,
        help=(
            "Requested concurrency ceiling (default: 4); safety caps are "
            "prepare=4, download=2, classify=1 and tiles=1"
        ),
    )
    parser.add_argument(
        "--download-raster",
        choices=("all", "mnt", "mns"),
        default="all",
    )
    return parser.parse_args(arguments)


def main() -> None:
    arguments = parse_arguments()
    if arguments.jobs < 1:
        raise ValueError("Jobs must be positive")
    units = select_units(arguments.units)
    completed, failures = run_pipeline(units, arguments)
    if failures:
        print("\nÉchecs isolés :\n- " + "\n- ".join(failures), file=sys.stderr)
        raise SystemExit(1)
    print(f"\n{len(completed)} unité(s) urbaine(s) terminée(s).", flush=True)


if __name__ == "__main__":
    main()
