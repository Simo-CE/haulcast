"""Domain code against a saved real TomTom response (Chicago to Denver, truck, 2 alternatives)."""
import json
from datetime import UTC, datetime
from pathlib import Path

import pytest

from trips.domain.checkpoints import build_checkpoints, cumulative_miles
from trips.domain.routes_select import Candidate, select_routes
from trips.integrations.polyline import decode_polyline

FIXTURE = Path(__file__).parent / "fixtures" / "tomtom_chicago_denver.json"
METERS_PER_MILE = 1609.344
DEPART = datetime(2026, 10, 23, 20, 0, tzinfo=UTC)


@pytest.fixture(scope="module")
def routes():
    out = []
    for i, route in enumerate(json.loads(FIXTURE.read_text())["routes"]):
        leg = route["legs"][0]
        points = decode_polyline(leg["encodedPolyline"], leg["encodedPolylinePrecision"])
        progress = [(p["pointIndex"], p["travelTimeInSeconds"]) for p in route["progress"]]
        summary = route["summary"]
        out.append((Candidate(f"r{i}", points, summary["lengthInMeters"] / METERS_PER_MILE,
                              summary["travelTimeInSeconds"]), progress))
    return out


def test_polyline_decoder_matches_known_example():
    # The worked example from Google's polyline documentation.
    assert decode_polyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@") == [
        (38.5, -120.2), (40.7, -120.95), (43.252, -126.453),
    ]


def test_route_geometry_matches_the_reported_length(routes):
    for cand, _ in routes:
        assert cumulative_miles(cand.points)[-1] == pytest.approx(cand.distance_mi, rel=0.01)


def test_checkpoint_etas_end_at_the_reported_travel_time(routes):
    cand, progress = routes[0]
    cps = build_checkpoints(cand.points, progress, DEPART, 25)
    assert cps[0].mile == 0 and cps[0].eta == DEPART
    assert (cps[-1].eta - DEPART).total_seconds() == pytest.approx(cand.duration_s)
    assert len(cps) == pytest.approx(cand.distance_mi / 25, abs=2)
    assert all(a.eta <= b.eta for a, b in zip(cps, cps[1:], strict=False))


def test_selection_keeps_the_distinct_alternatives(routes):
    selection = select_routes([c for c, _ in routes])
    assert [c.id for c in selection.selected] == ["r0", "r1", "r2"]  # fastest first
    assert selection.dropped == []
