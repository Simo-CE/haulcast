"""Rank routes: No Travel miles, Severe miles, High miles, average risk, then duration."""
import math
from collections.abc import Callable, Sequence
from dataclasses import dataclass

from trips.domain.risk import Level
from trips.domain.rollup import Rollup


@dataclass(frozen=True)
class RouteSummary:
    id: str
    name: str
    rollup: Rollup


@dataclass(frozen=True)
class RankedRoute:
    id: str
    rank: int
    reason: str


def _miles(level: Level) -> Callable[[Rollup], float]:
    return lambda r: r.miles_by_level[level]


def _avg(r: Rollup) -> float:
    return math.inf if r.avg_risk is None else r.avg_risk  # no weather data cannot win on safety


def _fmt_miles(value: float) -> str:
    return f"{value:.1f}".removesuffix(".0")


def _fmt_time(seconds: float) -> str:
    minutes = round(seconds / 60)
    return f"{minutes // 60}h {minutes % 60:02d}m"


# (rollup accessor, rounding in the sort key, label template). Order is the ranking rule order.
# Rounding only absorbs float noise from the midpoint split (0.01 mi), it is not a tolerance.
_CRITERIA: list[tuple[Callable[[Rollup], float], int, Callable[[float], str], str]] = [
    (_miles(Level.NO_TRAVEL), 2, _fmt_miles, "{a} No Travel miles vs {b}"),
    (_miles(Level.SEVERE), 2, _fmt_miles, "{a} Severe miles vs {b}"),
    (_miles(Level.HIGH), 2, _fmt_miles, "{a} High miles vs {b}"),
    (_avg, 3, lambda v: "no data" if math.isinf(v) else f"{v:.2f}", "average risk {a} vs {b}"),
    (lambda r: r.duration_s, 0, _fmt_time, "travel time {a} vs {b}"),
]


def _key(route: RouteSummary) -> tuple[float, ...]:
    return tuple(round(get(route.rollup), digits) for get, digits, _, _ in _CRITERIA)


def _compare(mine: RouteSummary, other: RouteSummary) -> str:
    """Describe the first ranking rule on which the two routes differ."""
    for (get, _digits, fmt, template), a, b in zip(
        _CRITERIA, _key(mine), _key(other), strict=True
    ):
        if a != b:
            text = template.format(a=fmt(get(mine.rollup)), b=fmt(get(other.rollup)))
            return f"{mine.name}: {text} on {other.name}"
    return f"{mine.name}: ties {other.name} on every criterion"


def rank_routes(routes: Sequence[RouteSummary]) -> list[RankedRoute]:
    """Best first. Equal routes keep their input order (sort is stable)."""
    if not routes:
        return []
    ordered = sorted(routes, key=_key)
    if len(ordered) == 1:
        return [RankedRoute(ordered[0].id, 1, f"{ordered[0].name}: the only route available")]
    best = ordered[0]
    ranked = [RankedRoute(best.id, 1, _compare(best, ordered[1]))]
    ranked += [RankedRoute(r.id, i, _compare(r, best)) for i, r in enumerate(ordered[1:], start=2)]
    return ranked
