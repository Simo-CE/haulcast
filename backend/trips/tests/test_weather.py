"""weather.py: timestamp alignment, unit checks, batching and caching (offline)."""
import copy
from datetime import UTC, datetime, timedelta

import httpx
import pytest

from trips.integrations import weather
from trips.integrations.http import IntegrationError
from trips.integrations.weather import Forecast
from trips.tests.conftest import load_fixture

URL = r"https://haulcast\.dooma\.dev/openmeteo.*"
FALLBACK = r"https://api\.open-meteo\.com/v1/forecast.*"
START = datetime(2026, 10, 23, 20, 0, tzinfo=UTC)
LAST = datetime(2026, 10, 24, 2, 0, tzinfo=UTC)  # the saved fixture covers these 7 hours
CELLS = [(41.75, -87.75), (42.25, -87.75), (42.75, -87.75), (43.0, -88.0)]


def at(h: int, m: int = 0) -> datetime:
    return datetime(2026, 10, 23, 0, 0, tzinfo=UTC) + timedelta(hours=h, minutes=m)


def labelled() -> Forecast:
    """Hours 8:00..12:00 where every value says which timestamp it is stamped at."""
    ts = [8, 9, 10, 11, 12]
    return Forecast(at(8), [10.0 * h for h in ts], [h + 0.5 for h in ts],
                    [h / 100 for h in ts], [h / 10 for h in ts])


def test_eta_1030_uses_the_rain_and_snow_stamped_1100():
    point = labelled().at(at(10, 30))
    assert point.rain_in_hr == 0.11 and point.snow_in_hr == 1.1


def test_wind_is_instantaneous_so_it_uses_the_nearest_timestamp():
    f = labelled()
    assert f.at(at(10, 10)).wind_mph == 100.0  # 10:10 -> 10:00
    assert f.at(at(10, 40)).wind_mph == 110.0  # 10:40 -> 11:00
    assert f.at(at(10, 30)).wind_mph == 110.0  # ties round up


def test_eta_exactly_on_the_hour_uses_that_stamp():
    point = labelled().at(at(10))
    assert (point.wind_mph, point.rain_in_hr, point.gust_mph) == (100.0, 0.10, 10.5)


def test_eta_outside_the_forecast_is_unknown_not_low():
    f = labelled()
    for eta in (at(6), at(12, 30), at(20)):
        assert f.at(eta) == weather.WeatherPoint(None, None, None, None)


def test_null_values_stay_unknown_and_rain_needs_both_parts():
    obj = copy.deepcopy(load_fixture("openmeteo_chicago_milwaukee.json")[0])
    obj["hourly"]["wind_speed_10m"][1] = None
    obj["hourly"]["showers"][2] = None
    f = weather._parse_location(obj, START, 7)
    assert f.at(START + timedelta(hours=1)).wind_mph is None
    assert f.at(START + timedelta(hours=2)).rain_in_hr is None
    assert f.at(START + timedelta(hours=3)).rain_in_hr == 0.0


def test_rain_is_rain_plus_showers():
    obj = copy.deepcopy(load_fixture("openmeteo_chicago_milwaukee.json")[0])
    obj["hourly"]["rain"][0], obj["hourly"]["showers"][0] = 0.1, 0.05
    assert weather._parse_location(obj, START, 7).rain[0] == pytest.approx(0.15)


def test_snap_puts_nearby_points_on_one_cell():
    assert weather.snap(41.8781, -87.6298) == (42.0, -87.75)
    assert weather.snap(41.9, -87.7) == weather.snap(41.99, -87.8)


def test_real_response_is_fetched_in_one_batched_request(respx_mock):
    route = respx_mock.get(url__regex=URL).respond(json=load_fixture("openmeteo_chicago_milwaukee.json"))
    got = weather.fetch_forecasts(CELLS, START + timedelta(minutes=20), LAST)
    assert route.call_count == 1 and sorted(got) == sorted(CELLS)
    q = dict(route.calls.last.request.url.params)
    assert q["latitude"] == "41.75,42.25,42.75,43.0" and q["longitude"] == "-87.75,-87.75,-87.75,-88.0"
    assert q["wind_speed_unit"] == "mph" and q["precipitation_unit"] == "inch" and q["timezone"] == "GMT"
    assert q["start_hour"] == "2026-10-23T20:00" and q["end_hour"] == "2026-10-24T02:00"
    f = got[(41.75, -87.75)]
    assert len(f.wind) == 7 and f.at(START).wind_mph == 5.6 and f.at(LAST).gust_mph == 12.5


def test_a_single_location_comes_back_as_an_object(respx_mock):
    respx_mock.get(url__regex=URL).respond(json=load_fixture("openmeteo_chicago_milwaukee.json")[0])
    assert list(weather.fetch_forecasts([CELLS[0]], START, LAST)) == [CELLS[0]]


def test_cells_are_cached_and_only_missing_cells_are_requested(respx_mock):
    route = respx_mock.get(url__regex=URL).respond(json=load_fixture("openmeteo_chicago_milwaukee.json"))
    weather.fetch_forecasts(CELLS, START, LAST)
    weather.fetch_forecasts(CELLS, START + timedelta(hours=1), LAST - timedelta(hours=2))
    assert route.call_count == 1
    route.respond(json=load_fixture("openmeteo_chicago_milwaukee.json")[:1])
    weather.fetch_forecasts([*CELLS, (50.0, -100.0)][:1] + [(44.0, -88.0)], START, LAST)
    assert route.call_count == 2 and dict(route.calls.last.request.url.params)["latitude"] == "44.0"


def test_a_longer_window_than_the_cached_one_refetches(respx_mock):
    route = respx_mock.get(url__regex=URL).respond(json=load_fixture("openmeteo_chicago_milwaukee.json"))
    weather.fetch_forecasts(CELLS, START, LAST)
    with pytest.raises(IntegrationError):  # the canned reply has 7 hours; this asks for 9 -> mismatch caught
        weather.fetch_forecasts(CELLS, START, LAST + timedelta(hours=2))
    assert route.call_count == 2


def _echo(request: httpx.Request) -> httpx.Response:
    """A fake Open-Meteo that answers for however many locations were asked."""
    n = len(request.url.params["latitude"].split(","))
    template = load_fixture("openmeteo_chicago_milwaukee.json")[0]
    return httpx.Response(200, json=[template] * n)


def test_250_cells_are_chunked_at_100_per_request(respx_mock):
    route = respx_mock.get(url__regex=URL).mock(side_effect=_echo)
    cells = [(30.0 + i * 0.25, -100.0 + j * 0.25) for i in range(25) for j in range(10)]
    assert len(weather.fetch_forecasts(cells, START, LAST)) == 250
    sizes = [len(c.request.url.params["latitude"].split(",")) for c in route.calls]
    assert sizes == [100, 100, 50]


def test_more_than_300_cells_is_refused_before_any_request(respx_mock):
    route = respx_mock.get(url__regex=URL).mock(side_effect=_echo)
    cells = [(25.0 + i * 0.25, -100.0) for i in range(301)]
    with pytest.raises(ValueError, match="300"):
        weather.fetch_forecasts(cells, START, LAST)
    assert route.call_count == 0


def test_last_before_first_is_refused():
    with pytest.raises(ValueError):
        weather.fetch_forecasts(CELLS, START, START - timedelta(hours=3))


def test_429_backs_off_and_retries(respx_mock, sleeps):
    route = respx_mock.get(url__regex=URL + "|" + FALLBACK).mock(
        side_effect=[httpx.Response(429), httpx.Response(503),
                     httpx.Response(200, json=load_fixture("openmeteo_chicago_milwaukee.json"))]
    )
    assert len(weather.fetch_forecasts(CELLS, START, LAST)) == 4
    assert route.call_count == 3 and sleeps == [2.0]


def test_gives_up_after_trying_both_endpoints(respx_mock, sleeps):
    proxy = respx_mock.get(url__regex=URL).respond(429)
    direct = respx_mock.get(url__regex=FALLBACK).respond(429)
    with pytest.raises(IntegrationError, match="HTTP 429"):
        weather.fetch_forecasts(CELLS, START, LAST)
    assert proxy.call_count == 2 and direct.call_count == 4


def test_a_failing_worker_proxy_falls_back_to_open_meteo_directly(respx_mock):
    respx_mock.get(url__regex=URL).respond(429, json={"reason": "Daily API request limit exceeded."})
    direct = respx_mock.get(url__regex=FALLBACK).respond(
        json=load_fixture("openmeteo_chicago_milwaukee.json")
    )
    assert len(weather.fetch_forecasts(CELLS, START, LAST)) == 4
    assert direct.call_count == 1


def _break(path: list, value):
    body = copy.deepcopy(load_fixture("openmeteo_chicago_milwaukee.json"))
    target = body[0]
    for key in path[:-1]:
        target = target[key]
    target[path[-1]] = value
    return body


@pytest.mark.parametrize(
    ("body", "message"),
    [
        (_break(["hourly_units", "wind_speed_10m"], "km/h"), "km/h"),
        (_break(["hourly_units", "snowfall"], "cm"), "cm"),
        (_break(["hourly", "rain"], [0.0] * 6), "rain has 6 values"),
        (_break(["hourly", "time"], ["2026-10-23T21:00"] * 7), "timestamps"),
        (load_fixture("openmeteo_chicago_milwaukee.json")[:3], "different number"),
        ([{"hourly": {}}] * 4, "unexpected shape"),
    ],
)
def test_bad_responses_are_errors_not_silent_defaults(respx_mock, body, message):
    respx_mock.get(url__regex=URL).respond(json=body)
    with pytest.raises(IntegrationError, match=message):
        weather.fetch_forecasts(CELLS, START, LAST)


# --- real wet and snowy data (saved 2026-10-22: Miami storm, Colorado snow, Boise rain) ---
WET = load_fixture("openmeteo_wet.json")
WET_START = datetime.fromisoformat(WET[0]["hourly"]["time"][0]).replace(tzinfo=UTC)


def wet_forecast(i: int) -> Forecast:
    return weather._parse_location(WET[i], WET_START, 48)


def test_real_storm_hour_is_read_at_its_end_stamp():
    from trips.domain.risk import Level, classify_rain

    miami = wet_forecast(0)
    peak = miami.rain.index(max(miami.rain))
    stamp = WET_START + timedelta(hours=peak)  # the hour whose preceding 60 minutes held the storm
    assert miami.rain[peak] > 1.0
    eta = stamp - timedelta(minutes=30)  # e.g. 01:30 for a storm stamped 02:00
    assert miami.at(eta).rain_in_hr == miami.rain[peak]
    assert classify_rain(miami.at(eta).rain_in_hr) == Level.NO_TRAVEL


def test_real_snow_is_in_inches_and_classifiable():
    from trips.domain.risk import Level, classify_snow

    colorado = wet_forecast(1)
    assert max(colorado.snow) == pytest.approx(0.076) and classify_snow(max(colorado.snow)) == Level.LOW


def test_real_fixture_has_no_nulls_and_48_hours_per_cell():
    for i in range(3):
        f = wet_forecast(i)
        assert len(f.wind) == len(f.rain) == len(f.snow) == len(f.gust) == 48
        assert None not in (*f.wind, *f.rain, *f.snow, *f.gust)
