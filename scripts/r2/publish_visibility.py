#!/usr/bin/env python3
"""Publish one immutable visibility dataset to Cloudflare R2 via the AWS CLI.

Credentials are read from process environment variables only. They are never
accepted as command-line arguments, written to disk, or exposed to Vite.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse


DEFAULT_DATASET = Path("public/visibility/paris-2026-max-v1")
DEFAULT_OBJECT_PREFIX = "visibility"
DEFAULT_ENV_FILE = Path(".env.r2.local")
IMMUTABLE_CACHE_CONTROL = "public,max-age=31536000,immutable"


class ConfigurationError(RuntimeError):
    """Raised before any upload when the local or R2 configuration is unsafe."""


@dataclass(frozen=True)
class Dataset:
    source: Path
    version: str
    tile_count: int
    total_bytes: int


def load_environment_file(path: Path) -> dict[str, str]:
    """Read a small KEY=VALUE file without evaluating shell syntax."""

    if not path.exists():
        return {}
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError as error:
        raise ConfigurationError(f"Cannot read private environment file: {path}") from error
    values: dict[str, str] = {}
    for line_number, raw_line in enumerate(lines, 1):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line.removeprefix("export ").strip()
        if "=" not in line:
            raise ConfigurationError(f"Invalid line {line_number} in {path}")
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if not key.replace("_", "").isalnum() or not key[0].isalpha():
            raise ConfigurationError(f"Invalid variable name on line {line_number} in {path}")
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
            value = value[1:-1]
        values[key] = value
    return values


def clean_path_segment(value: str, label: str) -> str:
    cleaned = value.strip().strip("/")
    if not cleaned or cleaned in {".", ".."} or ".." in cleaned.split("/"):
        raise ConfigurationError(f"Invalid {label}: {value!r}")
    return cleaned


def load_dataset(source: Path) -> Dataset:
    source = source.resolve()
    manifest_path = source / "manifest.json"
    if not manifest_path.is_file():
        raise ConfigurationError(f"Missing dataset manifest: {manifest_path}")
    if manifest_path.is_symlink():
        raise ConfigurationError(f"Dataset manifest must not be a symlink: {manifest_path}")
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ConfigurationError(f"Invalid dataset manifest: {manifest_path}") from error

    version = clean_path_segment(str(manifest.get("version", "")), "dataset version")
    if "/" in version:
        raise ConfigurationError("Dataset version must be one directory segment")
    if source.name != version:
        raise ConfigurationError(
            f"Dataset directory {source.name!r} does not match manifest version {version!r}"
        )

    tile_paths = sorted(source.glob("*/*/*.png"))
    if not tile_paths:
        raise ConfigurationError(f"Dataset contains no PNG tiles: {source}")
    if any(path.is_symlink() for path in tile_paths):
        raise ConfigurationError("Dataset tiles must not be symbolic links")
    expected_count = manifest.get("tiles", {}).get("count")
    if expected_count != len(tile_paths):
        raise ConfigurationError(
            f"Manifest announces {expected_count!r} tiles but {len(tile_paths)} PNG files exist"
        )
    files = [manifest_path, *tile_paths]
    return Dataset(
        source=source,
        version=version,
        tile_count=len(tile_paths),
        total_bytes=sum(path.stat().st_size for path in files),
    )


def r2_endpoint(environment: dict[str, str]) -> str:
    explicit = environment.get("CLOUDFLARE_R2_ENDPOINT", "").strip().rstrip("/")
    account_id = environment.get("CLOUDFLARE_ACCOUNT_ID", "").strip()
    endpoint = explicit or (
        f"https://{account_id}.r2.cloudflarestorage.com" if account_id else ""
    )
    parsed = urlparse(endpoint)
    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or not parsed.hostname.endswith(".r2.cloudflarestorage.com")
        or parsed.username is not None
        or parsed.password is not None
        or parsed.port is not None
        or parsed.path not in {"", "/"}
        or parsed.query
        or parsed.fragment
    ):
        raise ConfigurationError(
            "Set CLOUDFLARE_ACCOUNT_ID or a valid CLOUDFLARE_R2_ENDPOINT "
            "ending in .r2.cloudflarestorage.com"
        )
    return endpoint


def build_sync_command(
    dataset: Dataset,
    bucket: str,
    object_prefix: str,
    endpoint: str,
    dry_run: bool,
) -> list[str]:
    bucket = clean_path_segment(bucket, "bucket name")
    if "/" in bucket:
        raise ConfigurationError("Bucket name must not contain a slash")
    object_prefix = clean_path_segment(object_prefix, "object prefix")
    destination = f"s3://{bucket}/{object_prefix}/{dataset.version}/"
    command = [
        "aws",
        "s3",
        "sync",
        f"{dataset.source}/",
        destination,
        "--endpoint-url",
        endpoint,
        "--region",
        "auto",
        "--exclude",
        "*",
        "--include",
        "*.png",
        "--include",
        "manifest.json",
        "--cache-control",
        IMMUTABLE_CACHE_CONTROL,
        "--no-follow-symlinks",
        "--no-progress",
    ]
    if dry_run:
        command.append("--dryrun")
    else:
        command.append("--only-show-errors")
    return command


def require_upload_environment(environment: dict[str, str]) -> None:
    missing = [
        name
        for name in ("AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY")
        if not environment.get(name, "").strip()
    ]
    if missing:
        raise ConfigurationError(
            "Missing private R2 credentials: " + ", ".join(missing)
        )
    if shutil.which("aws") is None:
        raise ConfigurationError(
            "AWS CLI is not installed. Install it before running the R2 publication."
        )


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=DEFAULT_DATASET)
    parser.add_argument("--env-file", type=Path, default=DEFAULT_ENV_FILE)
    parser.add_argument("--bucket")
    parser.add_argument("--prefix")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument(
        "--plan",
        action="store_true",
        help="validate and print the upload plan without requiring credentials or AWS CLI",
    )
    mode.add_argument(
        "--dry-run",
        action="store_true",
        help="ask AWS CLI to enumerate changes without uploading",
    )
    return parser.parse_args()


def main() -> None:
    arguments = parse_arguments()
    environment = {**load_environment_file(arguments.env_file), **os.environ}
    dataset = load_dataset(arguments.source)
    endpoint = r2_endpoint(environment)
    bucket = arguments.bucket or environment.get(
        "CLOUDFLARE_R2_BUCKET", "eclipse-visibility"
    )
    prefix = arguments.prefix or environment.get(
        "CLOUDFLARE_R2_PREFIX", DEFAULT_OBJECT_PREFIX
    )
    command = build_sync_command(
        dataset,
        bucket,
        prefix,
        endpoint,
        arguments.dry_run,
    )
    destination = command[4]
    print(
        f"Dataset {dataset.version}: {dataset.tile_count} tiles, "
        f"{dataset.total_bytes / 1_000_000:.2f} MB"
    )
    print(f"Destination: {destination}")
    print(f"Cache-Control: {IMMUTABLE_CACHE_CONTROL}")
    if arguments.plan:
        print("Plan valid; no network request was made.")
        return

    require_upload_environment(environment)
    subprocess.run(command, check=True, env={**environment, "AWS_DEFAULT_REGION": "auto"})
    if arguments.dry_run:
        print("Dry run complete; no object was uploaded.")
    else:
        print("Upload complete. Verify the public custom-domain URL before updating Vercel.")


if __name__ == "__main__":
    try:
        main()
    except (ConfigurationError, subprocess.CalledProcessError) as error:
        raise SystemExit(f"R2 publication failed: {error}") from error
