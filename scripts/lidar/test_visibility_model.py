from __future__ import annotations

import argparse
import json
import unittest
from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

import numpy as np
from PIL import Image
from pyproj import Transformer

from visibility_model import (
    CLASS_BLOCKED,
    CLASS_CLEAR,
    CLASS_NO_DATA,
    RasterGeometry,
    SolarGeometry,
    classify_visibility,
    detect_deck_cells,
    estimate_water_planes,
    sanitize_elevation,
)
from region_pipeline import (
    EclipseGeometry,
    boundary_centroid,
    derive_halo,
    load_region_definition,
    official_boundary_url,
    polygon_features,
)
from generate_urban_units_visibility import (
    PROJECT_ROOT,
    load_units,
    run_pipeline,
    run_unit,
    select_units,
    stage_worker_count,
    validate_region_config,
)
from export_visibility_regions import load_visibility_regions, render_typescript
from generate_paris_visibility import (
    Bounds,
    CLEAR_TILE_COLOR,
    GridDefinition,
    MNS_FALLBACK_LAYER,
    MNS_LAYER,
    MNT_FALLBACK_LAYER,
    MNT_LAYER,
    RENDER_DILATION_CELLS,
    _source_tier_counts,
    download_signature,
    encode_visibility_tile,
    ensure_downloads_complete,
    merge_elevation_sources,
    rasterize_region_mask,
    render_dilation_cells,
    write_visibility_tile,
)


class VisibilityModelTests(unittest.TestCase):
    def setUp(self) -> None:
        self.geometry = RasterGeometry(pixel_east_meters=1, pixel_north_meters=1)
        self.solar = SolarGeometry(
            azimuth_degrees=284,
            altitude_degrees=45,
            angular_radius_degrees=0,
            model_margin_degrees=0,
        )

    def test_flat_ground_is_clear(self) -> None:
        mnt = np.zeros((8, 16), dtype=np.float32)
        mns = mnt.copy()
        result = classify_visibility(
            mnt,
            mns,
            self.geometry,
            self.solar,
            # The synthetic source has no northern halo. Keep observers far
            # enough from that edge for their complete WNW rays to stay valid.
            slice(4, 8),
            slice(8, 16),
        )
        self.assertTrue(np.all(result == CLASS_CLEAR))

    def test_tall_sunward_surface_blocks_nearby_observer(self) -> None:
        mnt = np.zeros((8, 16), dtype=np.float32)
        mns = mnt.copy()
        # With the 284-degree digital ray, column 4 / row 4 looks through
        # approximately column 2 / row 3.  Ten metres blocks a 45-degree Sun.
        mns[3, 2] = 10
        result = classify_visibility(
            mnt,
            mns,
            self.geometry,
            self.solar,
            slice(4, 5),
            slice(4, 5),
        )
        self.assertEqual(result[0, 0], CLASS_BLOCKED)

    def test_local_rooftop_is_not_presented_as_clear_ground(self) -> None:
        mnt = np.zeros((8, 16), dtype=np.float32)
        mns = mnt.copy()
        mns[4, 8] = 12
        result = classify_visibility(
            mnt,
            mns,
            self.geometry,
            self.solar,
            slice(4, 5),
            slice(8, 9),
        )
        self.assertEqual(result[0, 0], CLASS_BLOCKED)

    def test_obstacle_behind_observer_has_no_effect(self) -> None:
        mnt = np.zeros((8, 16), dtype=np.float32)
        mns = mnt.copy()
        # The Sun is west-north-west. An obstacle east of the observer cannot
        # intersect the sight line and must not cast a solar shadow westward.
        mns[5, 12] = 50
        result = classify_visibility(
            mnt,
            mns,
            self.geometry,
            self.solar,
            slice(4, 5),
            slice(8, 9),
        )
        self.assertEqual(result[0, 0], CLASS_CLEAR)

    def test_low_distant_obstacle_falls_below_the_solar_ray(self) -> None:
        mnt = np.zeros((8, 16), dtype=np.float32)
        mns = mnt.copy()
        mns[3, 2] = 2
        result = classify_visibility(
            mnt,
            mns,
            self.geometry,
            self.solar,
            slice(4, 5),
            slice(8, 9),
        )
        self.assertEqual(result[0, 0], CLASS_CLEAR)

    def test_missing_observer_elevation_is_never_clear(self) -> None:
        mnt = np.zeros((8, 16), dtype=np.float32)
        mns = mnt.copy()
        mnt[4, 8] = np.nan
        result = classify_visibility(
            mnt,
            mns,
            self.geometry,
            self.solar,
            slice(4, 5),
            slice(8, 9),
        )
        self.assertEqual(result[0, 0], CLASS_NO_DATA)

    def test_missing_sunward_profile_is_never_clear(self) -> None:
        mnt = np.zeros((8, 16), dtype=np.float32)
        mns = mnt.copy()
        mns[3, 4] = np.nan
        result = classify_visibility(
            mnt, mns, self.geometry, self.solar, slice(4, 5), slice(8, 9)
        )
        self.assertEqual(result[0, 0], CLASS_NO_DATA)

    def test_french_mountain_elevations_are_valid(self) -> None:
        values = np.asarray([-9999, -250, 1500, 4800, 6000], dtype=np.float32)
        result = sanitize_elevation(values)
        self.assertTrue(np.isnan(result[0]))
        self.assertTrue(np.isfinite(result[1:4]).all())
        self.assertTrue(np.isnan(result[4]))


class RegionalPipelineTests(unittest.TestCase):
    def setUp(self) -> None:
        self.geometry = RasterGeometry(pixel_east_meters=1, pixel_north_meters=1)
        self.solar = SolarGeometry(
            azimuth_degrees=284,
            altitude_degrees=45,
            angular_radius_degrees=0,
            model_margin_degrees=0,
        )

    def test_department_url_uses_official_geo_api(self) -> None:
        self.assertEqual(
            official_boundary_url("department", "77"),
            "https://geo.api.gouv.fr/departements/77/communes?format=geojson&geometry=contour",
        )

    def test_file_boundary_is_resolved_relative_to_its_region_config(self) -> None:
        with TemporaryDirectory() as directory:
            root = Path(directory)
            config_dir = root / "regions"
            config_dir.mkdir()
            config = config_dir / "test.json"
            config.write_text(json.dumps({
                "id": "test",
                "label": "Test",
                "datasetVersion": "test-v1",
                "boundary": {"type": "file", "path": "../boundary.geojson"},
            }), encoding="utf-8")

            definition = load_region_definition(config)

            self.assertEqual(
                Path(definition.boundary["path"]),
                (root / "boundary.geojson").resolve(),
            )

    def test_top20_catalog_excludes_only_the_existing_paris_coverage(self) -> None:
        units = load_units()
        self.assertEqual(len(units), 19)
        self.assertEqual(units[0]["code"], "00760")
        self.assertEqual(units[-1]["code"], "59701")
        self.assertEqual(
            [unit["slug"] for unit in select_units(["34701", "rennes"])],
            ["montpellier", "rennes"],
        )

    def test_urban_unit_configs_use_stable_insee_ids_and_versions(self) -> None:
        for unit in load_units():
            config = validate_region_config(unit)
            definition = load_region_definition(config)
            expected_id = f"uu-{unit['code']}"
            self.assertEqual(definition.id, expected_id)
            self.assertEqual(
                definition.dataset_version,
                f"{expected_id}-2026-max-v1",
            )

    def test_stage_concurrency_respects_both_user_and_safety_caps(self) -> None:
        self.assertEqual(stage_worker_count("prepare", 99, 19), 4)
        self.assertEqual(stage_worker_count("download", 99, 19), 2)
        self.assertEqual(stage_worker_count("classify", 99, 19), 1)
        self.assertEqual(stage_worker_count("tiles", 99, 19), 1)
        self.assertEqual(stage_worker_count("prepare", 2, 19), 2)

    def test_all_pipeline_has_stage_barriers_and_isolates_failures(self) -> None:
        units = load_units()[:3]
        arguments = argparse.Namespace(stage="all", jobs=4, download_raster="all")
        calls: list[tuple[str, list[str]]] = []

        def fake_stage(selected, stage, _arguments):
            calls.append((stage, [unit["code"] for unit in selected]))
            if stage == "download":
                return selected[1:], ["synthetic download failure"]
            return list(selected), []

        completed, failures = run_pipeline(
            units,
            arguments,
            stage_runner=fake_stage,
        )

        self.assertEqual(
            [stage for stage, _codes in calls],
            ["prepare", "download", "classify", "tiles"],
        )
        self.assertEqual(calls[0][1], [unit["code"] for unit in units])
        self.assertEqual(calls[1][1], [unit["code"] for unit in units])
        self.assertEqual(calls[2][1], [unit["code"] for unit in units[1:]])
        self.assertEqual([unit["code"] for unit in completed], [
            unit["code"] for unit in units[1:]
        ])
        self.assertEqual(failures, ["synthetic download failure"])

    def test_region_subprocess_always_runs_from_project_root(self) -> None:
        unit = load_units()[0]
        arguments = argparse.Namespace(download_raster="all")
        with patch("generate_urban_units_visibility.subprocess.run") as run:
            run_unit(unit, "prepare", arguments)

        self.assertEqual(run.call_args.kwargs["cwd"], PROJECT_ROOT)
        self.assertTrue(run.call_args.kwargs["check"])

    def test_feature_collection_and_centroid_are_supported(self) -> None:
        boundary = {
            "type": "FeatureCollection",
            "features": [
                {"type": "Feature", "properties": {}, "geometry": {
                    "type": "Polygon",
                    "coordinates": [[[2.0, 48.0], [3.0, 48.0], [3.0, 49.0], [2.0, 49.0], [2.0, 48.0]]],
                }}
            ],
        }
        self.assertEqual(len(list(polygon_features(boundary))), 1)
        centroid = boundary_centroid(boundary)
        self.assertAlmostEqual(centroid.longitude, 2.5, delta=0.02)
        self.assertAlmostEqual(centroid.latitude, 48.5, delta=0.02)


    def test_polygon_hole_cannot_erase_an_independent_enclave(self) -> None:
        west, south, east, north = 700_000, 6_600_000, 700_100, 6_600_100
        to_wgs84 = Transformer.from_crs("EPSG:2154", "EPSG:4326", always_xy=True)

        def ring(points):
            return [list(to_wgs84.transform(x, y)) for x, y in points]

        island = ring([
            (700_040, 6_600_040), (700_060, 6_600_040),
            (700_060, 6_600_060), (700_040, 6_600_060),
            (700_040, 6_600_040),
        ])
        outer = ring([
            (west, south), (east, south), (east, north), (west, north),
            (west, south),
        ])
        hole = ring([
            (700_020, 6_600_020), (700_080, 6_600_020),
            (700_080, 6_600_080), (700_020, 6_600_080),
            (700_020, 6_600_020),
        ])
        boundary = {
            "type": "FeatureCollection",
            "features": [
                {"type": "Feature", "properties": {}, "geometry": {
                    "type": "Polygon", "coordinates": [island],
                }},
                {"type": "Feature", "properties": {}, "geometry": {
                    "type": "Polygon", "coordinates": [outer, hole],
                }},
            ],
        }
        bounds = Bounds(west, south, east, north)
        grid = GridDefinition(
            crs="EPSG:2154",
            resolution_meters=10,
            width=10,
            height=10,
            input_bounds=bounds,
            output_bounds=bounds,
            output_rows=(0, 10),
            output_columns=(0, 10),
            true_solar_azimuth_degrees=284,
            grid_solar_azimuth_degrees=284,
            grid_ray_east_component=-0.97,
            grid_ray_north_component=0.24,
        )

        mask = rasterize_region_mask(boundary, grid)

        self.assertTrue(mask[5, 5])  # independent island inside the other hole
        self.assertFalse(mask[3, 3])  # hole outside the enclave remains empty
        self.assertTrue(mask[1, 1])  # outer polygon remains filled

    def test_classification_rejects_a_partial_download(self) -> None:
        bounds = Bounds(0, 0, 4, 4)
        grid = GridDefinition(
            crs="EPSG:2154",
            resolution_meters=1,
            width=4,
            height=4,
            input_bounds=bounds,
            output_bounds=bounds,
            output_rows=(0, 4),
            output_columns=(0, 4),
            true_solar_azimuth_degrees=284,
            grid_solar_azimuth_degrees=284,
            grid_ray_east_component=-0.97,
            grid_ray_north_component=0.24,
        )
        with TemporaryDirectory() as directory:
            root = Path(directory)
            for name, layer, fallback_layer in (
                ("mnt", MNT_LAYER, MNT_FALLBACK_LAYER),
                ("mns", MNS_LAYER, MNS_FALLBACK_LAYER),
            ):
                (root / f"{name}.f32").write_bytes(bytes(4 * 4 * 4))
                signature = download_signature(layer, grid, 2, fallback_layer)
                (root / f"{name}-download.json").write_text(json.dumps({
                    "signature": signature,
                    "completed": ["0:0", "0:2", "2:0"],
                }), encoding="utf-8")

            with self.assertRaisesRegex(RuntimeError, "missing 1/4 chunks"):
                ensure_downloads_complete(root, grid, 2, fallback=True)

    def test_download_shards_can_jointly_satisfy_completeness(self) -> None:
        bounds = Bounds(0, 0, 4, 4)
        grid = GridDefinition(
            crs="EPSG:2154",
            resolution_meters=1,
            width=4,
            height=4,
            input_bounds=bounds,
            output_bounds=bounds,
            output_rows=(0, 4),
            output_columns=(0, 4),
            true_solar_azimuth_degrees=284,
            grid_solar_azimuth_degrees=284,
            grid_ray_east_component=-0.97,
            grid_ray_north_component=0.24,
        )
        with TemporaryDirectory() as directory:
            root = Path(directory)
            for name, layer, fallback_layer in (
                ("mnt", MNT_LAYER, MNT_FALLBACK_LAYER),
                ("mns", MNS_LAYER, MNS_FALLBACK_LAYER),
            ):
                (root / f"{name}.f32").write_bytes(bytes(4 * 4 * 4))
                signature = download_signature(layer, grid, 2, fallback_layer)
                for index, completed in enumerate(
                    (("0:0", "2:0"), ("0:2", "2:2")), start=1
                ):
                    shard_signature = dict(
                        signature,
                        shard_index=index - 1,
                        shard_count=2,
                    )
                    path = root / f"{name}-download-shard-{index}-of-2.json"
                    path.write_text(json.dumps({
                        "signature": shard_signature,
                        "completed": completed,
                    }), encoding="utf-8")

            ensure_downloads_complete(root, grid, 2, fallback=True)

    def test_low_sun_and_relief_expand_the_automatic_halo(self) -> None:
        eclipse = EclipseGeometry(
            "2026-08-01T00:00:00.000Z", "partial", 0.9,
            "begin", "peak", "end", 285, 4.7, 0.263,
        )
        flat = derive_halo(eclipse, 20, {}, 0.5)
        hilly = derive_halo(eclipse, 500, {}, 0.5)
        self.assertEqual(flat.sunward_meters, 4000)
        self.assertGreater(hilly.sunward_meters, flat.sunward_meters)
        self.assertLessEqual(hilly.sunward_meters, 15000)

    def test_fallback_fills_only_invalid_lidar_cells_and_counts_tiers(self) -> None:
        primary = np.asarray([[25, -9999], [np.nan, 42]], dtype=np.float32)
        fallback = np.asarray([[99, 30], [-9999, 88]], dtype=np.float32)
        merged, counts = merge_elevation_sources(primary, fallback)
        np.testing.assert_array_equal(merged, [[25, 30], [np.nan, 42]])
        self.assertEqual(counts, {"lidar": 2, "fallback": 1, "noData": 1})

    def test_source_counts_merge_download_shards_without_double_counting(self) -> None:
        with TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "mns-download.json").write_text(json.dumps({
                "sourceCellsByChunk": {
                    "0:0": {"lidar": 4, "fallback": 0, "noData": 0},
                },
            }), encoding="utf-8")
            (root / "mns-download-shard-1-of-2.json").write_text(json.dumps({
                "sourceCellsByChunk": {
                    "0:0": {"lidar": 4, "fallback": 0, "noData": 0},
                    "0:2": {"lidar": 1, "fallback": 2, "noData": 1},
                },
            }), encoding="utf-8")

            totals = _source_tier_counts(root)

            self.assertEqual(
                totals["mns"],
                {"lidar": 5, "fallback": 2, "noData": 1},
            )

    def test_mnt_gap_invalidates_every_downstream_profile(self) -> None:
        mnt = np.zeros((10, 12), dtype=np.float32)
        mns = mnt.copy()
        mnt[:, 4] = np.nan

        result = classify_visibility(
            mnt,
            mns,
            self.geometry,
            self.solar,
            slice(6, 7),
            slice(2, 10),
        )[0]

        # Valid observers before the gap remain usable. The cell on the gap
        # and every later observer whose sunward profile crosses it are not.
        np.testing.assert_array_equal(
            result,
            np.asarray(
                [
                    CLASS_CLEAR,
                    CLASS_CLEAR,
                    CLASS_NO_DATA,
                    CLASS_NO_DATA,
                    CLASS_NO_DATA,
                    CLASS_NO_DATA,
                    CLASS_NO_DATA,
                    CLASS_NO_DATA,
                ],
                dtype=np.uint8,
            ),
        )

    def test_mns_gap_invalidates_every_downstream_profile(self) -> None:
        mnt = np.zeros((10, 12), dtype=np.float32)
        mns = mnt.copy()
        mns[:, 4] = np.nan

        result = classify_visibility(
            mnt,
            mns,
            self.geometry,
            self.solar,
            slice(6, 7),
            slice(2, 10),
        )[0]

        np.testing.assert_array_equal(
            result,
            np.asarray(
                [
                    CLASS_CLEAR,
                    CLASS_CLEAR,
                    CLASS_NO_DATA,
                    CLASS_NO_DATA,
                    CLASS_NO_DATA,
                    CLASS_NO_DATA,
                    CLASS_NO_DATA,
                    CLASS_NO_DATA,
                ],
                dtype=np.uint8,
            ),
        )

    def test_no_data_outside_the_sunward_profile_does_not_poison_it(self) -> None:
        mnt = np.zeros((10, 12), dtype=np.float32)
        mns = mnt.copy()
        # The digital ray from row 6 / column 8 remains around rows 4--6.
        # A coverage hole on the far northern row is unrelated to that ray.
        mnt[0, 4] = np.nan
        mns[0, 4] = np.nan

        result = classify_visibility(
            mnt,
            mns,
            self.geometry,
            self.solar,
            slice(6, 7),
            slice(8, 9),
        )

        self.assertEqual(result[0, 0], CLASS_CLEAR)


class VisibilityRegionExportTests(unittest.TestCase):
    def write_unit_inputs(
        self,
        root: Path,
        *,
        rank: int,
        code: str,
        slug: str,
        label: str,
        coverage: dict[str, float],
    ) -> None:
        version = f"uu-{code}-2026-max-v1"
        config = {
            "id": f"uu-{code}",
            "label": f"Unité urbaine de {label}",
            "datasetVersion": version,
            "resolutionMeters": 5,
            "minZoom": 8,
            "maxZoom": 15,
            "sourceNotes": f"Source synthétique de rang {rank}.",
        }
        (root / "regions" / f"uu-{slug}.json").write_text(
            json.dumps(config), encoding="utf-8"
        )
        manifest = {
            "id": f"uu-{code}-maximum-geometry",
            "version": version,
            "coverage": coverage,
            "reference": {
                "mode": "fixed-instant",
                "label": f"{label} · maximum local",
                "timeUtc": "2026-08-12T18:00:00.000Z",
            },
            "surface": {
                "resolutionMeters": 5.0,
                "observerHeightMeters": 1.7,
                "includesBuildings": True,
                "includesVegetation": True,
                "sourceTiers": ["IGN LiDAR HD", "RGE ALTI (fallback)"],
            },
            "halo": {
                "capped": False,
                "sunward_meters": 4000.0,
            },
            "tiles": {
                "scheme": "xyz",
                "tileSize": 256,
                "minZoom": 8,
                "maxZoom": 15,
            },
            "generatedAt": "2026-08-10T12:00:00+00:00",
            "attribution": "© IGN · Licence Ouverte 2.0",
        }
        manifest_dir = root / "publish" / version
        manifest_dir.mkdir(parents=True)
        (manifest_dir / "manifest.json").write_text(
            json.dumps(manifest), encoding="utf-8"
        )

    def test_export_uses_manifest_coverage_in_catalogue_rank_order(self) -> None:
        with TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "regions").mkdir()
            units = [
                {
                    "rank": 1,
                    "code": "00851",
                    "slug": "paris",
                    "label": "Paris",
                    "existingCoverage": "ile-de-france",
                },
                {"rank": 3, "code": "22222", "slug": "beta", "label": "Bêta"},
                {"rank": 2, "code": "11111", "slug": "alpha", "label": "Alpha"},
            ]
            (root / "catalog.json").write_text(
                json.dumps({"units": units}), encoding="utf-8"
            )
            alpha_coverage = {
                "north": 49.0,
                "south": 48.0,
                "east": 3.0,
                "west": 2.0,
            }
            beta_coverage = {
                "north": 47.0,
                "south": 46.0,
                "east": 5.0,
                "west": 4.0,
            }
            self.write_unit_inputs(
                root,
                rank=2,
                code="11111",
                slug="alpha",
                label="Alpha",
                coverage=alpha_coverage,
            )
            self.write_unit_inputs(
                root,
                rank=3,
                code="22222",
                slug="beta",
                label="Bêta",
                coverage=beta_coverage,
            )

            regions = load_visibility_regions(
                root / "catalog.json", root / "regions", root / "publish"
            )

            self.assertEqual(
                [region["code"] for region in regions], ["11111", "22222"]
            )
            self.assertEqual(regions[0]["coverage"], alpha_coverage)
            self.assertEqual(regions[0]["halo"], {
                "capped": False,
                "sunwardMeters": 4000.0,
            })
            self.assertEqual(regions[1]["version"], "uu-22222-2026-max-v1")
            rendered = render_typescript(regions)
            reloaded = load_visibility_regions(
                root / "catalog.json", root / "regions", root / "publish"
            )
            self.assertEqual(rendered, render_typescript(reloaded))
            self.assertIn("Bêta", rendered)
            self.assertNotIn("generated at", rendered.lower())

    def test_export_rejects_a_manifest_with_a_stale_version(self) -> None:
        with TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "regions").mkdir()
            unit = {
                "rank": 2,
                "code": "11111",
                "slug": "alpha",
                "label": "Alpha",
            }
            (root / "catalog.json").write_text(
                json.dumps({"units": [unit]}), encoding="utf-8"
            )
            coverage = {
                "north": 49.0,
                "south": 48.0,
                "east": 3.0,
                "west": 2.0,
            }
            self.write_unit_inputs(
                root,
                rank=2,
                code="11111",
                slug="alpha",
                label="Alpha",
                coverage=coverage,
            )
            manifest_path = (
                root / "publish" / "uu-11111-2026-max-v1" / "manifest.json"
            )
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            manifest["version"] = "uu-11111-stale-v0"
            manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

            with self.assertRaisesRegex(ValueError, "must use version"):
                load_visibility_regions(
                    root / "catalog.json", root / "regions", root / "publish"
                )


class WaterPlaneTests(unittest.TestCase):
    @staticmethod
    def city(rng, size: int = 400_000) -> np.ndarray:
        """Built ground: far denser than the river, but spread over metres."""
        return np.concatenate(
            [rng.normal(35, 1.8, size), rng.uniform(28, 120, size // 2)]
        ).astype(np.float32)

    def test_reads_the_river_spike(self) -> None:
        rng = np.random.default_rng(7)
        river = np.full(20_000, 26.9, dtype=np.float32)
        planes = estimate_water_planes(np.concatenate([self.city(rng), river]))
        self.assertEqual(len(planes), 1)
        self.assertAlmostEqual(planes[0], 26.875, places=3)

    def test_ignores_the_denser_but_broader_city_mode(self) -> None:
        # The city carries thirty times more pixels than the river; only
        # spikiness separates them, never raw count.
        rng = np.random.default_rng(3)
        river = np.full(20_000, 26.9, dtype=np.float32)
        planes = estimate_water_planes(np.concatenate([self.city(rng), river]))
        self.assertTrue(all(plane < 28.0 for plane in planes), planes)

    def test_returns_every_pool_of_a_stepped_river(self) -> None:
        # A raster spanning two reaches of the same river holds two planes,
        # and a single value would strand the bridges over the other one.
        rng = np.random.default_rng(11)
        downstream = np.full(24_000, 23.6, dtype=np.float32)
        upstream = np.full(20_000, 26.9, dtype=np.float32)
        planes = estimate_water_planes(
            np.concatenate([self.city(rng), downstream, upstream])
        )
        self.assertEqual(len(planes), 2)
        self.assertAlmostEqual(planes[0], 23.625, places=3)
        self.assertAlmostEqual(planes[1], 26.875, places=3)


class DeckDetectionTests(unittest.TestCase):
    def setUp(self) -> None:
        # A river channel at 26.9 m cut through a 34 m city.
        self.mnt = np.full((12, 12), 34.0, dtype=np.float32)
        self.mnt[5:8, :] = 26.9
        self.mns = self.mnt.copy()

    def test_flat_slab_over_water_is_a_deck(self) -> None:
        self.mns[5:8, 4:7] = 35.5  # bridge deck spanning the channel
        deck = detect_deck_cells(self.mnt, self.mns, 26.9)
        self.assertTrue(deck[5:8, 4:7].all())
        self.assertFalse(deck[5:8, 0:3].any())

    def test_rough_canopy_over_water_is_not_a_deck(self) -> None:
        self.mns[5:8, 4:7] = [[33.0, 40.0, 34.5], [39.5, 32.0, 41.0], [34.0, 40.5, 33.5]]
        self.assertFalse(detect_deck_cells(self.mnt, self.mns, 26.9).any())

    def test_building_on_dry_ground_is_not_a_deck(self) -> None:
        self.mns[1:4, 4:7] = 46.0
        self.assertFalse(detect_deck_cells(self.mnt, self.mns, 26.9).any())


class DeckObserverTests(unittest.TestCase):
    """A bridge must be read from its roadway, not from the river below it."""

    def setUp(self) -> None:
        self.geometry = RasterGeometry(pixel_east_meters=1, pixel_north_meters=1)
        self.solar = SolarGeometry(
            azimuth_degrees=284,
            altitude_degrees=45,
            angular_radius_degrees=0,
            model_margin_degrees=0,
        )
        self.mnt = np.zeros((8, 16), dtype=np.float32)
        self.mns = self.mnt.copy()
        # Deck 6 m over the water at the observer cell, and a quay wall 5 m
        # high on the sunward side that would hide an observer at river level.
        self.mns[4, 8] = 6.0
        self.mns[3, 6] = 5.0

    def classify(self, deck):
        return classify_visibility(
            self.mnt,
            self.mns,
            self.geometry,
            self.solar,
            slice(4, 5),
            slice(8, 9),
            deck=deck,
        )[0, 0]

    def test_without_the_deck_mask_the_bridge_reads_as_blocked(self) -> None:
        self.assertEqual(self.classify(None), CLASS_BLOCKED)

    def test_the_deck_mask_lifts_the_observer_onto_the_roadway(self) -> None:
        deck = np.zeros_like(self.mnt, dtype=bool)
        deck[4, 8] = True
        self.assertEqual(self.classify(deck), CLASS_CLEAR)


class RenderDilationTests(unittest.TestCase):
    """The render-time widening that keeps the layer alive when zooming out."""

    def test_close_zooms_keep_the_legibility_floor(self) -> None:
        for zoom in (14, 15, 16):
            self.assertEqual(render_dilation_cells(zoom, 2.0), RENDER_DILATION_CELLS)

    def test_the_mask_grows_by_half_a_pixel_once_a_pixel_exceeds_the_floor(self) -> None:
        # A tile pixel at zoom 12 covers about 25 m over Paris, so half of it is
        # seven two-metre cells.
        self.assertEqual(render_dilation_cells(12, 2.0), 7)
        self.assertEqual(render_dilation_cells(10, 2.0), 26)

    def test_widening_never_shrinks_as_the_map_zooms_out(self) -> None:
        cells = [render_dilation_cells(zoom, 2.0) for zoom in range(16, 9, -1)]
        self.assertEqual(cells, sorted(cells))

    def test_a_finer_grid_needs_more_cells_for_the_same_ground_distance(self) -> None:
        self.assertGreater(render_dilation_cells(11, 0.5), render_dilation_cells(11, 2.0))


class TileEncodingTests(unittest.TestCase):
    def test_visible_tile_is_a_one_bit_palette_png_with_alpha(self) -> None:
        codes = np.full((256, 256), CLASS_NO_DATA, dtype=np.uint8)
        codes[12, 34] = CLASS_CLEAR

        payload = encode_visibility_tile(codes)

        self.assertIsNotNone(payload)
        assert payload is not None
        self.assertEqual(payload[:8], b"\x89PNG\r\n\x1a\n")
        # PNG IHDR: byte 24 is the bit depth and byte 25 the colour type.
        self.assertEqual(payload[24], 1)
        self.assertEqual(payload[25], 3)  # indexed colour
        with Image.open(BytesIO(payload)) as image:
            rgba = image.convert("RGBA")
            self.assertEqual(rgba.getpixel((34, 12)), CLEAR_TILE_COLOR)
            self.assertEqual(rgba.getpixel((0, 0)), (0, 0, 0, 0))

    def test_empty_tile_is_omitted_and_removes_a_stale_file(self) -> None:
        codes = np.full((256, 256), CLASS_NO_DATA, dtype=np.uint8)
        with TemporaryDirectory() as directory:
            destination = Path(directory) / "16" / "1" / "2.png"
            destination.parent.mkdir(parents=True)
            destination.write_bytes(b"stale")

            self.assertFalse(write_visibility_tile(destination, codes))
            self.assertFalse(destination.exists())

    def test_tile_encoder_rejects_the_wrong_dimensions(self) -> None:
        with self.assertRaisesRegex(ValueError, "256 × 256"):
            encode_visibility_tile(np.zeros((16, 16), dtype=np.uint8))


if __name__ == "__main__":
    unittest.main()
