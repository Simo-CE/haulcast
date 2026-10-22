import math
from datetime import UTC, datetime, timedelta

import pytest

from trips.domain.checkpoints import build_checkpoints, haversine_mi

DEPART = datetime(2026, 11, 3, 14, 0, tzinfo=UTC)
DEG_MI = math.radians(1) * 3958.7613  # one degree of longitude on the equator


def test_haversine_one_degree():
    assert haversine_mi((0, 0), (0, 1)) == pytest.approx(DEG_MI, abs=0.01)
    assert haversine_mi((10, 20), (10, 20)) == 0


def test_spacing_endpoints_and_linear_eta():
    cps = build_checkpoints([(0, 0), (0, 1)], [(0, 0), (1, 3600)], DEPART, 25)
    assert [round(c.mile, 2) for c in cps] == [0, 25, 50, round(DEG_MI, 2)]
    assert cps[0].eta == DEPART
    assert cps[-1].eta == DEPART + timedelta(hours=1)
    assert (cps[1].eta - DEPART).total_seconds() == pytest.approx(25 / DEG_MI * 3600)
    assert cps[1].lon == pytest.approx(25 / DEG_MI, rel=1e-3)


def test_no_duplicate_endpoint_when_length_is_a_multiple_of_spacing():
    # 1 degree = 69.093 mi; ask for spacing equal to the length
    cps = build_checkpoints([(0, 0), (0, 1)], [(0, 0), (1, 100)], DEPART, DEG_MI)
    assert len(cps) == 2


def test_eta_follows_uneven_speed():
    pts = [(0, 0), (0, 0.5), (0, 1)]
    cps = build_checkpoints(pts, [(0, 0), (1, 600), (2, 7200)], DEPART, 50)
    mid_of_second_half = next(c for c in cps if c.mile == 50)
    expected = 600 + (50 - DEG_MI / 2) / (DEG_MI / 2) * 6600
    assert (mid_of_second_half.eta - DEPART).total_seconds() == pytest.approx(expected, rel=1e-3)


def test_sparse_progress_interpolates_by_distance():
    pts = [(0, 0), (0, 0.25), (0, 1)]
    cps = build_checkpoints(pts, [(0, 0), (2, 4000)], DEPART, 100)
    assert [c.mile for c in cps] == [0, pytest.approx(DEG_MI, abs=0.01)]
    mid = build_checkpoints(pts, [(0, 0), (2, 4000)], DEPART, 34.5465)[1]
    assert (mid.eta - DEPART).total_seconds() == pytest.approx(2000, rel=1e-3)


def test_zero_length_route_has_one_checkpoint():
    cps = build_checkpoints([(5, 5), (5, 5)], [(0, 0), (1, 0)], DEPART, 25)
    assert len(cps) == 1


@pytest.mark.parametrize(
    "kwargs",
    [
        {"points": [(0, 0)]},  # too few points
        {"spacing": 0},
        {"spacing": -5},
        {"progress": [(1, 0), (1, 100)]},  # does not start at first point
        {"progress": [(0, 0), (0, 100)]},  # does not reach last point
        {"progress": [(0, 100), (1, 50)]},  # time goes backwards
        {"departure": datetime(2026, 11, 3, 14, 0)},  # naive datetime
    ],
)
def test_invalid_inputs_raise(kwargs):
    args = {
        "points": [(0, 0), (0, 1)],
        "progress": [(0, 0), (1, 3600)],
        "departure": DEPART,
        "spacing": 25,
    }
    args.update(kwargs)
    with pytest.raises(ValueError):
        build_checkpoints(args["points"], args["progress"], args["departure"], args["spacing"])
