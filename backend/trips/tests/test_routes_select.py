import pytest

from trips.domain.routes_select import Candidate, overlap_fraction, select_routes

DEG_MI = 69.093


def line(lat, lon0=0.0, lon1=1.0, n=40):
    return [(lat, lon0 + (lon1 - lon0) * i / n) for i in range(n + 1)]


def cand(cid, pts, duration_s=3600, miles=None):
    miles = miles if miles is not None else abs(pts[-1][1] - pts[0][1]) * DEG_MI
    return Candidate(cid, pts, miles, duration_s)


def ids(selection):
    return [c.id for c in selection.selected]


def test_overlap_of_identical_and_distant_lines():
    assert overlap_fraction(line(0), line(0)) == pytest.approx(1.0)
    assert overlap_fraction(line(0), line(0.5)) == 0.0  # about 34 miles apart


def test_overlap_when_sharing_the_first_ninety_percent():
    shared = line(0, 0, 0.9)
    a = shared + [(0.0, 0.9 + 0.1 * i / 10) for i in range(1, 11)]
    b = shared + [(0.1 * i / 10, 0.9 + 0.1 * i / 10) for i in range(1, 11)]  # diverges north
    assert 0.85 < overlap_fraction(a, b) < 0.95


def test_fastest_first_and_distinct_routes_kept():
    sel = select_routes([
        cand("slow", line(0.3), 5000),
        cand("fast", line(0), 3000),
        cand("mid", line(-0.3), 4000),
    ])
    assert ids(sel) == ["fast", "mid", "slow"]
    assert sel.dropped == []


def test_near_duplicate_is_dropped_with_reason():
    sel = select_routes(
        [cand("a", line(0), 3000), cand("dup", line(0.001), 3100), cand("b", line(0.3), 4000)]
    )
    assert ids(sel) == ["a", "b"]
    assert sel.dropped[0][0] == "dup" and "overlap" in sel.dropped[0][1]


def test_absurd_detour_is_dropped():
    sel = select_routes([cand("a", line(0), 3000), cand("far", line(0.5), 9000, miles=DEG_MI * 2.5)])
    assert ids(sel) == ["a"]
    assert "longer" in sel.dropped[0][1] and sel.detours == []


def test_a_long_detour_fills_a_missing_route_and_is_flagged():
    far = cand("far", line(0.5), 9000, miles=DEG_MI * 1.6)
    sel = select_routes([cand("a", line(0), 3000), far, cand("b", line(1.0), 4000)])
    assert ids(sel) == ["a", "b", "far"]  # still fastest first
    assert sel.detours == ["far"] and sel.dropped == []


def test_a_good_route_is_preferred_over_a_detour_and_detours_never_duplicate():
    far = cand("far", line(0.5), 3500, miles=DEG_MI * 1.6)
    twin = cand("twin", line(0), 9000, miles=DEG_MI * 1.6)  # same road as "a" and too long
    others = [cand("b", line(1.0), 4000), cand("c", line(1.5), 5000)]
    sel = select_routes([cand("a", line(0), 3000), far, twin, *others])
    assert ids(sel) == ["a", "b", "c"] and sel.detours == []
    assert [d[0] for d in sel.dropped] == ["far"]
    only = select_routes([cand("a", line(0), 3000), twin])
    assert ids(only) == ["a"] and only.detours == []  # a detour on the same road is still a duplicate


def test_at_most_three_and_returns_fewer_when_that_is_all_there_is():
    many = [cand(str(i), line(0.3 * i), 3000 + i) for i in range(5)]
    assert len(select_routes(many).selected) == 3
    assert ids(select_routes([cand("only", line(0))])) == ["only"]
    assert select_routes([]).selected == []
