#!/usr/bin/env python3
"""Verify a published visibility dataset through its public R2 custom domain."""

from __future__ import annotations

import argparse
import json
import urllib.error
import urllib.request
from pathlib import Path

from publish_visibility import DEFAULT_DATASET, load_dataset


PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


def fetch(url: str, origin: str) -> tuple[bytes, dict[str, str]]:
    request = urllib.request.Request(
        url,
        headers={
            "Origin": origin,
            "User-Agent": "eclipse-2026-r2-verifier/1.0",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.read(), {key.lower(): value for key, value in response.headers.items()}
    except urllib.error.HTTPError as error:
        raise RuntimeError(f"HTTP {error.code} for {url}") from error


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("base_url", help="for example https://tiles.louisguichard.fr/visibility")
    parser.add_argument("--source", type=Path, default=DEFAULT_DATASET)
    parser.add_argument("--origin", default="https://eclipse.louisguichard.fr")
    return parser.parse_args()


def main() -> None:
    arguments = parse_arguments()
    dataset = load_dataset(arguments.source)
    base_url = arguments.base_url.rstrip("/")
    dataset_url = f"{base_url}/{dataset.version}"
    manifest_payload, manifest_headers = fetch(
        f"{dataset_url}/manifest.json", arguments.origin
    )
    remote_manifest = json.loads(manifest_payload)
    if remote_manifest.get("version") != dataset.version:
        raise RuntimeError("The public manifest version does not match the local dataset")

    tiles = sorted(dataset.source.glob("*/*/*.png"))
    sample_indexes = sorted({0, len(tiles) // 2, len(tiles) - 1})
    for index in sample_indexes:
        relative = tiles[index].relative_to(dataset.source).as_posix()
        payload, headers = fetch(f"{dataset_url}/{relative}", arguments.origin)
        if not payload.startswith(PNG_SIGNATURE):
            raise RuntimeError(f"Published object is not a PNG: {relative}")
        if "immutable" not in headers.get("cache-control", ""):
            raise RuntimeError(f"Missing immutable Cache-Control header: {relative}")

    allowed_origin = manifest_headers.get("access-control-allow-origin")
    if allowed_origin not in {arguments.origin, "*"}:
        raise RuntimeError(
            "R2 CORS does not allow the application origin "
            f"({arguments.origin}); got {allowed_origin!r}"
        )
    print(
        f"R2 publication valid: manifest + {len(sample_indexes)} sample tiles at {dataset_url}"
    )


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, ValueError, json.JSONDecodeError) as error:
        raise SystemExit(f"R2 verification failed: {error}") from error
