"""TomTom truck routing: up to 3 distinct routes with per-point travel-time anchors."""
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from django.conf import settings
from django.core.cache import cache

from trips.domain.checkpoints import LatLon, haversine_mi
from trips.domain.routes_select import MAX_ROUTES, Candidate, select_routes
from trips.integrations.http import IntegrationError, get_json
from trips.integrations.polyline import decode_polyline

URL = "https://api.tomtom.com/routing/1/calculateRoute/{o}:{d}/json"
METERS_PER_MILE = 1609.344
KG_PER_LB = 0.45359237
TARE_LB = 33_000  # assumed empty tractor + 53 ft trailer; the request's load is the payload on top
WEIGHT_BUCKET_LB = 5_000
SOFT_LIMIT_LB = 80_000
MIN_TRIP_MI = 0.5  # TomTom answers a zero-length route for identical points
CACHE_SECONDS = 3600
MAX_ALTERNATIVES = 2  # TomTom time grows with it: measured 1 s for 0, 2 s for 2 and 4 s for 5 (535 mi)
Progress = list[tuple[int, float]]


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


def _request(origin: LatLon, destination: LatLon, params: dict[str, Any]) -> list[dict[str, Any]]:
    url = URL.format(o="{:.5f},{:.5f}".format(*origin), d="{:.5f},{:.5f}".format(*destination))
    routes = get_json("TomTom routing", url, params).get("routes")
    if not routes:
        raise IntegrationError("TomTom routing returned no routes")
    return routes


def _parse(raw: dict[str, Any]) -> tuple[list[LatLon], float, float, Progress]:
    try:
        (leg,) = raw["legs"]
        points = decode_polyline(leg["encodedPolyline"], leg["encodedPolylinePrecision"])
        progress = [(int(p["pointIndex"]), float(p["travelTimeInSeconds"])) for p in raw["progress"]]
        summary = raw["summary"]
        miles = summary["lengthInMeters"] / METERS_PER_MILE
        return points, miles, float(summary["travelTimeInSeconds"]), progress
    except (KeyError, ValueError, TypeError) as exc:
        raise IntegrationError(f"TomTom route has an unexpected shape: {type(exc).__name__}") from None


def _select(raw_routes: list[dict[str, Any]]) -> RouteSet:
    candidates, progress = [], {}
    for i, raw in enumerate(raw_routes):
        points, miles, seconds, prog = _parse(raw)
        candidates.append(Candidate(f"r{i}", points, miles, seconds))
        progress[f"r{i}"] = prog
    selection = select_routes(candidates)
    return RouteSet(selection.selected, progress, selection.dropped)


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

    # One request, never a second sequential one: each costs seconds and a quota call.
    raw_routes = _request(origin, destination, build_params(hour, gross, max_alternatives=MAX_ALTERNATIVES))
    result = _select(raw_routes)
    if len(result.routes) < MAX_ROUTES:
        result.warnings.append(f"Only {len(result.routes)} distinct route(s) found for this trip.")
    if TARE_LB + load_lb > SOFT_LIMIT_LB:
        result.warnings.append(f"Gross weight {TARE_LB + load_lb:,.0f} lb is above {SOFT_LIMIT_LB:,} lb.")
    cache.set(key, result, CACHE_SECONDS)
    return result
