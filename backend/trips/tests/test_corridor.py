"""corridor_cells: the heatmap lattice around a route."""
import pytest

from trips.domain.checkpoints import haversine_mi
from trips.domain.corridor import corridor_cells
from trips.integrations.weather import snap


def test_a_point_gets_every_cell_within_the_radius_and_nothing_farther():
    centre = (41.8, -87.6)
    cells = corridor_cells([centre], 0.25, 20)
    assert snap(*centre) in cells
    assert all(haversine_mi(centre, c) <= 20 or c == snap(*centre) for c in cells)
    assert (42.5, -87.5) not in cells  # 48 mi north


def test_cells_are_on_the_weather_lattice_so_they_share_forecast_calls():
    cells = corridor_cells([(41.83, -87.61), (41.9, -87.7)], 0.5, 20)
    assert cells and all(c == snap(*c, 0.5) and c == snap(*c) for c in cells)


@pytest.mark.parametrize("step", [0.5, 1.0])
def test_a_coarse_lattice_never_leaves_a_gap_along_the_route(step):
    # Halfway between two 1-degree cell centres no centre is within 20 mi, yet the route still needs a cell.
    samples = [(40.5, -100 + i * 0.1) for i in range(30)]
    cells = corridor_cells(samples, step, 20)
    assert all(snap(*s, step) in cells for s in samples)


def test_empty_route_gives_no_cells():
    assert corridor_cells([], 0.25, 20) == set()
