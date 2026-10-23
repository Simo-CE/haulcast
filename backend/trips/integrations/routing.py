"""TomTom truck routing: up to 3 distinct routes with per-point travel-time anchors."""
import logging
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from django.conf import settings
from django.core.cache import cache

from trips.domain.checkpoints import LatLon, haversine_mi
from trips.domain.routes_select import MAX_ROUTES, Candidate, select_routes
from trips.domain.via import OFFSET_SHARES, via_points
from trips.integrations.http import IntegrationError, get_json
from trips.integrations.polyline import decode_polyline

URL = "https://api.tomtom.com/routing/1/calculateRoute/{path}/json"
METERS_PER_MILE = 1609.344
KG_PER_LB = 0.45359237
TARE_LB = 33_000  # assumed empty tractor + 53 ft trailer; the request's load is the payload on top
WEIGHT_BUCKET_LB = 5_000
SOFT_LIMIT_LB = 80_000
MIN_TRIP_MI = 0.5  # TomTom answers a zero-length route for identical points
CACHE_SECONDS = 3600
MAX_ALTERNATIVES = 2  # TomTom time grows with it: measured 1 s for 0, 2 s for 2 and 4 s for 5 (535 mi)
Progress = list[tuple[int, float]]
log = logging.getLogger(__name__)


@dataclass
class RouteSet:
    routes: list[Candidate]  # distinct routes, fastest first
    progress: dict[str, Progress]  # candidate id -> (point index, cumulative seconds)
    dropped: list[tuple[str, str]] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


def gross_weight_lb(load_lb: float) -> int:
    """Tare plus payload, rounded up to a bucket so nearby loads share a cache entry."""
    buckets = -(-(TARE_LB + load_lb) // WEIGHT_BUCKET_LB)
    return int(buckets * WEIGHT_BUCKET_LB)


def build_params(departure: datetime, gross_lb: int, max_alternatives: int) -> dict[str, Any]:
    return {
        "key": settings.TOMTOM_KEY,
        "travelMode": "truck",
        "maxAlternatives": max_alternatives,
        "routeType": "fastest",
        "traffic": "true",
        "departAt": departure.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "vehicleCommercial": "true",
        "vehicleWeight": round(gross_lb * KG_PER_LB),
        "routeRepresentation": "encodedPolyline",
        "extendedRouteRepresentation": "travelTime",
        "computeTravelTimeFor": "all",
    }


def _request(
    origin: LatLon, destination: LatLon, params: dict[str, Any], via: LatLon | None = None
) -> list[dict[str, Any]]:
    stops = [origin, destination] if via is None else [origin, via, destination]
    url = URL.format(path=":".join("{:.5f},{:.5f}".format(*p) for p in stops))
    routes = get_json("TomTom routing", url, params).get("routes")
    if not routes:
        raise IntegrationError("TomTom routing returned no routes")
    return routes


def _parse(raw: dict[str, Any]) -> tuple[list[LatLon], float, float, Progress]:
    try:
        # A route through a via point has one leg per stop; `progress` indexes their points end to end.
        points = [
            p
            for leg in raw["legs"]
            for p in decode_polyline(leg["encodedPolyline"], leg["encodedPolylinePrecision"])
        ]
        progress = [(int(p["pointIndex"]), float(p["travelTimeInSeconds"])) for p in raw["progress"]]
        summary = raw["summary"]
        miles = summary["lengthInMeters"] / METERS_PER_MILE
        return points, miles, float(summary["travelTimeInSeconds"]), progress
    except (KeyError, ValueError, TypeError) as exc:
        raise IntegrationError(f"TomTom route has an unexpected shape: {type(exc).__name__}") from None


def _candidates(raw_routes: list[dict[str, Any]], prefix: str) -> tuple[list[Candidate], dict[str, Progress]]:
    candidates, progress = [], {}
    for i, raw in enumerate(raw_routes):
        points, miles, seconds, prog = _parse(raw)
        candidates.append(Candidate(f"{prefix}{i}", points, miles, seconds))
        progress[f"{prefix}{i}"] = prog
    return candidates, progress


def _select(raw_routes: list[dict[str, Any]]) -> RouteSet:
    candidates, progress = _candidates(raw_routes, "r")
    selection = select_routes(candidates)
    return RouteSet(selection.selected, progress, selection.dropped)


def _via_route(
    origin: LatLon, destination: LatLon, via: LatLon, params: dict[str, Any], prefix: str
) -> tuple[list[Candidate], dict[str, Progress]]:
    try:
        return _candidates(_request(origin, destination, params, via)[:1], prefix)
    except IntegrationError as exc:  # a via point on no road, or a flaky call: this variant is just skipped
        log.info("via route %s skipped: %s", prefix, exc)
        return [], {}


def fetch_routes(origin: LatLon, destination: LatLon, departure: datetime, load_lb: float) -> RouteSet:
    if departure.tzinfo is None:
        raise ValueError("departure must be timezone-aware")
    if haversine_mi(origin, destination) < MIN_TRIP_MI:
        raise ValueError("origin and destination are the same place")
    gross = gross_weight_lb(load_lb)
    hour = departure.astimezone(UTC).replace(minute=0, second=0, microsecond=0)
    key = "routes:{:.4f},{:.4f}:{:.4f},{:.4f}:{:%Y%m%d%H}:{}".format(*origin, *destination, hour, gross)
    if (cached := cache.get(key)) is not None:
        return cached

    # One request first; the via-point variants below run in parallel and only when 3 routes are missing.
    raw_routes = _request(origin, destination, build_params(hour, gross, max_alternatives=MAX_ALTERNATIVES))
    candidates, progress = _candidates(raw_routes, "r")
    selection = select_routes(candidates)
    params = build_params(hour, gross, max_alternatives=0)
    for share in OFFSET_SHARES:
        if len(selection.selected) >= MAX_ROUTES:
            break
        # TomTom often offers fewer than 3 alternatives. Route through a point on each side of the trip
        # to get distinct ones; select_routes still drops near-duplicates and absurd detours.
        stops = via_points(origin, destination, share)
        with ThreadPoolExecutor(max_workers=2) as pool:
            variants = pool.map(
                lambda iv, tag=f"v{share}": _via_route(origin, destination, iv[1], params, f"{tag}{iv[0]}"),
                enumerate(stops),
            )
            for extra, extra_progress in variants:
                candidates += extra
                progress.update(extra_progress)
        selection = select_routes(candidates)
    result = RouteSet(selection.selected, progress, selection.dropped)
    if selection.detours:
        longest = max(c.distance_mi for c in result.routes) / result.routes[0].distance_mi
        result.warnings.append(
            f"Few good alternatives exist for this trip; the extra route(s) are long detours "
            f"(up to {longest - 1:.0%} longer than the fastest)."
        )
    if len(result.routes) < MAX_ROUTES:
        result.warnings.append(f"Only {len(result.routes)} distinct route(s) found for this trip.")
    if TARE_LB + load_lb > SOFT_LIMIT_LB:
        result.warnings.append(f"Gross weight {TARE_LB + load_lb:,.0f} lb is above {SOFT_LIMIT_LB:,} lb.")
    cache.set(key, result, CACHE_SECONDS)
    return result
