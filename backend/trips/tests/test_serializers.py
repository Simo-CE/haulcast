"""Input validation for POST /api/analyze."""
from datetime import UTC, datetime

import pytest

from trips import serializers
from trips.integrations.geocode import Place
from trips.serializers import AnalyzeSerializer

NOW = datetime(2026, 10, 23, 12, 0, tzinfo=UTC)
GOOD = {"origin": "Dallas, TX", "destination": {"lat": 39.74, "lon": -104.99},
        "departure": "2026-10-24T08:00:00-06:00", "loadLb": 42000, "spacingMi": 25}


@pytest.fixture(autouse=True)
def _clock(monkeypatch):
    monkeypatch.setattr(serializers, "_now", lambda: NOW)


def check(**changes):
    s = AnalyzeSerializer(data={**GOOD, **changes})
    return s, s.is_valid()


def errors(**changes) -> dict:
    s, ok = check(**changes)
    assert not ok
    return {k: str(v[0]) for k, v in s.errors.items()}


def test_a_good_request_normalises_to_utc_and_place_objects():
    s, ok = check()
    assert ok, s.errors
    d = s.validated_data
    assert d["origin"] == "Dallas, TX"
    assert d["destination"] == Place("39.7400, -104.9900", 39.74, -104.99)
    assert d["departure"] == datetime(2026, 10, 24, 14, 0, tzinfo=UTC)
    assert d["loadLb"] == 42000 and d["spacingMi"] == 25


def test_spacing_defaults_to_25():
    data = {k: v for k, v in GOOD.items() if k != "spacingMi"}
    s = AnalyzeSerializer(data=data)
    assert s.is_valid() and s.validated_data["spacingMi"] == 25


@pytest.mark.parametrize("load", [0, -5, 100_001, "heavy", None])
def test_load_must_be_positive_and_at_most_100000(load):
    assert "loadLb" in errors(loadLb=load)


def test_load_limits_are_inclusive_at_the_top():
    assert check(loadLb=100_000)[1] and check(loadLb=0.5)[1]


@pytest.mark.parametrize("spacing", [5, 30, "far", 0])
def test_spacing_must_be_10_25_or_50(spacing):
    assert "spacingMi" in errors(spacingMi=spacing)


def test_departure_needs_a_timezone():
    assert "timezone" in errors(departure="2026-10-24T08:00:00")["departure"]


def test_departure_must_parse():
    assert "ISO 8601" in errors(departure="tomorrow morning")["departure"]


def test_departure_in_the_past_is_rejected_but_just_now_is_allowed():
    assert "past" in errors(departure="2026-10-23T11:00:00Z")["departure"]
    assert check(departure="2026-10-23T11:57:00Z")[1]  # a "depart now" that took a few minutes to arrive


def test_departure_window_is_seven_days():
    assert check(departure="2026-10-30T11:59:00Z")[1]
    assert "7 days" in errors(departure="2026-10-30T12:01:00Z")["departure"]


@pytest.mark.parametrize("value", [{"lat": 91, "lon": 0}, {"lat": 0, "lon": 181}])
def test_coordinates_must_be_on_earth(value):
    assert "Latitude" in errors(origin=value)["origin"]


@pytest.mark.parametrize("value", [12, [], {"lat": "1", "lon": 2}, {"lat": True, "lon": 2}, {"lat": 1}])
def test_a_place_is_text_or_numeric_coordinates(value):
    assert "address as text" in errors(origin=value)["origin"]


@pytest.mark.parametrize("value", ["", "ab", "x" * 201])
def test_address_text_has_a_sane_length(value):
    assert "characters" in errors(destination=value)["destination"]


def test_missing_fields_are_all_reported():
    s = AnalyzeSerializer(data={})
    assert not s.is_valid() and {"origin", "destination", "departure", "loadLb"} <= set(s.errors)


def test_a_coordinate_label_is_kept():
    s, ok = check(origin={"lat": 41.88, "lon": -87.63, "label": " Chicago, IL "})
    assert ok and s.validated_data["origin"].label == "Chicago, IL"


def test_the_real_clock_is_utc_and_current(monkeypatch):
    monkeypatch.undo()
    assert abs(serializers._now() - datetime.now(UTC)).total_seconds() < 5
