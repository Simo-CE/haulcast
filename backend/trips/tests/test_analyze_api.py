"""POST /api/analyze end to end, offline: saved real TomTom routes, Open-Meteo faked from the request."""
import itertools
from datetime import UTC, datetime, timedelta

import httpx
import pytest
from rest_framework.test import APIClient

from trips import serializers
from trips.domain.checkpoints import build_checkpoints
from trips.integrations import routing
from trips.integrations.weather import snap
from trips.tests.conftest import load_fixture

NOW = datetime(2026, 10, 23, 12, 0, tzinfo=UTC)
DEPART = datetime(2026, 10, 24, 8, 0, tzinfo=UTC)
CHICAGO, DENVER = {"lat": 41.8781, "lon": -87.6298}, {"lat": 39.7392, "lon": -104.9903}
MILWAUKEE = {"lat": 43.0389, "lon": -87.9065}
SEATTLE, MIAMI = {"lat": 47.6062, "lon": -122.3321}, {"lat": 25.7617, "lon": -80.1918}
TOMTOM = r"https://api\.tomtom\.com/routing/1/calculateRoute/.*"
METEO = r"https://(api\.open-meteo\.com/v1/forecast|haulcast\.dooma\.dev/openmeteo).*"
GEOCODE = r"https://api\.tomtom\.com/search/2/geocode/.*"
STORM_MPH = 60  # No Travel for any load


@pytest.fixture(autouse=True)
def _clock(monkeypatch):
    monkeypatch.setattr(serializers, "_now", lambda: NOW)


def body(origin=CHICAGO, destination=DENVER, **changes) -> dict:
    return {"origin": origin, "destination": destination, "departure": "2026-10-24T08:00:00Z",
            "loadLb": 42000, "spacingMi": 25, **changes}


def post(**kw):
    return APIClient().post("/api/analyze", body(**kw), format="json")


def calm(_lat, _lon, _t):
    return 0.0


def mock_meteo(respx_mock, wind=calm, rain=calm, snow=calm):
    """Open-Meteo stand-in: builds the hourly arrays the real API would, from the request's own cells."""
    def respond(request: httpx.Request) -> httpx.Response:
        q = request.url.params
        lats, lons = q["latitude"].split(","), q["longitude"].split(",")
        start = datetime.fromisoformat(q["start_hour"]).replace(tzinfo=UTC)
        end = datetime.fromisoformat(q["end_hour"]).replace(tzinfo=UTC)
        hours = int((end - start) / timedelta(hours=1)) + 1
        times = [start + timedelta(hours=i) for i in range(hours)]
        units = {"time": "iso8601", "wind_speed_10m": "mp/h", "wind_gusts_10m": "mp/h", "rain": "inch",
                 "showers": "inch", "snowfall": "inch"}
        locations = []
        for lat, lon in zip(map(float, lats), map(float, lons), strict=True):
            w = [wind(lat, lon, t) for t in times]
            locations.append({"hourly_units": units, "hourly": {
                "time": [t.strftime("%Y-%m-%dT%H:%M") for t in times], "wind_speed_10m": w,
                "wind_gusts_10m": w, "rain": [rain(lat, lon, t) for t in times],
                "showers": [0.0] * hours, "snowfall": [snow(lat, lon, t) for t in times]}})
        return httpx.Response(200, json=locations if len(locations) > 1 else locations[0])

    return respx_mock.get(url__regex=METEO).mock(side_effect=respond)


def mock_tomtom(respx_mock, fixture="tomtom_chicago_denver.json"):
    return respx_mock.get(url__regex=TOMTOM).respond(json=load_fixture(fixture))


def locations_requested(route) -> int:
    return sum(len(c.request.url.params["latitude"].split(",")) for c in route.calls)


def unique_cells(fixture: str, index: int, spacing: int = 25) -> set:
    """Weather cells that only route `index` passes through."""
    route_set = routing._select(load_fixture(fixture)["routes"])
    cells = [
        {snap(p.lat, p.lon) for p in build_checkpoints(c.points, route_set.progress[c.id], DEPART, spacing)}
        for c in route_set.routes
    ]
    return cells[index] - set().union(*(c for i, c in enumerate(cells) if i != index))


def test_full_response_for_a_three_route_trip(respx_mock):
    mock_tomtom(respx_mock)
    meteo = mock_meteo(respx_mock)
    res = post()
    assert res.status_code == 200, res.content
    data = res.json()
    assert data["complete"] is True and data["warnings"] == []
    assert [r["id"] for r in data["routes"]] == ["r0", "r1", "r2"]
    assert data["recommendedRouteId"] == data["ranking"][0]["routeId"]
    assert [r["rank"] for r in data["ranking"]] == [1, 2, 3] and all(r["reason"] for r in data["ranking"])
    for route in data["routes"]:
        cps = route["checkpoints"]
        assert cps[0]["mile"] == 0 and cps[0]["eta"] == "2026-10-24T08:00:00Z"
        last_eta = datetime.fromisoformat(cps[-1]["eta"])
        assert (last_eta - DEPART).total_seconds() / 60 == pytest.approx(route["durationMin"], abs=1)
        assert set(route["milesByLevel"]) == {"Low", "Moderate", "High", "Severe", "No Travel"}
        assert sum(route["milesByLevel"].values()) == pytest.approx(route["distanceMi"], rel=0.01)
        assert route["avgRisk"] == 0 and {c["levelLabel"] for c in cps} == {"Low"}
        assert len(route["geometry"]) > 100
        assert route["geometry"][0] == pytest.approx([-87.6298, 41.8781], abs=0.01)
    assert locations_requested(meteo) <= 300
    assert {"label", "lat", "lon"} == set(data["origin"])


def test_heatmap_carries_49_hours_per_cell_so_the_slider_needs_no_network(respx_mock):
    mock_tomtom(respx_mock)
    ramp = lambda _la, _lo, t: (t - DEPART).total_seconds() / 3600 * 2  # noqa: E731  0..96 mph
    meteo = mock_meteo(respx_mock, wind=ramp)
    heat = post().json()["heatmap"]
    assert heat["hours"] == 49 and heat["startTime"] == "2026-10-24T08:00:00Z" and heat["scoreScale"] == 10
    assert heat["points"] and all(len(p["scores"]) == 49 for p in heat["points"])
    scores = heat["points"][0]["scores"]
    assert scores[0] == 0 and scores[48] == 40 and scores == sorted(scores)  # 0 mph .. 96 mph (No Travel)
    assert all(isinstance(s, int) for s in scores)
    assert locations_requested(meteo) <= 300


def test_heatmap_scores_follow_the_payload_load(respx_mock):
    mock_tomtom(respx_mock)
    mock_meteo(respx_mock, wind=lambda *_: 40.0)  # High on its own; Severe for loads over 40,000 lb
    light = post(loadLb=35000).json()["heatmap"]["points"][0]["scores"][0]
    heavy = post(loadLb=42000).json()["heatmap"]["points"][0]["scores"][0]
    assert (light, heavy) == (round(2.5 * 10), 30)  # 40 mph is half way through High


def test_load_rules_use_the_payload_not_the_routing_tare(respx_mock):
    mock_tomtom(respx_mock)
    mock_meteo(respx_mock, wind=lambda *_: 40.0)

    def levels(load: float) -> set[str]:
        routes = post(loadLb=load).json()["routes"]
        return {c["levelLabel"] for r in routes for c in r["checkpoints"]}

    assert levels(35000) == {"High"} and levels(42000) == {"Severe"}  # 33,000 lb tare would flip 35,000


def test_a_no_travel_checkpoint_ranks_that_route_last_even_though_it_is_fastest(respx_mock):
    mock_tomtom(respx_mock)
    storm = unique_cells("tomtom_chicago_denver.json", 0)
    assert storm
    mock_meteo(respx_mock, wind=lambda lat, lon, _t: STORM_MPH if (lat, lon) in storm else 0.0)
    data = post().json()
    by_id = {r["id"]: r for r in data["routes"]}
    assert by_id["r0"]["milesByLevel"]["No Travel"] > 0
    assert by_id["r1"]["milesByLevel"]["No Travel"] == by_id["r2"]["milesByLevel"]["No Travel"] == 0
    assert data["ranking"][-1]["routeId"] == "r0" and data["recommendedRouteId"] != "r0"
    assert "No Travel" in data["ranking"][-1]["reason"]


def test_missing_weather_is_unknown_never_low(respx_mock):
    mock_tomtom(respx_mock)
    hole = unique_cells("tomtom_chicago_denver.json", 0)
    mock_meteo(respx_mock, wind=lambda lat, lon, _t: None if (lat, lon) in hole else 0.0)
    data = post().json()
    r0 = data["routes"][0]
    unknown = [c for c in r0["checkpoints"] if c["levelLabel"] == "Unknown"]
    assert unknown and all(c["level"] is None and c["windMph"] is None for c in unknown)
    assert r0["unknownMi"] > 0
    # Low miles cover only the known stretch; the unknown stretch is not credited to any level.
    assert sum(r0["milesByLevel"].values()) + r0["unknownMi"] == pytest.approx(r0["distanceMi"], rel=0.01)
    assert sum(r0["milesByLevel"].values()) < r0["distanceMi"] - r0["unknownMi"] / 2
    assert any("Route A" in w and "no weather forecast" in w for w in data["warnings"])
    assert data["routes"][1]["unknownMi"] == 0
    assert all(p["scores"].count(-1) in (0, 49) for p in data["heatmap"]["points"])


def test_a_forecast_missing_for_the_whole_trip_cannot_win_on_safety(respx_mock):
    mock_tomtom(respx_mock)
    mock_meteo(respx_mock, wind=lambda *_: None)
    data = post().json()
    assert all(r["avgRisk"] is None and r["milesByLevel"]["Low"] == 0 for r in data["routes"])
    assert all(p["scores"] == [-1] * 49 for p in data["heatmap"]["points"])


def test_fewer_than_three_routes_sets_complete_false_with_a_warning(respx_mock):
    mock_tomtom(respx_mock, "tomtom_chicago_milwaukee.json")
    mock_meteo(respx_mock)
    data = post(destination=MILWAUKEE).json()
    assert data["complete"] is False and len(data["routes"]) == 2
    assert "Only 2 distinct route(s) found for this trip." in data["warnings"]


def test_coast_to_coast_fits_the_weather_budget_with_a_coarser_grid_and_says_so(respx_mock):
    mock_tomtom(respx_mock, "tomtom_seattle_miami.json")
    meteo = mock_meteo(respx_mock)
    res = post(origin=SEATTLE, destination=MIAMI, spacingMi=10)
    data = res.json()
    assert res.status_code == 200 and data["complete"] is True
    assert locations_requested(meteo) <= 300
    assert any("Long trip" in w for w in data["warnings"])
    assert all(len(r["geometry"]) < 40_000 for r in data["routes"])  # thinned from about 45,000 points
    assert data["heatmap"]["stepDeg"] >= 0.5


def test_heatmap_uses_the_fine_lattice_when_the_trip_is_short(respx_mock):
    mock_tomtom(respx_mock, "tomtom_denver_saltlake.json")
    mock_meteo(respx_mock)
    data = post(origin=DENVER, destination={"lat": 40.7608, "lon": -111.891}).json()
    assert data["heatmap"]["stepDeg"] == 0.25 and not data["warnings"]


def test_addresses_are_geocoded_once_each(respx_mock):
    mock_tomtom(respx_mock)
    mock_meteo(respx_mock)
    geo = respx_mock.get(url__regex=GEOCODE).respond(json=load_fixture("tomtom_geocode_whitehouse.json"))
    res = post(origin="1600 Pennsylvania Ave NW, Washington, DC", destination=DENVER)
    assert res.status_code == 200 and geo.call_count == 1
    assert res.json()["origin"]["label"].startswith("1600 Pennsylvania Avenue")


def test_an_unknown_address_is_a_400_on_that_field(respx_mock):
    respx_mock.get(url__regex=GEOCODE).respond(json={"results": []})
    res = post(origin="zzzzzz nowhere")
    assert res.status_code == 400 and "Could not find" in res.json()["origin"][0]


def test_same_origin_and_destination_is_a_400(respx_mock):
    res = post(origin=CHICAGO, destination=CHICAGO)
    assert res.status_code == 400 and "same place" in res.json()["destination"][0]


@pytest.mark.parametrize("change,field", [
    ({"loadLb": 0}, "loadLb"), ({"loadLb": 150000}, "loadLb"), ({"spacingMi": 7}, "spacingMi"),
    ({"departure": "2026-10-22T08:00:00Z"}, "departure"), ({"departure": "2026-10-24T08:00:00"}, "departure"),
    ({"departure": "2026-11-20T08:00:00Z"}, "departure"),
])
def test_bad_input_is_a_400_naming_the_field_and_makes_no_upstream_call(respx_mock, change, field):
    res = post(**change)
    assert res.status_code == 400 and field in res.json()
    assert not respx_mock.calls


def test_a_tomtom_no_route_reason_is_a_502_without_key_or_url(respx_mock):
    respx_mock.get(url__regex=TOMTOM).respond(400, json={"detailedError": {"code": "NO_ROUTE_FOUND"}})
    res = post(destination={"lat": 21.0, "lon": -157.9})
    assert res.status_code == 502
    text = res.json()["error"]
    assert "NO_ROUTE_FOUND" in text and "test-key" not in text and "tomtom.com" not in text


def test_an_open_meteo_outage_is_a_502(respx_mock, sleeps):
    mock_tomtom(respx_mock)
    respx_mock.get(url__regex=METEO).respond(503)
    res = post()
    assert res.status_code == 502 and "Open-Meteo" in res.json()["error"]


def test_a_geocoder_outage_is_a_502(respx_mock, sleeps):
    respx_mock.get(url__regex=GEOCODE).respond(503)
    assert post(origin="Chicago, IL").status_code == 502


def test_a_non_json_body_is_a_400():
    res = APIClient().post("/api/analyze", "nope", content_type="text/plain")
    assert res.status_code in (400, 415)


def test_health():
    assert APIClient().get("/api/health").json() == {"status": "ok"}


def test_geocode_endpoint_proxies_autocomplete(respx_mock):
    respx_mock.get(url__regex=r"https://photon\.komoot\.io/.*").respond(json=load_fixture("photon_denv.json"))
    res = APIClient().get("/api/geocode", {"q": "Denv"})
    assert res.status_code == 200 and res.json()[0] == {"label": "Denver, Colorado", "lat": 39.7392364,
                                                      "lon": -104.984862}
    assert APIClient().get("/api/geocode", {"q": "D"}).json() == []


def test_geocode_endpoint_reports_an_outage_as_502(respx_mock, sleeps):
    respx_mock.get(url__regex=r"https://photon\.komoot\.io/.*").respond(503)
    respx_mock.get(url__regex=r"https://api\.tomtom\.com/search/2/search/.*").respond(503)
    assert APIClient().get("/api/geocode", {"q": "Denv"}).status_code == 502


def test_a_trip_that_cannot_fit_the_weather_budget_asks_for_wider_spacing(respx_mock, monkeypatch):
    from trips.services import analyze as service

    mock_tomtom(respx_mock)
    monkeypatch.setattr(service, "MAX_CELLS", 5)
    res = post()
    assert res.status_code == 400 and "wider spacing" in res.json()["spacingMi"][0]


def test_cache_is_big_enough_to_keep_routes_while_weather_cells_pile_up(settings):
    # LocMem culls a third of its entries at the limit (default 300); one analysis adds ~250 cells.
    assert settings.CACHES["default"]["OPTIONS"]["MAX_ENTRIES"] >= 5000


def test_a_repeat_analysis_makes_no_upstream_calls(respx_mock):
    tomtom = mock_tomtom(respx_mock)
    meteo = mock_meteo(respx_mock)
    first = post().json()
    calls = (tomtom.call_count, meteo.call_count)  # 1 route request, a few 100-cell weather chunks
    second = post().json()
    assert (tomtom.call_count, meteo.call_count) == calls and first["routes"] == second["routes"]


DALLAS, FARGO = {"lat": 32.78, "lon": -96.8}, {"lat": 46.88, "lon": -96.78}
BILLINGS = {"lat": 45.78, "lon": -108.5}


def test_real_dallas_denver_has_only_two_routes_and_says_so(respx_mock):
    mock_tomtom(respx_mock, "tomtom_dallas_denver_more.json")
    mock_meteo(respx_mock)
    data = post(origin=DALLAS, destination={"lat": 39.74, "lon": -104.98}).json()
    assert data["complete"] is False and len(data["routes"]) == 2
    assert data["warnings"] == ["Only 2 distinct route(s) found for this trip."]
    assert data["recommendedRouteId"] == "r0"  # calm everywhere: the faster route wins on the last rule
    assert "travel time" in data["ranking"][0]["reason"]


def test_rain_on_the_faster_real_route_flips_the_recommendation_to_the_slower_one(respx_mock):
    # Hand check: each wet checkpoint owns 25 mi of Moderate rain, so r0's Moderate miles are 25 x its
    # wet checkpoints and its average risk is that share of its length. r1 stays Low and wins on average.
    mock_tomtom(respx_mock, "tomtom_dallas_denver_more.json")
    wet = unique_cells("tomtom_dallas_denver_more.json", 0)
    mock_meteo(respx_mock, rain=lambda lat, lon, _t: 0.15 if (lat, lon) in wet else 0.0)
    data = post(origin=DALLAS, destination={"lat": 39.74, "lon": -104.98}).json()
    r0, r1 = data["routes"]
    wet_miles = r0["milesByLevel"]["Moderate"]
    assert wet_miles > 0 and r0["avgRisk"] == pytest.approx(wet_miles / r0["distanceMi"], abs=0.01)
    assert r1["milesByLevel"]["Moderate"] == 0 and r1["avgRisk"] == 0
    assert data["recommendedRouteId"] == "r1" and r1["durationMin"] > r0["durationMin"]
    assert data["ranking"][0]["reason"].startswith("Route B: average risk 0.00 vs")


def test_real_rural_trip_returns_three_routes_with_checkpoints_every_25_miles(respx_mock):
    mock_tomtom(respx_mock, "tomtom_fargo_billings_more.json")
    mock_meteo(respx_mock)
    data = post(origin=FARGO, destination=BILLINGS).json()
    assert data["complete"] is True and len(data["routes"]) == 3
    for route in data["routes"]:
        miles = [c["mile"] for c in route["checkpoints"]]
        assert miles[:3] == [0, 25, 50] and miles == sorted(miles)
        assert miles[-1] == pytest.approx(route["distanceMi"], rel=0.01)


def test_demo_storm_replay_has_the_analyze_shape_and_is_labelled_a_replay():
    res = APIClient().get("/api/demo/storm")
    data = res.json()
    assert res.status_code == 200 and {"routes", "heatmap", "ranking", "recommendedRouteId"} <= set(data)
    assert data["replay"]["title"] and "replay" in data["replay"]["summary"].lower()
    assert data["departure"].startswith("2025-12-09") and len(data["routes"]) == 3
    assert all(len(p["scores"]) == 49 for p in data["heatmap"]["points"])
    levels = {c["levelLabel"] for r in data["routes"] for c in r["checkpoints"]}
    assert {"Severe", "No Travel"} <= levels


def test_an_unexpected_error_is_json_without_a_stack_trace(monkeypatch):
    def boom(*_a):
        raise RuntimeError("secret internal detail")

    monkeypatch.setattr("trips.views.analyze", boom)
    res = APIClient().post("/api/analyze", body(), format="json")
    assert res.status_code == 500 and res.json() == {"error": "Unexpected server error"}
    assert b"secret internal detail" not in res.content and b"Traceback" not in res.content


def test_tomtom_503_429_and_timeout_are_502s_with_the_provider_named(respx_mock, sleeps):
    for failure in (httpx.Response(503), httpx.Response(429), httpx.ReadTimeout("slow")):
        respx_mock.get(url__regex=TOMTOM).mock(side_effect=itertools.repeat(failure))
        res = post()
        text = res.json()["error"]
        assert res.status_code == 502 and "TomTom" in text and "test-key" not in text and "http" not in text


def test_open_meteo_429_after_retries_and_a_timeout_are_502s(respx_mock, sleeps):
    mock_tomtom(respx_mock)
    for failure in (httpx.Response(429), httpx.ConnectTimeout("slow")):
        respx_mock.get(url__regex=METEO).mock(side_effect=itertools.repeat(failure))
        res = post()
        assert res.status_code == 502 and "Open-Meteo" in res.json()["error"]


def test_a_point_in_the_ocean_says_no_route_not_a_stack_trace(respx_mock):
    respx_mock.get(url__regex=TOMTOM).respond(400, json={"detailedError": {"code": "MAP_MATCHING_FAILURE"}})
    res = post(destination={"lat": 30.0, "lon": -60.0})
    assert res.status_code == 502 and "MAP_MATCHING_FAILURE" in res.json()["error"]
