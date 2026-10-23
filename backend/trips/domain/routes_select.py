"""Pick up to 3 distinct routes from the routing API's candidates."""
import math
from collections.abc import Sequence
from dataclasses import dataclass, field

from trips.domain.checkpoints import LatLon, haversine_mi

MAX_ROUTES = 3
MAX_OVERLAP = 0.85
MAX_DETOUR = 1.5
# Used only to reach 3 routes when too few reasonable ones exist (a trip with a single sensible road)
RELAXED_DETOUR = 2.0
# Two roads closer than this are the same road for our purposes; also the resampling step.
_NEAR_MI = 0.25
_CELL_DEG = 0.01  # about 0.7 mi, larger than _NEAR_MI so a 3x3 cell lookup is enough


@dataclass(frozen=True)
class Candidate:
    id: str
    points: Sequence[LatLon]
    distance_mi: float
    duration_s: float


@dataclass
class Selection:
    selected: list[Candidate]
    dropped: list[tuple[str, str]] = field(default_factory=list)  # (candidate id, reason)
    detours: list[str] = field(default_factory=list)  # selected ids that exceed MAX_DETOUR


def _resample(points: Sequence[LatLon], step_mi: float) -> list[LatLon]:
    out = [points[0]]
    carried = 0.0  # miles since the last emitted point
    for a, b in zip(points, points[1:], strict=False):
        seg = haversine_mi(a, b)
        d = step_mi - carried
        while d <= seg:
            f = d / seg
            out.append((a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f))
            d += step_mi
        carried = (carried + seg) % step_mi if seg else carried
    return out


def _cell(p: LatLon) -> tuple[int, int]:
    return math.floor(p[0] / _CELL_DEG), math.floor(p[1] / _CELL_DEG)


def overlap_fraction(a: Sequence[LatLon], b: Sequence[LatLon]) -> float:
    """Share of route `a` (by length) that runs within a quarter mile of route `b`."""
    grid: dict[tuple[int, int], list[LatLon]] = {}
    for p in _resample(b, _NEAR_MI):
        grid.setdefault(_cell(p), []).append(p)
    samples = _resample(a, _NEAR_MI)
    near = 0
    for p in samples:
        ci, cj = _cell(p)
        if any(
            haversine_mi(p, q) <= _NEAR_MI
            for di in (-1, 0, 1)
            for dj in (-1, 0, 1)
            for q in grid.get((ci + di, cj + dj), ())
        ):
            near += 1
    return near / len(samples)


def _overlaps(cand: Candidate, selected: Sequence[Candidate]) -> tuple[float, str] | None:
    """The closest match among the selected routes, if it shares more than MAX_OVERLAP."""
    shared = [(overlap_fraction(cand.points, s.points), s.id) for s in selected]
    return max(shared) if shared and max(shared)[0] > MAX_OVERLAP else None


def select_routes(candidates: Sequence[Candidate]) -> Selection:
    """Fastest first; skip near-duplicates (over 85% shared) and absurd detours (over 1.5x length).

    If that leaves fewer than 3, detours up to RELAXED_DETOUR are accepted (and listed in `detours`):
    the app promises 3 options, and a trip with one sensible road has only long ones to offer.
    """
    by_speed = sorted(candidates, key=lambda c: c.duration_s)
    result = Selection([])
    too_long: list[Candidate] = []
    for cand in by_speed:
        if len(result.selected) == MAX_ROUTES:
            break
        if result.selected and cand.distance_mi > MAX_DETOUR * by_speed[0].distance_mi:
            too_long.append(cand)
            continue
        if match := _overlaps(cand, result.selected):
            result.dropped.append((cand.id, f"{match[0]:.0%} overlap with {match[1]}"))
            continue
        result.selected.append(cand)
    for cand in too_long:
        if len(result.selected) < MAX_ROUTES and cand.distance_mi <= RELAXED_DETOUR * by_speed[0].distance_mi:
            if not _overlaps(cand, result.selected):
                result.selected.append(cand)
                result.detours.append(cand.id)
                continue
        result.dropped.append((cand.id, f"longer than {MAX_DETOUR}x the fastest route"))
    result.selected.sort(key=lambda c: c.duration_s)
    return result
