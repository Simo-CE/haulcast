import pytest
from hypothesis import given
from hypothesis import strategies as st

from trips.domain.risk import Level
from trips.domain.rollup import RatedPoint, rollup

L, M, H, S, NT = Level.LOW, Level.MODERATE, Level.HIGH, Level.SEVERE, Level.NO_TRAVEL


def test_midpoint_split_and_weighted_average():
    pts = [RatedPoint(0, L), RatedPoint(25, H), RatedPoint(50, S)]
    r = rollup(pts, total_mi=50, duration_s=3600)
    assert r.miles_by_level == {L: 12.5, M: 0, H: 25, S: 12.5, NT: 0}
    assert r.avg_risk == pytest.approx((0 * 12.5 + 2 * 25 + 3 * 12.5) / 50)
    assert r.unknown_mi == 0
    assert (r.distance_mi, r.duration_s) == (50, 3600)


def test_last_checkpoint_owns_the_tail_to_the_end():
    r = rollup([RatedPoint(0, L), RatedPoint(10, NT)], total_mi=30, duration_s=1)
    assert r.miles_by_level[L] == 5
    assert r.miles_by_level[NT] == 25


def test_single_checkpoint_owns_everything():
    assert rollup([RatedPoint(0, M)], 8, 1).miles_by_level[M] == 8


def test_unknown_weather_is_counted_not_treated_as_low():
    pts = [RatedPoint(0, L), RatedPoint(20, None), RatedPoint(40, H)]
    r = rollup(pts, 40, 1)
    assert r.unknown_mi == 20
    assert r.miles_by_level[L] == 10
    assert r.avg_risk == pytest.approx((0 * 10 + 2 * 10) / 20)  # known miles only


def test_all_unknown_has_no_average():
    r = rollup([RatedPoint(0, None), RatedPoint(10, None)], 10, 1)
    assert r.avg_risk is None and r.unknown_mi == 10


def test_empty_rejected():
    with pytest.raises(ValueError):
        rollup([], 10, 1)


@given(
    st.lists(st.sampled_from([*Level, None]), min_size=1, max_size=40),
    st.floats(1, 3000),
)
def test_miles_always_add_up_to_the_route_length(levels, total):
    step = total / max(len(levels) - 1, 1)
    pts = [RatedPoint(i * step, lv) for i, lv in enumerate(levels)]
    r = rollup(pts, total, 1)
    assert sum(r.miles_by_level.values()) + r.unknown_mi == pytest.approx(total)
