"""Correctness audit: the brief's rules checked end to end, expectations written apart from the code.

Real-data checks run on two saved analyses: the December 2025 Wyoming wind replay and the Albuquerque-Denver
stress trip. The synthetic ones push boundary values and times through `analyze()` with Open-Meteo mocked.
"""
import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from trips.domain.risk import Level
from trips.integrations.geocode import Place
from trips.integrations.weather import snap
from trips.services.analyze import analyze
from trips.tests.test_analyze_api import CHICAGO, DENVER, mock_meteo, mock_tomtom

REPO = Path(__file__).resolve().parents[3]
STORM = REPO / "backend/trips/fixtures/demo_storm.json"
ABQ = REPO / "frontend/src/test/fixtures/analyze-abq-denver-mixed.json"
DEPART = datetime(2026, 10, 24, 8, 0, tzinfo=UTC)
HOUR = timedelta(hours=1)
ORIGIN, DEST = Place("Chicago", CHICAGO["lat"], CHICAGO["lon"]), Place("Denver", DENVER["lat"], DENVER["lon"])
DENVER_PLACE = Place("Denver", DENVER["lat"], DENVER["lon"])
LEVELS = list(Level)


def _saved(path: Path) -> dict:
    return json.loads(path.read_text())


@pytest.fixture(params=[STORM, ABQ], ids=["storm", "abq-denver"])
def saved(request):
    return _saved(request.param)


# --- rules re-derived from the brief's tables, applied to every real checkpoint -----------------------------

def brief_level(wind: float, rain: float, snow: float, load: float) -> int:
    """The brief's three tables and three load rules, written as plain comparisons (not bisect)."""
    def band(v, cuts):  # cuts = lower bounds of Moderate, High, Severe; then the No Travel test below
        return sum(v >= c for c in cuts)
    w = 4 if wind >= 55 else band(wind, (25, 35, 45))
    r = 4 if rain > 1.00 else band(rain, (0.10, 0.25, 0.50))
    s = 4 if snow > 3.0 else band(snow, (0.5, 1.0, 2.0))
    level = max(w, r, s)
    if wind >= 55 or (45 <= wind < 55 and load > 30_000):
        level = 4
    elif 35 <= wind < 45 and load > 40_000:
        level = max(level, 3)
    return level


def test_every_saved_checkpoint_level_matches_the_brief(saved):
    checked = 0
    for route in saved["routes"]:
        for cp in route["checkpoints"]:
            if cp["level"] is None:
                continue
            expected = brief_level(cp["windMph"], cp["rainInHr"], cp["snowInHr"], saved["loadLb"])
            assert cp["level"] == expected, (route["name"], cp["mile"], cp)
            assert cp["levelLabel"] == LEVELS[expected].label
            checked += 1
    assert checked > 50


def test_the_storm_exercises_the_load_rules_and_the_abq_trip_does_not_fake_them():
    storm = _saved(STORM)
    reasons = {
        cp["reason"].split(" is ")[-1]
        for r in storm["routes"]
        for cp in r["checkpoints"]
        if "lb load" in cp["reason"]
    }
    assert reasons == {"No Travel", "Severe"}  # 45-54 mph over 30,000 lb, and 35-44 mph over 40,000 lb


# --- mileage: midpoint split ------------------------------------------------------------------------------

def test_miles_by_level_are_the_midpoint_split_of_the_checkpoints(saved):
    for route in saved["routes"]:
        cps = route["checkpoints"]
        owned = {label: 0.0 for label in ("Low", "Moderate", "High", "Severe", "No Travel", "Unknown")}
        for i, cp in enumerate(cps):
            start = (cps[i - 1]["mile"] + cp["mile"]) / 2 if i else 0.0
            end = (cp["mile"] + cps[i + 1]["mile"]) / 2 if i + 1 < len(cps) else cps[-1]["mile"]
            owned[cp["levelLabel"]] += end - start
        for label, miles in route["milesByLevel"].items():
            assert miles == pytest.approx(owned[label], abs=0.11), (route["name"], label)
        assert route["unknownMi"] == pytest.approx(owned["Unknown"], abs=0.11)
        # TomTom's own distance and our polyline length agree within rounding of the polyline
        total = sum(route["milesByLevel"].values()) + route["unknownMi"]
        assert total == pytest.approx(route["distanceMi"], rel=0.01)
        known = sum(miles for label, miles in owned.items() if label != "Unknown")
        scale = ("Low", "Moderate", "High", "Severe", "No Travel")
        weighted = sum(i * owned[label] for i, label in enumerate(scale))
        assert route["avgRisk"] == pytest.approx(weighted / known, abs=0.011)


# --- ranking: the four rules (plus No Travel first) and their reason texts ---------------------------------

def test_ranking_follows_the_rules_and_each_reason_names_the_deciding_rule(saved):
    routes = {r["id"]: r for r in saved["routes"]}

    def key(r):
        m = r["milesByLevel"]
        miles = tuple(round(m[k], 1) for k in ("No Travel", "Severe", "High"))
        return (*miles, round(r["avgRisk"], 2), r["durationMin"])

    expected = sorted(routes.values(), key=key)
    assert [x["routeId"] for x in saved["ranking"]] == [r["id"] for r in expected]
    assert saved["recommendedRouteId"] == expected[0]["id"]
    rules = ["No Travel miles", "Severe miles", "High miles", "average risk", "travel time"]
    for entry in saved["ranking"]:
        mine = routes[entry["routeId"]]
        other = expected[0] if entry["rank"] > 1 else expected[1]
        first_diff = next(i for i, (a, b) in enumerate(zip(key(mine), key(other), strict=True)) if a != b)
        assert rules[first_diff] in entry["reason"], entry


def test_storm_story_is_what_the_documentation_says():
    storm = _saved(STORM)
    a, b, c = storm["routes"]
    assert a["milesByLevel"]["No Travel"] > 0
    assert b["milesByLevel"]["No Travel"] == c["milesByLevel"]["No Travel"] == 0
    assert storm["recommendedRouteId"] == b["id"]
    assert b["durationMin"] > a["durationMin"]  # safer, not fastest
    assert storm["ranking"][0]["reason"].startswith("Route B: average risk")  # Severe miles tie with Route C
    assert storm["ranking"][-1]["reason"].startswith("Route A: 75 No Travel miles")


# --- ETA to forecast hour (Open-Meteo stamps precipitation at the END of its hour) ------------------------

def test_rain_is_taken_from_the_hour_that_ends_at_or_after_the_eta(respx_mock):
    """Rain only in the hour 10:00-11:00 (stamped 11:00 by Open-Meteo): ETAs in (10:00, 11:00] feel it."""
    mock_tomtom(respx_mock)
    stamp = DEPART + 3 * HOUR
    mock_meteo(respx_mock, rain=lambda _la, _lo, t: 0.30 if t == stamp else 0.0)  # 0.30 in/hr = High
    data = analyze(ORIGIN, DEST, DEPART, 20_000, 25)
    wet = dry = 0
    for route in data["routes"]:
        for cp in route["checkpoints"]:
            eta = datetime.fromisoformat(cp["eta"])
            expected = Level.HIGH if stamp - HOUR < eta <= stamp else Level.LOW
            assert cp["level"] == expected, (cp["eta"], cp["reason"])
            wet += expected == Level.HIGH
            dry += expected == Level.LOW
    assert wet > 3 and dry > 20


def test_wind_is_taken_from_the_nearest_hour(respx_mock):
    mock_tomtom(respx_mock)
    stamp = DEPART + 3 * HOUR
    # 50 mph is Severe for a 20,000 lb load
    mock_meteo(respx_mock, wind=lambda _la, _lo, t: 50.0 if t == stamp else 0.0)
    data = analyze(ORIGIN, DEST, DEPART, 20_000, 25)
    severe = 0
    for route in data["routes"]:
        for cp in route["checkpoints"]:
            gap = abs((datetime.fromisoformat(cp["eta"]) - stamp) / HOUR)
            if gap < 0.49:
                assert cp["level"] == Level.SEVERE, cp
                severe += 1
            elif gap > 0.51:
                assert cp["level"] == Level.LOW, cp
    assert severe > 3


# --- heatmap agrees with the checkpoints ---------------------------------------------------------------

def sweep(lat, lon, _t):
    """Deterministic pseudo-random value in [0, 1): steps through every band of every hazard."""
    return ((lat * 7919 + lon * 104729) * 1000 % 997) / 997


def test_heatmap_cell_level_equals_checkpoint_level_at_every_hour(respx_mock):
    """Weather constant in time, varied across cells: a checkpoint and its heatmap cell agree at all 49 hours.

    The sweep covers 0-60 mph, 0-1.2 in/hr rain and 0-3.6 in/hr snow, so values land near every boundary.
    The trip is short enough that heatmap and checkpoints share the 0.25 degree lattice."""
    mock_tomtom(respx_mock, "tomtom_denver_saltlake.json")
    mock_meteo(
        respx_mock,
        wind=lambda la, lo, t: round(sweep(la, lo, t) * 60, 1),
        rain=lambda la, lo, t: round(sweep(lo, la, t) * 1.2, 2),
        snow=lambda la, lo, t: round(sweep(la + 1, lo, t) * 3.6, 2),
    )
    for load in (20_000, 35_000, 45_000):
        data = analyze(DENVER_PLACE, Place("Salt Lake City", 40.7608, -111.891), DEPART, load, 25)
        heat = data["heatmap"]
        assert heat["stepDeg"] == 0.25 and not data["warnings"]
        cells = {(p["lat"], p["lon"]): p["scores"] for p in heat["points"]}
        compared = mismatches = 0
        for route in data["routes"]:
            for cp in route["checkpoints"]:
                scores = cells.get(snap(cp["lat"], cp["lon"], heat["stepDeg"]))
                if scores is None:
                    continue
                compared += 1
                if any(s // heat["scoreScale"] != cp["level"] for s in scores):
                    mismatches += 1
        assert compared > 60
        assert mismatches == 0, f"{mismatches}/{compared} checkpoints differ from the heatmap ({load} lb)"
