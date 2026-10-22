import math

import pytest
from hypothesis import given
from hypothesis import strategies as st

from trips.domain.risk import (
    Level,
    apply_load_rules,
    checkpoint_risk,
    classify_rain,
    classify_snow,
    classify_wind,
    risk_score,
)

L, M, H, S, NT = Level.LOW, Level.MODERATE, Level.HIGH, Level.SEVERE, Level.NO_TRAVEL


def test_level_scores():
    assert [int(x) for x in (L, M, H, S, NT)] == [0, 1, 2, 3, 4]


@pytest.mark.parametrize(
    ("mph", "expected"),
    [(0, L), (24.9, L), (25, M), (34.9, M), (35, H), (44.9, H), (45, S), (54.9, S), (55, NT), (90, NT)],
)
def test_wind_boundaries(mph, expected):
    assert classify_wind(mph) == expected


@pytest.mark.parametrize(
    ("inch_hr", "expected"),
    [(0, L), (0.09, L), (0.10, M), (0.24, M), (0.25, H), (0.49, H), (0.50, S), (1.00, S), (1.01, NT)],
)
def test_rain_boundaries(inch_hr, expected):
    assert classify_rain(inch_hr) == expected


@pytest.mark.parametrize(
    ("inch_hr", "expected"),
    [(0, L), (0.49, L), (0.5, M), (0.99, M), (1.0, H), (1.99, H), (2.0, S), (3.0, S), (3.01, NT)],
)
def test_snow_boundaries(inch_hr, expected):
    assert classify_snow(inch_hr) == expected


@pytest.mark.parametrize("bad", [None, math.nan, math.inf, -0.1])
@pytest.mark.parametrize("fn", [classify_wind, classify_rain, classify_snow])
def test_invalid_values_raise_instead_of_defaulting_to_low(fn, bad):
    with pytest.raises(ValueError):
        fn(bad)


@pytest.mark.parametrize(
    ("wind", "load", "base", "expected"),
    [
        (55, 0, NT, NT),  # wind >= 55 is No Travel for any load
        (54.9, 30_000, S, S),  # load must be strictly over 30,000
        (54.9, 30_001, S, NT),
        (45, 30_001, S, NT),
        (44.9, 80_000, H, S),  # 35-44 band: heavy load raises High to Severe
        (40, 40_000, H, H),  # must be strictly over 40,000
        (40, 40_001, H, S),
        (35, 40_001, H, S),
        (34.9, 80_000, M, M),  # below 35 mph no load rule applies
        (40, 40_001, NT, NT),  # load rules only raise, never lower
    ],
)
def test_load_rules(wind, load, base, expected):
    assert apply_load_rules(base, wind, load) == expected


def test_checkpoint_is_worst_of_three_hazards():
    level, reason = checkpoint_risk(wind=10, rain=0.1, snow=1.2, load_lb=20_000)
    assert level == H
    assert "snow" in reason.lower()


def test_checkpoint_load_rule_reason_mentions_the_load():
    level, reason = checkpoint_risk(wind=50, rain=0, snow=0, load_lb=35_000)
    assert level == NT
    assert "35,000" in reason and "30,000" in reason


def test_checkpoint_low_reason():
    assert checkpoint_risk(5, 0, 0, 10_000) == (L, "Calm: no weather hazard")


def test_negative_load_rejected():
    with pytest.raises(ValueError):
        checkpoint_risk(10, 0, 0, -1)


wind_st = st.floats(0, 120)
rain_st = st.floats(0, 3)
snow_st = st.floats(0, 6)
load_st = st.integers(0, 120_000)


@given(wind_st, wind_st)
def test_wind_monotonic(a, b):
    lo, hi = sorted((a, b))
    assert classify_wind(lo) <= classify_wind(hi)


@given(rain_st, rain_st)
def test_rain_monotonic(a, b):
    lo, hi = sorted((a, b))
    assert classify_rain(lo) <= classify_rain(hi)


@given(snow_st, snow_st)
def test_snow_monotonic(a, b):
    lo, hi = sorted((a, b))
    assert classify_snow(lo) <= classify_snow(hi)


@given(wind_st, rain_st, snow_st, load_st, load_st)
def test_heavier_load_never_lowers_level(w, r, s, a, b):
    lo, hi = sorted((a, b))
    assert checkpoint_risk(w, r, s, lo)[0] <= checkpoint_risk(w, r, s, hi)[0]


@given(wind_st, wind_st, rain_st, snow_st, load_st)
def test_worse_wind_never_lowers_level(w1, w2, r, s, load):
    lo, hi = sorted((w1, w2))
    assert checkpoint_risk(lo, r, s, load)[0] <= checkpoint_risk(hi, r, s, load)[0]


@given(wind_st, rain_st, snow_st, load_st)
def test_score_stays_inside_its_level_band(w, r, s, load):
    level = checkpoint_risk(w, r, s, load)[0]
    assert level <= risk_score(w, r, s, load) <= min(4, level + 1)


def test_score_is_continuous_between_bands():
    assert risk_score(0, 0, 0, 0) == 0
    assert risk_score(30, 0, 0, 0) == pytest.approx(1.5)
    assert risk_score(60, 0, 0, 0) == 4


def test_checkpoint_very_heavy_load_in_high_wind_band_is_severe():
    level, reason = checkpoint_risk(wind=40, rain=0, snow=0, load_lb=45_000)
    assert level == S
    assert "45,000" in reason and "40,000" in reason
