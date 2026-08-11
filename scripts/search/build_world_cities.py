#!/usr/bin/env python3
"""Build the compact, lazy-loaded world city index used by LocationSearch.

Source: GeoNames cities15000, licensed CC BY 4.0. The complete worldwide
dataset is retained so it can act as a fallback when a national API is down.
https://download.geonames.org/export/dump/
"""

from __future__ import annotations

import argparse
import io
import json
from pathlib import Path
import urllib.request
import zipfile


SOURCE_URL = "https://download.geonames.org/export/dump/cities15000.zip"
DEFAULT_OUTPUT = "public/search/world-cities-geonames-20260811.min.json"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", help="Optional local cities15000.zip")
    parser.add_argument("--output", default=DEFAULT_OUTPUT)
    return parser.parse_args()


def read_archive(source: str | None) -> bytes:
    if source:
        return Path(source).read_bytes()
    request = urllib.request.Request(SOURCE_URL, headers={"User-Agent": "eclipse-2026-indexer/1"})
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read()


def build_rows(archive: bytes) -> list[list[object]]:
    rows: list[list[object]] = []
    with zipfile.ZipFile(io.BytesIO(archive)) as bundle:
        with bundle.open("cities15000.txt") as source:
            for raw_line in io.TextIOWrapper(source, encoding="utf-8"):
                fields = raw_line.rstrip("\n").split("\t")
                if len(fields) < 19:
                    continue
                rows.append([
                    int(fields[0]),
                    fields[1],
                    fields[2],
                    fields[8],
                    fields[10],
                    round(float(fields[4]), 5),
                    round(float(fields[5]), 5),
                    int(fields[14] or 0),
                ])
    rows.sort(key=lambda row: (-int(row[7]), str(row[1]).casefold(), int(row[0])))
    return rows


def main() -> None:
    args = parse_args()
    rows = build_rows(read_archive(args.source))
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        json.dumps(rows, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    print(f"{len(rows)} cities -> {output} ({output.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
