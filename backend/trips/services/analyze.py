"""Orchestrates one analysis: geocode, routes, weather, risk, rollup, ranking and the heatmap grid.

A thin layer: every risk, rollup and ranking decision is made in trips.domain.
"""
import logging
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from trips.domain.checkpoints import Checkpoint, build_checkpoints, haversine_mi
from trips.domain.corridor import corridor_cells
from trips.domain.recommend import RouteSummary, rank_routes
from trips.domain.risk import Level, checkpoint_risk, risk_score
from trips.domain.rollup import RatedPoint, rollup
from trips.domain.routes_select import MAX_ROUTES, Candidate
from trips.integrations.geocode import Place, geocode
from trips.integrations.routing import MIN_TRIP_MI, Progress, fetch_routes
from trips.integrations.weather import (
    CHUNK,
    LATTICE_DEG,
    MAX_CELLS,
    Cell,
    Forecast,
    WeatherPoint,
    fetch_forecasts,
    snap,
)

log = logging.getLogger(__name__)

HEAT_HOURS = 49  # +0h..+48h from the departure hour
CORRIDOR_MI = 20
LATTICE_STEPS = (LATTICE_DEG, 2 * LATTICE_DEG, 4 * LATTICE_DEG)  # finest first; all on the base lattice
SAMPLE_MI = 10  # corridor sampling distance along each route
SCORE_SCALE = 10  # heatmap scores are the 0-4 risk score in tenths, as integers
UNKNOWN_SCORE = -1
GEOMETRY_STEP_MI = 0.1  # thin the polyline for the wire; invisible on a map
_HOUR = timedelta(hours=1)


class InputError(Exception):
    """The request is well formed but cannot be analysed; `field` names the input to fix."""

    def __init__(self, field: str, message: str) -> None:
        super().__init__(message)
        self.field, self.message = field, message


@dataclass(frozen=True)
class _Route:
    candidate: Candidate
    name: str
    progress: Progress
    checkpoints: list[Checkpoint]


def _iso(moment: datetime) -> str:
    return moment.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def _resolve(value: str | Place, field: str) -> Place:
    if isinstance(value, Place):
        return value
    place = geocode(value)
    if place is None:
        raise InputError(field, f"Could not find a US location for {value!r}. Try a fuller address.")
    return place


def _plan_cells(routes: list[_Route], departure: datetime) -> tuple[float, float, set[Cell], set[Cell]]:
    """Pick the finest lattices (checkpoints, heatmap) whose cells fit the Open-Meteo budget.

    Returns (checkpoint step, heatmap step, checkpoint cells, heatmap cells). The heatmap may be coarser
    than the checkpoints, never finer.
    """
    samples = [
        (p.lat, p.lon)
        for r in routes
        for p in build_checkpoints(r.candidate.points, r.progress, departure, SAMPLE_MI)
    ]
    heat = {step: corridor_cells(samples, step, CORRIDOR_MI) for step in LATTICE_STEPS}
    for i, ck_step in enumerate(LATTICE_STEPS):
        ck = {snap(p.lat, p.lon, ck_step) for r in routes for p in r.checkpoints}
        if len(ck) > MAX_CELLS:
            continue
        for heat_step in LATTICE_STEPS[i:]:
            if len(ck | heat[heat_step]) <= MAX_CELLS:
                return ck_step, heat_step, ck, heat[heat_step]
    raise InputError("spacingMi", "This trip needs too many weather points. Choose a wider spacing.")


def _fetch_weather(cells: list[Cell], first: datetime, last: datetime) -> dict[Cell, Forecast]:
    """Chunks fetched in parallel: 270 cells took 2.55 s one after another and 0.65 s together."""
    batches = [cells[i : i + CHUNK] for i in range(0, len(cells), CHUNK)]
    with ThreadPoolExecutor(max_workers=len(batches)) as pool:
        merged: dict[Cell, Forecast] = {}
        for part in pool.map(lambda batch: fetch_forecasts(batch, first, last), batches):
            merged.update(part)
    return merged


def _rate(wx: WeatherPoint, load_lb: float) -> tuple[Level | None, str]:
    if None in (wx.wind_mph, wx.rain_in_hr, wx.snow_in_hr):
        return None, "No forecast available"  # unknown is never counted as Low
    return checkpoint_risk(wx.wind_mph, wx.rain_in_hr, wx.snow_in_hr, load_lb)


def _score(wx: WeatherPoint, load_lb: float) -> int:
    if None in (wx.wind_mph, wx.rain_in_hr, wx.snow_in_hr):
        return UNKNOWN_SCORE
    return round(risk_score(wx.wind_mph, wx.rain_in_hr, wx.snow_in_hr, load_lb) * SCORE_SCALE)


def _geometry(route: _Route) -> list[list[float]]:
    """[lon, lat] pairs (GeoJSON order), thinned so a coast-to-coast route is not 50,000 points."""
    pts = route.candidate.points
    kept = [pts[0]]
    for p in pts[1:-1]:
        if haversine_mi(kept[-1], p) >= GEOMETRY_STEP_MI:
            kept.append(p)
    kept.append(pts[-1])
    return [[round(lon, 5), round(lat, 5)] for lat, lon in kept]


def _checkpoint_json(cp: Checkpoint, wx: WeatherPoint, level: Level | None, reason: str) -> dict[str, Any]:
    return {
        "mile": round(cp.mile, 1), "lat": round(cp.lat, 5), "lon": round(cp.lon, 5), "eta": _iso(cp.eta),
        "windMph": wx.wind_mph, "gustMph": wx.gust_mph, "rainInHr": wx.rain_in_hr, "snowInHr": wx.snow_in_hr,
        "level": None if level is None else int(level),
        "levelLabel": "Unknown" if level is None else level.label,
        "reason": reason,
    }


def analyze(
    origin: str | Place, destination: str | Place, departure: datetime, load_lb: float, spacing_mi: int
) -> dict[str, Any]:
    t0 = time.perf_counter()
    with ThreadPoolExecutor(max_workers=2) as pool:
        a = pool.submit(_resolve, origin, "origin")
        b = pool.submit(_resolve, destination, "destination")
        start, end = a.result(), b.result()
    if haversine_mi((start.lat, start.lon), (end.lat, end.lon)) < MIN_TRIP_MI:
        raise InputError("destination", "Origin and destination are the same place.")
    t_geo = time.perf_counter()

    route_set = fetch_routes((start.lat, start.lon), (end.lat, end.lon), departure, load_lb)
    t_routes = time.perf_counter()
    routes = [
        _Route(c, f"Route {chr(65 + i)}", route_set.progress[c.id],
               build_checkpoints(c.points, route_set.progress[c.id], departure, spacing_mi))
        for i, c in enumerate(route_set.routes)
    ]
    warnings = list(route_set.warnings)

    ck_step, heat_step, ck_cells, heat_cells = _plan_cells(routes, departure)
    if ck_step > LATTICE_DEG:
        warnings.append(
            f"Long trip: weather is sampled on a {ck_step}° grid (about {ck_step * 69:.0f} mi) to stay "
            "within the forecast data budget."
        )
    first = departure.astimezone(UTC).replace(minute=0, second=0, microsecond=0)
    last = max([first + (HEAT_HOURS - 1) * _HOUR, *(r.checkpoints[-1].eta for r in routes)])
    forecasts = _fetch_weather(sorted(ck_cells | heat_cells), departure, last)
    t_weather = time.perf_counter()

    route_json, summaries = [], []
    for r in routes:
        rated, points = [], []
        for cp in r.checkpoints:
            wx = forecasts[snap(cp.lat, cp.lon, ck_step)].at(cp.eta)
            level, reason = _rate(wx, load_lb)
            rated.append(RatedPoint(cp.mile, level))
            points.append(_checkpoint_json(cp, wx, level, reason))
        totals = rollup(rated, r.checkpoints[-1].mile, r.candidate.duration_s)
        summaries.append(RouteSummary(r.candidate.id, r.name, totals))
        if totals.unknown_mi > 0.01:
            warnings.append(
                f"{r.name}: {totals.unknown_mi:.0f} mi have no weather forecast. They are shown as "
                "unknown and left out of its average risk."
            )
        route_json.append({
            "id": r.candidate.id, "name": r.name,
            "distanceMi": round(r.candidate.distance_mi, 1),
            "durationMin": round(r.candidate.duration_s / 60),
            "milesByLevel": {lv.label: round(totals.miles_by_level[lv], 1) for lv in Level},
            "unknownMi": round(totals.unknown_mi, 1),
            "avgRisk": None if totals.avg_risk is None else round(totals.avg_risk, 2),
            "geometry": _geometry(r), "checkpoints": points,
        })

    ranking = rank_routes(summaries)
    heatmap_points = [
        {"lat": cell[0], "lon": cell[1],
         "scores": [_score(forecasts[cell].at(first + h * _HOUR), load_lb) for h in range(HEAT_HOURS)]}
        for cell in sorted(heat_cells)
    ]
    done = time.perf_counter()
    timings = {"geocode": t_geo - t0, "routes": t_routes - t_geo, "weather": t_weather - t_routes,
               "risk": done - t_weather, "total": done - t0}
    log.info("analyze %d routes, %d cells: %s", len(routes), len(ck_cells | heat_cells),
             {k: f"{v * 1000:.0f}ms" for k, v in timings.items()})
    return {
        "origin": _place_json(start), "destination": _place_json(end),
        "departure": _iso(departure), "loadLb": load_lb, "spacingMi": spacing_mi,
        "routes": route_json,
        "recommendedRouteId": ranking[0].id,
        "ranking": [{"routeId": r.id, "rank": r.rank, "reason": r.reason} for r in ranking],
        "heatmap": {"startTime": _iso(first), "hours": HEAT_HOURS, "stepDeg": heat_step,
                    "scoreScale": SCORE_SCALE, "unknownScore": UNKNOWN_SCORE, "points": heatmap_points},
        "warnings": warnings,
        "complete": len(routes) >= MAX_ROUTES,
        "timingsMs": {k: round(v * 1000) for k, v in timings.items()},
    }


def _place_json(place: Place) -> dict[str, Any]:
    return {"label": place.label, "lat": round(place.lat, 5), "lon": round(place.lon, 5)}
