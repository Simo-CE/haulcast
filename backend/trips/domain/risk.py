"""Weather risk rules. Single source of truth; boundaries are documented in README section 2."""
import math
from bisect import bisect_right
from enum import IntEnum


class Level(IntEnum):
    LOW = 0
    MODERATE = 1
    HIGH = 2
    SEVERE = 3
    NO_TRAVEL = 4

    @property
    def label(self) -> str:
        return self.name.replace("_", " ").title()


# Lower bound of Moderate, High, Severe, No Travel. A value on a bound belongs to the higher level.
_WIND_MPH = (25.0, 35.0, 45.0, 55.0)
# Rain and snow: No Travel is strictly greater than the Severe maximum, so 1.00 in/hr rain is Severe.
_RAIN_IN_HR = (0.10, 0.25, 0.50, 1.00)
_SNOW_IN_HR = (0.5, 1.0, 2.0, 3.0)

WIND_NO_TRAVEL_MPH = 55.0
WIND_SEVERE_LOAD_MPH = 45.0
WIND_HIGH_LOAD_MPH = 35.0
HEAVY_LOAD_LB = 30_000
VERY_HEAVY_LOAD_LB = 40_000


def _check(value: float | None, name: str) -> float:
    if value is None or not math.isfinite(value) or value < 0:
        raise ValueError(f"invalid {name}: {value!r}")
    return float(value)


def classify_wind(mph: float) -> Level:
    return Level(bisect_right(_WIND_MPH, _check(mph, "wind")))


def _classify_inclusive_top(value: float, bounds: tuple[float, ...], name: str) -> Level:
    value = _check(value, name)
    # A value on a lower bound moves up a level; only the top bound is exclusive (1.00 rain is Severe).
    level = bisect_right(bounds[:3], value) + (1 if value > bounds[3] else 0)
    return Level(level)


def classify_rain(inch_per_hr: float) -> Level:
    return _classify_inclusive_top(inch_per_hr, _RAIN_IN_HR, "rain")


def classify_snow(inch_per_hr: float) -> Level:
    return _classify_inclusive_top(inch_per_hr, _SNOW_IN_HR, "snow")


def apply_load_rules(level: Level, wind_mph: float, load_lb: float) -> Level:
    """Load rules only ever raise a level. They apply to wind only, with strict load limits."""
    wind = _check(wind_mph, "wind")
    load = _check(load_lb, "load")
    if wind >= WIND_NO_TRAVEL_MPH:
        return Level.NO_TRAVEL
    if wind >= WIND_SEVERE_LOAD_MPH and load > HEAVY_LOAD_LB:
        return Level.NO_TRAVEL
    if wind >= WIND_HIGH_LOAD_MPH and load > VERY_HEAVY_LOAD_LB:
        return max(level, Level.SEVERE)
    return level


def _load_reason(wind: float, load: float) -> str:
    # Wind at or above 55 mph is already No Travel from the wind classifier, so it never reaches here.
    if wind >= WIND_SEVERE_LOAD_MPH:
        return f"wind {wind:.0f} mph with {load:,.0f} lb load (over {HEAVY_LOAD_LB:,} lb) is No Travel"
    return f"wind {wind:.0f} mph with {load:,.0f} lb load (over {VERY_HEAVY_LOAD_LB:,} lb) is Severe"


def checkpoint_risk(wind: float, rain: float, snow: float, load_lb: float) -> tuple[Level, str]:
    """Worst of wind, rain and snow, then the load rules. Returns the level and a short reason."""
    hazards = {
        "wind": (classify_wind(wind), f"{wind:.0f} mph"),
        "rain": (classify_rain(rain), f"{rain:.2f} in/hr"),
        "snow": (classify_snow(snow), f"{snow:.2f} in/hr"),
    }
    name, (base, amount) = max(hazards.items(), key=lambda item: item[1][0])
    level = apply_load_rules(base, wind, load_lb)
    if level > base:
        return level, _load_reason(wind, load_lb)
    if level == Level.LOW:
        return level, "Calm: no weather hazard"
    return level, f"{name.title()} {amount} ({level.label})"


def _interpolate(value: float, bounds: tuple[float, ...]) -> float:
    """Piecewise-linear 0-4 score: each band between bounds spans one whole point."""
    edges = (0.0, *bounds)
    if value >= edges[-1]:
        return 4.0
    i = bisect_right(edges, value) - 1
    return i + (value - edges[i]) / (edges[i + 1] - edges[i])


def risk_score(wind: float, rain: float, snow: float, load_lb: float) -> float:
    """Continuous 0-4 score for the heatmap. Never below the checkpoint's discrete level."""
    level, _ = checkpoint_risk(wind, rain, snow, load_lb)
    hazard = max(
        _interpolate(wind, _WIND_MPH),
        _interpolate(rain, _RAIN_IN_HR),
        _interpolate(snow, _SNOW_IN_HR),
    )
    return min(4.0, max(hazard, float(level)))
