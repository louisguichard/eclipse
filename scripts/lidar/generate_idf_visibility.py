#!/usr/bin/env python3
"""Run the resumable regional generator for the seven IDF datasets outside Paris."""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path


DEPARTMENTS = ("77", "78", "91", "92", "93", "94", "95")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--stage",
        choices=("all", "prepare", "download", "classify", "tiles"),
        default="all",
    )
    parser.add_argument("--departments", nargs="+", choices=DEPARTMENTS, default=DEPARTMENTS)
    arguments = parser.parse_args()
    generator = Path(__file__).with_name("generate_paris_visibility.py")
    for code in arguments.departments:
        print(f"\n=== Île-de-France {code} · {arguments.stage} ===", flush=True)
        subprocess.run(
            [
                sys.executable,
                str(generator),
                "--region-config",
                f"idf-{code}",
                "--stage",
                arguments.stage,
            ],
            check=True,
        )


if __name__ == "__main__":
    main()
