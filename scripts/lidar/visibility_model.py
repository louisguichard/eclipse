"""Solar line-of-sight classification for a north-up metric raster.

The model is deliberately independent from Google Maps and Street View.  It
compares an observer eye height from the IGN MNT with the sunward surface
profile from the IGN MNS.  A discrete north-west ray visits every raster
column and keeps the calculation linear in the number of pixels.
"""

from __future__ import annotations

from dataclasses import dataclass
from math import cos, floor, radians, sin, tan
from typing import Callable, Iterable

import numpy as np
from numpy.typing import NDArray


CLASS_NO_DATA = np.uint8(0)
CLASS_CLEAR = np.uint8(1)
CLASS_SENSITIVE = np.uint8(2)
CLASS_UNCERTAIN = np.uint8(3)
CLASS_BLOCKED = np.uint8(4)

# A bridge deck reads as a thick "local obstacle" because the MNT underneath it
# is the river, not the roadway.  These bounds describe a Paris deck: high
# enough over the water to clear navigation, far below a building, and flat.
DECK_MIN_CLEARANCE_METERS = 2.0
DECK_MAX_CLEARANCE_METERS = 25.0
DECK_ROUGHNESS_METERS = 2.5
DECK_ROUGHNESS_RADIUS_CELLS = 2


@dataclass(frozen=True)
class SolarGeometry:
    azimuth_degrees: float
    altitude_degrees: float
    angular_radius_degrees: float
    model_margin_degrees: float = 0.5
    grid_azimuth_degrees: float | None = None

    @property
    def tested_altitudes(self) -> tuple[float, float, float]:
        lower_limb = self.altitude_degrees - self.angular_radius_degrees
        return (
            lower_limb - self.model_margin_degrees,
            lower_limb,
            self.altitude_degrees + self.angular_radius_degrees,
        )


@dataclass(frozen=True)
class RasterGeometry:
    pixel_east_meters: float
    pixel_north_meters: float


def sanitize_elevation(values: NDArray[np.float32]) -> NDArray[np.float32]:
    """Return Paris-plausible elevations, with service no-data as NaN."""

    return np.where(
        np.isfinite(values) & (values > -200) & (values < 1_000),
        values,
        np.nan,
    ).astype(np.float32, copy=False)


def estimate_water_planes(
    mnt: NDArray[np.float32],
    *,
    bin_meters: float = 0.25,
    tail_percentile: float = 10.0,
    neighbourhood_meters: float = 1.5,
    minimum_share: float = 0.002,
    minimum_spikiness: float = 0.15,
) -> list[float]:
    """Return every still-water surface elevation found in the terrain model.

    Open water is the only large area that sits at a single elevation, so it
    forms a sharp spike in the MNT histogram: most of its mass lands in one
    0.25 m bin, while built ground spreads over metres.  Spikiness — a bin's
    share of its own ±1.5 m neighbourhood — is what separates the two, and it
    is measured on the full histogram so the low-tail cut cannot manufacture a
    spike at its own edge.

    The result is a list because a river is not one plane: this raster spans
    two Seine pools, roughly 23.6 m downstream and 26.9 m through Paris, and a
    single value would strand every bridge over the other one.
    """

    values = sanitize_elevation(np.asarray(mnt))
    values = values[np.isfinite(values)]
    if values.size == 0:
        raise ValueError("No usable elevations to estimate a water plane")

    edges = np.arange(
        float(np.floor(values.min())),
        float(np.ceil(values.max())) + bin_meters,
        bin_meters,
    )
    if edges.size < 2:
        return [float(values.mean())]

    counts, _ = np.histogram(values, bins=edges)
    half = max(1, int(round(neighbourhood_meters / bin_meters)))
    neighbourhood = np.convolve(counts, np.ones(2 * half + 1), mode="same")
    spikiness = np.divide(
        counts,
        neighbourhood,
        out=np.zeros(counts.shape, dtype=np.float64),
        where=neighbourhood > 0,
    )

    ceiling = float(np.percentile(values, tail_percentile))
    candidate = (
        (edges[:-1] <= ceiling)
        & (counts >= minimum_share * values.size)
        & (spikiness >= minimum_spikiness)
    )
    if not candidate.any():
        return [float(edges[int(np.argmax(counts))] + bin_meters / 2)]

    # Adjacent bins belong to the same pool; keep their weighted centre.
    planes: list[float] = []
    run: list[int] = []
    for index in np.flatnonzero(candidate):
        if run and index != run[-1] + 1:
            planes.append(_weighted_center(edges, counts, run, bin_meters))
            run = []
        run.append(int(index))
    if run:
        planes.append(_weighted_center(edges, counts, run, bin_meters))
    return planes


def _weighted_center(
    edges: NDArray[np.float64],
    counts: NDArray[np.int64],
    run: list[int],
    bin_meters: float,
) -> float:
    centers = edges[run] + bin_meters / 2
    weights = counts[run].astype(np.float64)
    return float(np.average(centers, weights=weights))


def _window_peak_to_peak(
    values: NDArray[np.float32],
    radius: int,
) -> NDArray[np.float32]:
    """Local max-min over a (2*radius+1)² window, computed with plain shifts."""

    filled = np.where(np.isfinite(values), values, np.nan).astype(np.float32, copy=False)
    maximum = filled.copy()
    minimum = filled.copy()
    for axis in (0, 1):
        rolled_max = maximum
        rolled_min = minimum
        for offset in range(1, radius + 1):
            for direction in (offset, -offset):
                shifted_max = np.roll(maximum, direction, axis=axis)
                shifted_min = np.roll(minimum, direction, axis=axis)
                rolled_max = np.fmax(rolled_max, shifted_max)
                rolled_min = np.fmin(rolled_min, shifted_min)
        maximum = rolled_max
        minimum = rolled_min
    return (maximum - minimum).astype(np.float32, copy=False)


def detect_deck_cells(
    mnt: NDArray[np.float32],
    mns: NDArray[np.float32],
    water_planes_meters: float | Iterable[float],
    *,
    water_tolerance_meters: float = 0.6,
) -> NDArray[np.bool_]:
    """Flag cells where an observer stands on the surface, not on the terrain.

    Over a bridge the MNT is the water below and the MNS is the roadway, so
    both the eye height and the local-obstacle test have to switch to the MNS.
    The test keeps a flat slab of plausible deck thickness sitting over water;
    a canopy overhanging the river is rejected by its roughness.
    """

    planes = (
        [float(water_planes_meters)]
        if isinstance(water_planes_meters, (int, float))
        else [float(plane) for plane in water_planes_meters]
    )
    if not planes:
        raise ValueError("At least one water plane is required to detect decks")

    terrain = sanitize_elevation(np.asarray(mnt))
    surface = sanitize_elevation(np.asarray(mns))
    clearance = surface - terrain
    over_water = np.zeros(terrain.shape, dtype=bool)
    for plane in planes:
        np.logical_or(
            over_water,
            np.abs(terrain - plane) <= water_tolerance_meters,
            out=over_water,
        )
    thickness_fits = (
        (clearance >= DECK_MIN_CLEARANCE_METERS)
        & (clearance <= DECK_MAX_CLEARANCE_METERS)
    )

    # Roughness is measured across the elevated slab alone. Including the water
    # around it would put the deck's own edge in every window and erode the
    # bridge by the window radius, which erases the narrow footbridges.
    elevated = np.where(thickness_fits, surface, np.nan).astype(np.float32, copy=False)
    roughness = _window_peak_to_peak(elevated, DECK_ROUGHNESS_RADIUS_CELLS)
    flat = ~(roughness > DECK_ROUGHNESS_METERS)

    return np.asarray(over_water & thickness_fits & flat & np.isfinite(clearance))


def dilate_mask(mask: NDArray[np.bool_], radius_cells: int) -> NDArray[np.bool_]:
    """Grow a mask by `radius_cells` in a square neighbourhood.

    Purely a rendering aid: a clear pavement two cells wide is invisible on a
    city map, so the painted class is widened before it becomes tiles.  The
    saved classification is never dilated.
    """

    if radius_cells < 0:
        raise ValueError("Dilation radius must not be negative")
    grown = np.asarray(mask, dtype=bool)
    if radius_cells == 0:
        return grown
    for axis in (0, 1):
        accumulated = grown
        for offset in range(1, radius_cells + 1):
            for direction in (offset, -offset):
                accumulated = accumulated | np.roll(grown, direction, axis=axis)
        grown = accumulated
    return grown


def _shift_north(values: NDArray[np.float32], rows: int) -> NDArray[np.float32]:
    if rows == 0:
        return values
    shifted = np.full_like(values, -np.inf)
    shifted[rows:] = values[:-rows]
    return shifted


def classify_visibility(
    mnt: NDArray[np.float32],
    mns: NDArray[np.float32],
    geometry: RasterGeometry,
    solar: SolarGeometry,
    output_rows: slice,
    output_columns: slice,
    *,
    observer_height_meters: float = 1.7,
    local_obstacle_height_meters: float = 2.5,
    deck: NDArray[np.bool_] | None = None,
    progress: Callable[[int, int], None] | None = None,
) -> NDArray[np.uint8]:
    """Classify the Sun disk for every requested observer cell.

    Codes are no-data, robustly clear, sensitive, grazing/uncertain, and
    blocked.  The three line-of-sight passes target a conservative lower limb,
    the physical lower limb, and the upper limb of the Sun respectively.

    `deck` marks cells whose observer stands on the MNS rather than the MNT —
    bridges, where the terrain model is the water underneath.  Without it a
    bridge is reported blocked twice over: the deck counts as a local obstacle
    and the eye sits at river level.  See `detect_deck_cells`.

    The input must be north-up: columns increase eastward, rows increase
    southward.  The 2026 Paris Sun is west-north-west, so every successor is in
    an already processed western column.  A Bresenham-like cumulative row
    shift approximates the true azimuth without skipping raster columns.
    """

    if mnt.shape != mns.shape or mnt.ndim != 2:
        raise ValueError("MNT and MNS must be two-dimensional arrays of equal shape")
    if geometry.pixel_east_meters <= 0 or geometry.pixel_north_meters <= 0:
        raise ValueError("Raster pixel dimensions must be positive")

    height, width = mnt.shape
    row_start, row_stop, row_step = output_rows.indices(height)
    column_start, column_stop, column_step = output_columns.indices(width)
    if row_step != 1 or column_step != 1:
        raise ValueError("Output slices must use a step of one")

    azimuth_radians = radians(
        solar.grid_azimuth_degrees
        if solar.grid_azimuth_degrees is not None
        else solar.azimuth_degrees
    )
    east_component = sin(azimuth_radians)
    north_component = cos(azimuth_radians)
    if east_component >= -1e-6 or north_component <= 0:
        raise ValueError("This optimized pass expects a west-north-west solar azimuth")

    west_component = -east_component
    rows_per_column = (
        north_component * geometry.pixel_east_meters
        / (west_component * geometry.pixel_north_meters)
    )
    if not 0 <= rows_per_column < 1:
        raise ValueError("The raster ray requires more than one row shift per column")

    distance_per_column = geometry.pixel_east_meters / west_component
    slopes = np.tan(np.radians(np.asarray(solar.tested_altitudes, dtype=np.float64)))
    slope_loss = (slopes * distance_per_column).astype(np.float32)

    output = np.full(
        (row_stop - row_start, column_stop - column_start),
        CLASS_NO_DATA,
        dtype=np.uint8,
    )
    support_previous = np.full((3, height), -np.inf, dtype=np.float32)
    cumulative_shift_previous = 0

    for column in range(1, width):
        cumulative_shift = floor(column * rows_per_column + 0.5)
        row_shift = cumulative_shift - cumulative_shift_previous
        if row_shift not in (0, 1):
            raise RuntimeError("Unexpected digital-ray row shift")

        predecessor_surface = sanitize_elevation(mns[:, column - 1])
        predecessor_surface = np.where(
            np.isfinite(predecessor_surface), predecessor_surface, -np.inf
        ).astype(np.float32, copy=False)
        predecessor_surface = _shift_north(predecessor_surface, row_shift)

        support_shifted = np.stack(
            [_shift_north(support_previous[index], row_shift) for index in range(3)]
        )
        support_current = np.maximum(
            predecessor_surface[np.newaxis, :], support_shifted
        ) - slope_loss[:, np.newaxis]

        if column_start <= column < column_stop:
            terrain = sanitize_elevation(mnt[row_start:row_stop, column])
            surface = sanitize_elevation(mns[row_start:row_stop, column])
            on_deck = (
                np.zeros(terrain.shape, dtype=bool)
                if deck is None
                else np.asarray(deck[row_start:row_stop, column], dtype=bool)
            )
            standing = np.where(on_deck, surface, terrain).astype(np.float32, copy=False)
            eye = standing + np.float32(observer_height_meters)
            support = support_current[:, row_start:row_stop]
            valid = (
                np.isfinite(terrain)
                & np.isfinite(surface)
                & np.isfinite(support[2])
            )

            robustly_clear = valid & (eye >= support[0])
            lower_limb_clear = valid & (eye >= support[1])
            upper_limb_clear = valid & (eye >= support[2])
            local_obstacle = valid & ~on_deck & (
                surface - terrain >= np.float32(local_obstacle_height_meters)
            )

            result = np.full(terrain.shape, CLASS_NO_DATA, dtype=np.uint8)
            result[valid] = CLASS_BLOCKED
            result[upper_limb_clear] = CLASS_UNCERTAIN
            result[lower_limb_clear] = CLASS_SENSITIVE
            result[robustly_clear] = CLASS_CLEAR
            result[local_obstacle] = CLASS_BLOCKED
            output[:, column - column_start] = result

        support_previous = support_current
        cumulative_shift_previous = cumulative_shift
        if progress and (column % 250 == 0 or column == width - 1):
            progress(column, width)

    return output
