"""routing.py against saved real TomTom responses (offline)."""
from datetime import UTC, datetime, timedelta, timezone

import httpx
import pytest

from trips.integrations import routing
from trips.integrations.http import IntegrationError
from trips.tests.conftest import load_fixture

DEPART = datetime(2026, 10, 23, 20, 0, tzinfo=UTC)
CHICAGO, MILWAUKEE = (41.8781, -87.6298), (43.0389, -87.9065)
DENVER, SLC = (39.7392, -104.9903), (40.7608, -111.8910)
LA, SF = (34.0522, -118.2437), (37.7749, -122.4194)
URL = r"https://api\.tomtom\.com/routing/1/calculateRoute/.*"


def test_gross_weight_adds_tare_and_rounds_up_to_a_bucket():
    assert routing.gross_weight_lb(0) == 35_000  # 33,000 tare rounds up to the next 5,000
    assert routing.gross_weight_lb(2_000) == 35_000
    assert routing.gross_weight_lb(2_001) == 40_000
    assert routing.gross_weight_lb(47_000) == 80_000


def test_request_is_the_documented_truck_call(respx_mock):
    route = respx_mock.get(url__regex=URL).respond(json=load_fixture("tomtom_denver_saltlake.json"))
    routing.fetch_routes(DENVER, SLC, DEPART, 40_000)
    request = route.calls.last.request
    q = dict(request.url.params)
    assert request.url.path.endswith("/39.73920,-104.99030:40.76080,-111.89100/json")
    assert q["travelMode"] == "truck" and q["maxAlternatives"] == "2"
    assert q["routeRepresentation"] == "encodedPolyline" and q["extendedRouteRepresentation"] == "travelTime"
    assert q["departAt"] == "2026-10-23T20:00:00Z" and q["key"] == "test-key"
    assert q["vehicleWeight"] == str(round(75_000 * 0.45359237))  # 33,000 + 40,000 -> 75,000 lb bucket
    assert request.headers["user-agent"].startswith("Haulcast")


def test_three_distinct_mountain_routes_with_progress_anchors(respx_mock):
    respx_mock.get(url__regex=URL).respond(json=load_fixture("tomtom_denver_saltlake.json"))
    result = routing.fetch_routes(DENVER, SLC, DEPART, 40_000)
    assert [r.id for r in result.routes] == ["r0", "r1", "r2"]
    assert result.warnings == [] and result.dropped == []
    for cand in result.routes:
        anchors = result.progress[cand.id]
        assert anchors[0] == (0, 0) and anchors[-1][0] == len(cand.points) - 1
        assert anchors[-1][1] == cand.duration_s


def test_coast_routes_stay_inside_the_thresholds(respx_mock):
    respx_mock.get(url__regex=URL).respond(json=load_fixture("tomtom_la_sanfrancisco.json"))
    result = routing.fetch_routes(LA, SF, DEPART, 40_000)
    assert len(result.routes) == 3
    shortest = min(r.distance_mi for r in result.routes)
    assert max(r.distance_mi for r in result.routes) <= 1.5 * shortest


def test_short_trip_asks_for_more_alternatives_once(respx_mock):
    first = load_fixture("tomtom_chicago_milwaukee.json")  # 3 routes, one a 2.15x detour -> only 2 usable
    more = load_fixture("tomtom_chicago_milwaukee_more.json")  # 6 routes, a third distinct one exists
    route = respx_mock.get(url__regex=URL).mock(
        side_effect=[httpx.Response(200, json=first), httpx.Response(200, json=more)]
    )
    result = routing.fetch_routes(CHICAGO, MILWAUKEE, DEPART, 40_000)
    assert route.call_count == 2
    assert dict(route.calls[1].request.url.params)["maxAlternatives"] == "5"
    assert len(result.routes) == 3 and result.warnings == []
    assert any("1.5x" in reason for _, reason in result.dropped)


def test_reports_what_exists_when_three_cannot_be_found(respx_mock):
    first = load_fixture("tomtom_chicago_milwaukee.json")
    route = respx_mock.get(url__regex=URL).respond(json=first)  # the second request returns the same
    result = routing.fetch_routes(CHICAGO, MILWAUKEE, DEPART, 40_000)
    assert route.call_count == 2  # asked for more once, not in a loop
    assert len(result.routes) == 2
    assert result.warnings == ["Only 2 distinct route(s) found for this trip."]


def test_same_hour_and_weight_bucket_is_served_from_cache(respx_mock):
    route = respx_mock.get(url__regex=URL).respond(json=load_fixture("tomtom_denver_saltlake.json"))
    a = routing.fetch_routes(DENVER, SLC, DEPART, 40_000)
    b = routing.fetch_routes(DENVER, SLC, DEPART + timedelta(minutes=40), 41_000)
    assert route.call_count == 1 and a is not None and b.routes[0].id == "r0"
    routing.fetch_routes(DENVER, SLC, DEPART + timedelta(hours=1), 40_000)
    routing.fetch_routes(DENVER, SLC, DEPART, 47_000)
    assert route.call_count == 3


def test_departure_is_read_in_utc_whatever_its_offset(respx_mock):
    route = respx_mock.get(url__regex=URL).respond(json=load_fixture("tomtom_denver_saltlake.json"))
    local = datetime(2026, 10, 23, 15, 0, tzinfo=timezone(timedelta(hours=-5)))
    routing.fetch_routes(DENVER, SLC, local, 40_000)
    assert dict(route.calls.last.request.url.params)["departAt"] == "2026-10-23T20:00:00Z"


def test_naive_departure_is_rejected():
    with pytest.raises(ValueError):
        routing.fetch_routes(DENVER, SLC, datetime(2026, 10, 23, 20, 0), 40_000)


def test_overweight_trucks_get_a_soft_warning(respx_mock):
    respx_mock.get(url__regex=URL).respond(json=load_fixture("tomtom_denver_saltlake.json"))
    result = routing.fetch_routes(DENVER, SLC, DEPART, 50_000)
    assert len(result.routes) == 3 and "83,000 lb" in result.warnings[0]


def test_retries_once_on_5xx_then_succeeds(respx_mock, sleeps):
    route = respx_mock.get(url__regex=URL).mock(
        side_effect=[
            httpx.Response(500),
            httpx.Response(200, json=load_fixture("tomtom_denver_saltlake.json")),
        ]
    )
    assert len(routing.fetch_routes(DENVER, SLC, DEPART, 40_000).routes) == 3
    assert route.call_count == 2 and sleeps == [1.0]


def test_two_5xx_fail_loudly_without_leaking_the_key(respx_mock):
    route = respx_mock.get(url__regex=URL).respond(503)
    with pytest.raises(IntegrationError, match="HTTP 503") as err:
        routing.fetch_routes(DENVER, SLC, DEPART, 40_000)
    assert route.call_count == 2 and "test-key" not in str(err.value)


def test_client_error_is_not_retried(respx_mock):
    route = respx_mock.get(url__regex=URL).respond(400, json={"error": "bad"})
    with pytest.raises(IntegrationError, match="HTTP 400"):
        routing.fetch_routes(DENVER, SLC, DEPART, 40_000)
    assert route.call_count == 1


def test_timeout_is_an_integration_error(respx_mock):
    respx_mock.get(url__regex=URL).mock(side_effect=httpx.ReadTimeout("slow", request=None))
    with pytest.raises(IntegrationError, match="ReadTimeout"):
        routing.fetch_routes(DENVER, SLC, DEPART, 40_000)


@pytest.mark.parametrize("body", [{"routes": []}, {}, {"routes": [{"legs": []}]}])
def test_empty_or_malformed_payloads_are_errors(respx_mock, body):
    respx_mock.get(url__regex=URL).respond(json=body)
    with pytest.raises(IntegrationError):
        routing.fetch_routes(DENVER, SLC, DEPART, 40_000)


def test_non_json_body_is_an_error(respx_mock):
    respx_mock.get(url__regex=URL).respond(200, text="<html>")
    with pytest.raises(IntegrationError, match="invalid JSON"):
        routing.fetch_routes(DENVER, SLC, DEPART, 40_000)


def test_same_place_is_refused_before_any_request(respx_mock):
    route = respx_mock.get(url__regex=URL).respond(json={})
    with pytest.raises(ValueError, match="same place"):
        routing.fetch_routes(CHICAGO, (41.8782, -87.6299), DEPART, 40_000)
    assert route.call_count == 0


def test_tomtom_error_code_reaches_the_message(respx_mock):
    body = {"detailedError": {"code": "NO_ROUTE_FOUND", "message": "No valid route found"}}  # real 400 body
    respx_mock.get(url__regex=URL).respond(400, json=body)
    with pytest.raises(IntegrationError, match=r"HTTP 400 \(NO_ROUTE_FOUND\)"):
        routing.fetch_routes(CHICAGO, MILWAUKEE, DEPART, 40_000)


def test_longest_real_trip_selects_three_routes_with_a_consistent_timeline(respx_mock):
    respx_mock.get(url__regex=URL).respond(json=load_fixture("tomtom_seattle_miami.json"))
    result = routing.fetch_routes((47.6062, -122.3321), (25.7617, -80.1918), DEPART, 40_000)
    assert len(result.routes) == 3 and 3_300 < result.routes[0].distance_mi < 3_400
    assert 45 < result.routes[0].duration_s / 3600 < 48  # a trip this long outlasts a 48 h forecast window
