"""Lattice cells near a route: the heatmap grid."""
import math
from collections.abc import Iterable

from trips.domain.checkpoints import EARTH_RADIUS_MI, LatLon, haversine_mi

MI_PER_DEG_LAT = EARTH_RADIUS_MI * math.pi / 180


def corridor_cells(samples: Iterable[LatLon], step_deg: float, radius_mi: float) -> set[LatLon]:
    """Cells of a `step_deg` lattice whose centre is within `radius_mi` of any sample point.

    The cell nearest to each sample is always included, so a coarse lattice never leaves a gap in the
    corridor. Cell coordinates are rounded the same way as `weather.snap`, so they match its keys.
    """
    cells: set[LatLon] = set()
    for lat, lon in samples:
        i0, j0 = round(lat / step_deg), round(lon / step_deg)
        di = math.ceil(radius_mi / (step_deg * MI_PER_DEG_LAT))
        dj = math.ceil(radius_mi / (step_deg * MI_PER_DEG_LAT * max(math.cos(math.radians(lat)), 0.01)))
        for i in range(i0 - di, i0 + di + 1):
            for j in range(j0 - dj, j0 + dj + 1):
                cell = (round(i * step_deg, 4), round(j * step_deg, 4))
                if (i, j) == (i0, j0) or haversine_mi((lat, lon), cell) <= radius_mi:
                    cells.add(cell)
    return cells
