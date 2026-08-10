from __future__ import annotations

import unittest

import numpy as np

from visibility_model import (
    CLASS_BLOCKED,
    CLASS_CLEAR,
    CLASS_NO_DATA,
    RasterGeometry,
    SolarGeometry,
    classify_visibility,
    detect_deck_cells,
    estimate_water_planes,
)
from generate_paris_visibility import RENDER_DILATION_CELLS, render_dilation_cells


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


if __name__ == "__main__":
    unittest.main()
