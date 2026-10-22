from trips.domain.recommend import RouteSummary, rank_routes
from trips.domain.risk import Level
from trips.domain.rollup import Rollup


def route(rid, nt=0.0, severe=0.0, high=0.0, avg=1.0, duration_s=36_000, unknown=0.0):
    miles = {lv: 0.0 for lv in Level}
    miles[Level.NO_TRAVEL], miles[Level.SEVERE], miles[Level.HIGH] = nt, severe, high
    return RouteSummary(rid, f"Route {rid}", Rollup(miles, unknown, avg, 500.0, duration_s))


def order(routes):
    return [r.id for r in rank_routes(routes)]


def test_no_travel_miles_beat_everything():
    a = route("A", nt=1, severe=0, high=0, avg=0.1, duration_s=1)
    b = route("B", nt=0, severe=99, high=99, avg=3.9, duration_s=99_999)
    assert order([a, b]) == ["B", "A"]


def test_severe_before_high():
    assert order([route("A", severe=10, high=0), route("B", severe=5, high=200)]) == ["B", "A"]


def test_high_before_average_risk():
    assert order([route("A", high=30, avg=0.2), route("B", high=20, avg=2.0)]) == ["B", "A"]


def test_average_risk_before_duration():
    assert order([route("A", avg=0.9, duration_s=1000), route("B", avg=0.5, duration_s=9000)]) == ["B", "A"]


def test_duration_breaks_final_tie():
    assert order([route("A", duration_s=5000), route("B", duration_s=4000)]) == ["B", "A"]


def test_exact_tie_keeps_input_order():
    assert order([route("A"), route("B")]) == ["A", "B"]


def test_float_noise_does_not_decide_the_ranking():
    a = route("A", severe=10.0004, duration_s=1000)
    b = route("B", severe=10.0, duration_s=9000)
    assert order([a, b]) == ["A", "B"]


def test_route_with_no_weather_data_ranks_last_on_average_risk():
    unknown = route("A", avg=None, unknown=500.0)
    assert order([unknown, route("B", avg=3.0)]) == ["B", "A"]


def test_reasons_name_the_deciding_criterion():
    ranked = rank_routes([route("A", severe=42), route("B", severe=0)])
    assert [r.rank for r in ranked] == [1, 2]
    assert "0 Severe miles vs 42" in ranked[0].reason and "Route A" in ranked[0].reason
    assert "42 Severe miles vs 0" in ranked[1].reason and "Route B" in ranked[1].reason


def test_reason_for_duration_and_average_risk():
    fast = rank_routes([route("A", duration_s=4 * 3600), route("B", duration_s=5 * 3600 + 120)])
    assert "4h 00m vs 5h 02m" in fast[0].reason
    safe = rank_routes([route("A", avg=0.5), route("B", avg=1.25)])
    assert "0.50 vs 1.25" in safe[0].reason


def test_identical_routes_say_so():
    ranked = rank_routes([route("A"), route("B")])
    assert "tie" in ranked[0].reason.lower()


def test_single_route():
    assert "only route" in rank_routes([route("A")])[0].reason.lower()


def test_no_routes():
    assert rank_routes([]) == []
