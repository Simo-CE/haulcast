"""Open-Meteo hourly forecasts on one shared lattice.

Open-Meteo bills every location as one call, so callers snap points to the lattice (`snap`), pass the
distinct cells here, and we fetch each once per hour of cache, 100 cells per request.
"""
import os
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from math import ceil, floor
from typing import Any

from django.core.cache import cache

from trips.integrations.http import IntegrationError, get_json

# Render's shared IP can exhaust Open-Meteo's free daily quota; production routes via the Worker.
URL = os.environ.get("OPEN_METEO_URL", "https://api.open-meteo.com/v1/forecast")
LATTICE_DEG = 0.25
CHUNK = 100
MAX_CELLS = 300
CACHE_SECONDS = 3600
_VARIABLES = ("wind_speed_10m", "wind_gusts_10m", "rain", "showers", "snowfall")
_UNITS = {"wind_speed_10m": "mp/h", "wind_gusts_10m": "mp/h", "rain": "inch", "showers": "inch",
          "snowfall": "inch"}
_HOUR = timedelta(hours=1)

Cell = tuple[float, float]


@dataclass(frozen=True)
class WeatherPoint:
    """Conditions for one ETA. None means the forecast had no value: unknown, never Low."""

    wind_mph: float | None
    gust_mph: float | None
    rain_in_hr: float | None
    snow_in_hr: float | None


@dataclass(frozen=True)
class Forecast:
    """Hourly arrays for one cell; index i is the timestamp `start + i hours` (UTC)."""

    start: datetime
    wind: Sequence[float | None]
    gust: Sequence[float | None]
    rain: Sequence[float | None]  # rain + showers
    snow: Sequence[float | None]

    @property
    def end(self) -> datetime:
        return self.start + (len(self.wind) - 1) * _HOUR

    def at(self, eta: datetime) -> WeatherPoint:
        """Rain and snow are sums of the hour BEFORE their timestamp, so an ETA of 10:30 uses the 11:00
        value. Wind is instantaneous, so it uses the nearest timestamp (10:30 rounds up to 11:00)."""
        hours = (eta - self.start) / _HOUR
        return WeatherPoint(
            self._get(self.wind, floor(hours + 0.5)),
            self._get(self.gust, floor(hours + 0.5)),
            self._get(self.rain, ceil(hours)),
            self._get(self.snow, ceil(hours)),
        )

    @staticmethod
    def _get(values: Sequence[float | None], i: int) -> float | None:
        return values[i] if 0 <= i < len(values) else None


def snap(lat: float, lon: float, step: float = LATTICE_DEG) -> Cell:
    """Nearest lattice cell, so nearby checkpoints and heatmap points share one forecast call.

    Coarser steps (multiples of LATTICE_DEG) are subsets of the base lattice, so they share cache entries."""
    return tuple(round(round(v / step) * step, 4) for v in (lat, lon))  # type: ignore[return-value]


def _sum(a: float | None, b: float | None) -> float | None:
    return None if a is None or b is None else round(a + b, 4)


def _parse_location(obj: dict[str, Any], start: datetime, hours: int) -> Forecast:
    try:
        hourly, units = obj["hourly"], obj["hourly_units"]
        for name, unit in _UNITS.items():
            if units[name] != unit:
                raise IntegrationError(f"Open-Meteo {name} is in {units[name]!r}, expected {unit!r}")
        expected = [(start + i * _HOUR).strftime("%Y-%m-%dT%H:%M") for i in range(hours)]
        if hourly["time"] != expected:
            raise IntegrationError("Open-Meteo timestamps do not match the requested hours")
        for name in _VARIABLES:
            if len(hourly[name]) != hours:
                raise IntegrationError(f"Open-Meteo {name} has {len(hourly[name])} values, expected {hours}")
    except (KeyError, TypeError) as exc:
        raise IntegrationError(f"Open-Meteo response has an unexpected shape: {type(exc).__name__}") from None
    rain = [_sum(r, s) for r, s in zip(hourly["rain"], hourly["showers"], strict=True)]
    return Forecast(start, hourly["wind_speed_10m"], hourly["wind_gusts_10m"], rain, hourly["snowfall"])


def _fetch_chunk(cells: Sequence[Cell], start: datetime, hours: int) -> list[Forecast]:
    params = {
        "latitude": ",".join(str(c[0]) for c in cells),
        "longitude": ",".join(str(c[1]) for c in cells),
        "hourly": ",".join(_VARIABLES),
        "wind_speed_unit": "mph",
        "precipitation_unit": "inch",
        "timezone": "GMT",
        "start_hour": start.strftime("%Y-%m-%dT%H:%M"),
        "end_hour": (start + (hours - 1) * _HOUR).strftime("%Y-%m-%dT%H:%M"),
    }
    data = get_json("Open-Meteo", URL, params, attempts=4, backoff=2.0)
    objs = [data] if isinstance(data, dict) else data  # one location comes back as an object, not a list
    if not isinstance(objs, list) or len(objs) != len(cells):
        raise IntegrationError("Open-Meteo returned a different number of locations than requested")
    return [_parse_location(o, start, hours) for o in objs]


def fetch_forecasts(cells: Iterable[Cell], first: datetime, last: datetime) -> dict[Cell, Forecast]:
    """Forecast for every distinct cell covering `first` (departure) to `last` (latest ETA), UTC."""
    unique = sorted(set(cells))
    if len(unique) > MAX_CELLS:
        raise ValueError(f"{len(unique)} cells exceeds the budget of {MAX_CELLS} per analysis")
    start = first.astimezone(UTC).replace(minute=0, second=0, microsecond=0)
    hours = ceil((last.astimezone(UTC) - start) / _HOUR) + 1
    if hours < 1:
        raise ValueError("last must not be before first")

    result: dict[Cell, Forecast] = {}
    missing: list[Cell] = []
    for cell in unique:
        hit = cache.get(f"wx:{cell[0]}:{cell[1]}")
        if hit and hit.start <= start and hit.end >= start + (hours - 1) * _HOUR:
            result[cell] = hit
        else:
            missing.append(cell)
    for i in range(0, len(missing), CHUNK):
        chunk = missing[i : i + CHUNK]
        for cell, forecast in zip(chunk, _fetch_chunk(chunk, start, hours), strict=True):
            cache.set(f"wx:{cell[0]}:{cell[1]}", forecast, CACHE_SECONDS)
            result[cell] = forecast
    return result
