"""Checkpoints along a route polyline, each with the truck's ETA there."""
import math
from bisect import bisect_right
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta

EARTH_RADIUS_MI = 3958.7613
# A target this close to the end is the endpoint itself (about 50 ft), not a separate checkpoint.
_END_SNAP_MI = 0.01

LatLon = tuple[float, float]


@dataclass(frozen=True)
class Checkpoint:
    mile: float
    lat: float
    lon: float
    eta: datetime


def haversine_mi(a: LatLon, b: LatLon) -> float:
    lat1, lon1, lat2, lon2 = map(math.radians, (*a, *b))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return 2 * EARTH_RADIUS_MI * math.asin(math.sqrt(h))


def cumulative_miles(points: Sequence[LatLon]) -> list[float]:
    miles = [0.0]
    for a, b in zip(points, points[1:], strict=False):
        miles.append(miles[-1] + haversine_mi(a, b))
    return miles


def _vertex_seconds(miles: Sequence[float], progress: Sequence[tuple[int, float]]) -> list[float]:
    """Cumulative seconds at every vertex. Progress anchors may be sparse; fill between by distance."""
    last = len(miles) - 1
    if progress[0][0] != 0 or progress[-1][0] != last:
        raise ValueError("progress must start at the first point and end at the last point")
    seconds = [0.0] * len(miles)
    for (i, t0), (j, t1) in zip(progress, progress[1:], strict=False):
        if j <= i or t1 < t0:
            raise ValueError("progress must move forward in both index and time")
        span = miles[j] - miles[i]
        for k in range(i, j + 1):
            seconds[k] = t0 + (t1 - t0) * ((miles[k] - miles[i]) / span if span else 0.0)
    return seconds


def build_checkpoints(
    points: Sequence[LatLon],
    progress: Sequence[tuple[int, float]],
    departure: datetime,
    spacing_mi: float,
) -> list[Checkpoint]:
    """A checkpoint at mile 0, every `spacing_mi`, and at the route end.

    `progress` is the routing API's (point index, cumulative seconds) list, so ETAs follow the
    real speed profile instead of an average speed.
    """
    if len(points) < 2 or spacing_mi <= 0:
        raise ValueError("need at least 2 points and a positive spacing")
    if departure.tzinfo is None:
        raise ValueError("departure must be timezone-aware")
    miles = cumulative_miles(points)
    seconds = _vertex_seconds(miles, progress)
    total = miles[-1]

    targets = [0.0]
    step = 1
    while step * spacing_mi < total - _END_SNAP_MI:
        targets.append(step * spacing_mi)
        step += 1
    if total > 0:
        targets.append(total)

    checkpoints = []
    for target in targets:
        i = min(bisect_right(miles, target) - 1, len(points) - 2)
        span = miles[i + 1] - miles[i]
        f = (target - miles[i]) / span if span else 0.0
        lat = points[i][0] + (points[i + 1][0] - points[i][0]) * f
        lon = points[i][1] + (points[i + 1][1] - points[i][1]) * f
        secs = seconds[i] + (seconds[i + 1] - seconds[i]) * f
        checkpoints.append(Checkpoint(target, lat, lon, departure + timedelta(seconds=secs)))
    return checkpoints
