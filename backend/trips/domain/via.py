"""Detour waypoints used to find extra distinct routes when the routing API offers fewer than 3."""
import math

from trips.domain.checkpoints import LatLon, haversine_mi

# Sideways distance as a share of the straight-line trip: wide first, then narrow.
OFFSET_SHARES = (0.2, 0.1)
MIN_OFFSET_MI = 4.0
MAX_OFFSET_MI = 80.0
_MI_PER_DEG_LAT = 69.0


def via_points(origin: LatLon, destination: LatLon, share: float) -> list[LatLon]:
    """Two points either side of the trip's midpoint, perpendicular to the line between the ends.

    Each is `share` of the straight-line trip away, clamped to MIN_OFFSET_MI..MAX_OFFSET_MI.

    Flat-earth maths is fine here: the offset is under 80 mi and the road network snaps the point anyway.
    """
    offset_mi = min(MAX_OFFSET_MI, max(MIN_OFFSET_MI, share * haversine_mi(origin, destination)))
    mid_lat = (origin[0] + destination[0]) / 2
    mid_lon = (origin[1] + destination[1]) / 2
    lon_scale = math.cos(math.radians(mid_lat))
    east, north = (destination[1] - origin[1]) * lon_scale, destination[0] - origin[0]
    length = math.hypot(east, north)
    perp_east, perp_north = -north / length, east / length
    step = offset_mi / _MI_PER_DEG_LAT
    return [
        (mid_lat + side * perp_north * step, mid_lon + side * perp_east * step / lon_scale)
        for side in (1, -1)
    ]
