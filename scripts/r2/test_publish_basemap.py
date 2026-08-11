from __future__ import annotations

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from publish_basemap import (
    IMMUTABLE_CACHE_CONTROL,
    build_upload_command,
    clean_object_key,
    validate_archive,
)
from publish_visibility import ConfigurationError


class BasemapPublicationTests(unittest.TestCase):
    def archive_fixture(self, directory: str) -> Path:
        archive = Path(directory) / "eclipse.pmtiles"
        archive.write_bytes(b"PMTiles fixture".ljust(127, b"\0"))
        return archive

    def test_builds_an_immutable_non_destructive_upload(self) -> None:
        with TemporaryDirectory() as directory:
            archive = validate_archive(self.archive_fixture(directory))
            command = build_upload_command(
                archive,
                "eclipse-visibility",
                "basemap/eclipse-2026-v1.pmtiles",
                "https://account.r2.cloudflarestorage.com",
                True,
            )

        self.assertIn(
            "s3://eclipse-visibility/basemap/eclipse-2026-v1.pmtiles",
            command,
        )
        self.assertIn("application/vnd.pmtiles", command)
        self.assertIn(IMMUTABLE_CACHE_CONTROL, command)
        self.assertIn("--dryrun", command)
        self.assertNotIn("--delete", command)

    def test_rejects_unsafe_or_non_pmtiles_object_keys(self) -> None:
        for key in ("", "../world.pmtiles", "basemap/world.mbtiles"):
            with self.subTest(key=key), self.assertRaises(ConfigurationError):
                clean_object_key(key)

    def test_rejects_missing_tiny_and_symlinked_archives(self) -> None:
        with TemporaryDirectory() as directory:
            root = Path(directory)
            missing = root / "missing.pmtiles"
            tiny = root / "tiny.pmtiles"
            tiny.write_bytes(b"tiny")
            link = root / "link.pmtiles"
            link.symlink_to(tiny)
            for archive in (missing, tiny, link):
                with self.subTest(archive=archive), self.assertRaises(ConfigurationError):
                    validate_archive(archive)


if __name__ == "__main__":
    unittest.main()
