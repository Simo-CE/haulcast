import pytest

from trips.domain.checkpoints import haversine_mi
from trips.domain.via import MAX_OFFSET_MI, MIN_OFFSET_MI, via_points

CHICAGO, MILWAUKEE = (41.8781, -87.6298), (43.0389, -87.9065)
LA, NYC = (34.05, -118.24), (40.71, -74.0)


def _middle(a, b):
    return ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)


def test_points_sit_on_opposite_sides_equally_far_from_both_ends():
    left, right = via_points(CHICAGO, MILWAUKEE, 0.2)
    assert left != right
    assert haversine_mi(CHICAGO, left) == pytest.approx(haversine_mi(CHICAGO, right), rel=0.01)
    assert haversine_mi(MILWAUKEE, left) == pytest.approx(haversine_mi(MILWAUKEE, right), rel=0.01)


def test_offset_is_a_share_of_the_trip_for_ordinary_trips():
    trip = haversine_mi(CHICAGO, MILWAUKEE)
    offset = haversine_mi(_middle(CHICAGO, MILWAUKEE), via_points(CHICAGO, MILWAUKEE, 0.2)[0])
    assert offset == pytest.approx(0.2 * trip, rel=0.05)


def test_offset_is_capped_on_long_trips_and_floored_on_tiny_ones():
    long_offset = haversine_mi(_middle(LA, NYC), via_points(LA, NYC, 0.2)[0])
    assert long_offset == pytest.approx(MAX_OFFSET_MI, rel=0.05)
    a, b = (40.0, -100.0), (40.01, -100.0)
    assert haversine_mi(_middle(a, b), via_points(a, b, 0.2)[0]) == pytest.approx(MIN_OFFSET_MI, rel=0.05)


def test_a_narrower_share_moves_the_points_closer():
    wide, narrow = via_points(CHICAGO, MILWAUKEE, 0.2)[0], via_points(CHICAGO, MILWAUKEE, 0.1)[0]
    mid = _middle(CHICAGO, MILWAUKEE)
    assert haversine_mi(mid, narrow) == pytest.approx(haversine_mi(mid, wide) / 2, rel=0.05)
