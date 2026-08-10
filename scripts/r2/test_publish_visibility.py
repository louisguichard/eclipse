from __future__ import annotations

import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from publish_visibility import (
    ConfigurationError,
    IMMUTABLE_CACHE_CONTROL,
    build_sync_command,
    load_environment_file,
    load_dataset,
    r2_endpoint,
)


class DatasetTests(unittest.TestCase):
    def fixture(self, directory: str, count: int = 1) -> Path:
        source = Path(directory) / "paris-v1"
        tile = source / "16" / "1" / "2.png"
        tile.parent.mkdir(parents=True)
        tile.write_bytes(b"png")
        (source / "manifest.json").write_text(
            json.dumps({"version": "paris-v1", "tiles": {"count": count}}),
            encoding="utf-8",
        )
        return source

    def test_loads_a_versioned_dataset_and_counts_payload(self) -> None:
        with TemporaryDirectory() as directory:
            dataset = load_dataset(self.fixture(directory))
            self.assertEqual(dataset.version, "paris-v1")
            self.assertEqual(dataset.tile_count, 1)
            self.assertGreater(dataset.total_bytes, 3)

    def test_rejects_a_stale_manifest_count(self) -> None:
        with TemporaryDirectory() as directory:
            with self.assertRaisesRegex(ConfigurationError, "announces 2 tiles"):
                load_dataset(self.fixture(directory, count=2))

    def test_rejects_an_empty_dataset(self) -> None:
        with TemporaryDirectory() as directory:
            source = Path(directory) / "empty-v1"
            source.mkdir()
            (source / "manifest.json").write_text(
                json.dumps({"version": "empty-v1", "tiles": {"count": 0}}),
                encoding="utf-8",
            )
            with self.assertRaisesRegex(ConfigurationError, "no PNG tiles"):
                load_dataset(source)


class R2ConfigurationTests(unittest.TestCase):
    def test_loads_an_ignored_env_file_without_evaluating_shell(self) -> None:
        with TemporaryDirectory() as directory:
            path = Path(directory) / ".env.r2.local"
            path.write_text(
                "# local only\nexport CLOUDFLARE_ACCOUNT_ID=abc\n"
                "AWS_SECRET_ACCESS_KEY='not executed $(pwd)'\n",
                encoding="utf-8",
            )
            self.assertEqual(
                load_environment_file(path),
                {
                    "CLOUDFLARE_ACCOUNT_ID": "abc",
                    "AWS_SECRET_ACCESS_KEY": "not executed $(pwd)",
                },
            )

    def test_builds_an_immutable_non_destructive_sync(self) -> None:
        with TemporaryDirectory() as directory:
            dataset = load_dataset(DatasetTests().fixture(directory))
            command = build_sync_command(
                dataset,
                "eclipse-visibility",
                "visibility",
                "https://account.r2.cloudflarestorage.com",
                True,
            )
            self.assertIn("s3://eclipse-visibility/visibility/paris-v1/", command)
            self.assertIn(IMMUTABLE_CACHE_CONTROL, command)
            self.assertIn("--no-follow-symlinks", command)
            self.assertIn("--dryrun", command)
            self.assertNotIn("--delete", command)

    def test_derives_the_official_endpoint_from_the_account_id(self) -> None:
        self.assertEqual(
            r2_endpoint({"CLOUDFLARE_ACCOUNT_ID": "abc123"}),
            "https://abc123.r2.cloudflarestorage.com",
        )

    def test_rejects_a_non_r2_endpoint(self) -> None:
        with self.assertRaises(ConfigurationError):
            r2_endpoint({"CLOUDFLARE_R2_ENDPOINT": "https://example.com"})

    def test_rejects_malformed_env_file_lines(self) -> None:
        with TemporaryDirectory() as directory:
            path = Path(directory) / ".env.r2.local"
            path.write_text("this is not an assignment\n", encoding="utf-8")
            with self.assertRaises(ConfigurationError):
                load_environment_file(path)


if __name__ == "__main__":
    unittest.main()
