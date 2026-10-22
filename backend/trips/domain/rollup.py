"""Per-route totals from rated checkpoints."""
from collections.abc import Sequence
from dataclasses import dataclass

from trips.domain.risk import Level


@dataclass(frozen=True)
class RatedPoint:
    mile: float
    level: Level | None  # None = no weather data; never counted as Low


@dataclass(frozen=True)
class Rollup:
    miles_by_level: dict[Level, float]
    unknown_mi: float
    avg_risk: float | None  # mileage-weighted over miles with known weather
    distance_mi: float
    duration_s: float


def rollup(points: Sequence[RatedPoint], total_mi: float, duration_s: float) -> Rollup:
    """Each checkpoint owns half of the gap to each neighbour (the route ends are owned in full)."""
    if not points:
        raise ValueError("rollup needs at least one checkpoint")
    miles = {level: 0.0 for level in Level}
    unknown = 0.0
    for i, point in enumerate(points):
        start = (points[i - 1].mile + point.mile) / 2 if i > 0 else 0.0
        end = (point.mile + points[i + 1].mile) / 2 if i + 1 < len(points) else total_mi
        owned = end - start
        if point.level is None:
            unknown += owned
        else:
            miles[point.level] += owned
    known = sum(miles.values())
    avg = sum(int(level) * mi for level, mi in miles.items()) / known if known else None
    return Rollup(miles, unknown, avg, total_mi, duration_s)
