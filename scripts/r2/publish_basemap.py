#!/usr/bin/env python3
"""Publish one immutable PMTiles basemap archive to Cloudflare R2."""

from __future__ import annotations

import argparse
import os
from pathlib import Path
import subprocess

from publish_visibility import (
    ConfigurationError,
    load_environment_file,
    r2_endpoint,
    require_upload_environment,
)


DEFAULT_ARCHIVE = Path("data/basemap/eclipse-2026.pmtiles")
DEFAULT_ENV_FILE = Path(".env.r2.local")
IMMUTABLE_CACHE_CONTROL = "public,max-age=31536000,immutable"


def clean_object_key(value: str) -> str:
    key = value.strip().strip("/")
    if not key or key.startswith(".") or ".." in key.split("/"):
        raise ConfigurationError("The R2 basemap object key is invalid")
    if not key.endswith(".pmtiles"):
        raise ConfigurationError("The R2 basemap object key must end in .pmtiles")
    return key


def validate_archive(path: Path) -> Path:
    if path.is_symlink() or not path.is_file():
        raise ConfigurationError(f"PMTiles archive not found: {path}")
    if path.suffix.lower() != ".pmtiles":
        raise ConfigurationError("The basemap archive must have a .pmtiles suffix")
    if path.stat().st_size < 127:
        raise ConfigurationError("The basemap archive is too small to be a valid PMTiles file")
    return path


def build_upload_command(
    archive: Path,
    bucket: str,
    object_key: str,
    endpoint: str,
    dry_run: bool,
) -> list[str]:
    clean_bucket = bucket.strip()
    if not clean_bucket or "/" in clean_bucket:
        raise ConfigurationError("The R2 bucket name is invalid")
    command = [
        "aws",
        "s3",
        "cp",
        str(archive),
        f"s3://{clean_bucket}/{clean_object_key(object_key)}",
        "--endpoint-url",
        endpoint,
        "--region",
        "auto",
        "--content-type",
        "application/vnd.pmtiles",
        "--cache-control",
        IMMUTABLE_CACHE_CONTROL,
        "--no-progress",
    ]
    if dry_run:
        command.append("--dryrun")
    else:
        command.append("--only-show-errors")
    return command


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path, default=DEFAULT_ARCHIVE)
    parser.add_argument("--env-file", type=Path, default=DEFAULT_ENV_FILE)
    parser.add_argument("--bucket")
    parser.add_argument("--key")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--plan", action="store_true")
    mode.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def main() -> None:
    arguments = parse_arguments()
    archive = validate_archive(arguments.archive)
    environment = {**load_environment_file(arguments.env_file), **os.environ}
    endpoint = r2_endpoint(environment)
    bucket = arguments.bucket or environment.get(
        "CLOUDFLARE_R2_BUCKET", "eclipse-visibility"
    )
    object_key = arguments.key or environment.get(
        "CLOUDFLARE_R2_BASEMAP_KEY", "basemap/eclipse-2026-v1.pmtiles"
    )
    command = build_upload_command(
        archive,
        bucket,
        object_key,
        endpoint,
        arguments.dry_run,
    )
    destination = command[4]
    print(f"Archive: {archive} ({archive.stat().st_size / 1_000_000:.2f} MB)")
    print(f"Destination: {destination}")
    print(f"Cache-Control: {IMMUTABLE_CACHE_CONTROL}")
    if arguments.plan:
        print("Plan valid; no network request was made.")
        return

    require_upload_environment(environment)
    subprocess.run(command, check=True, env={**environment, "AWS_DEFAULT_REGION": "auto"})
    print("Dry run complete; no object was uploaded." if arguments.dry_run else "Upload complete.")


if __name__ == "__main__":
    try:
        main()
    except (ConfigurationError, subprocess.CalledProcessError) as error:
        raise SystemExit(f"R2 basemap publication failed: {error}") from error
