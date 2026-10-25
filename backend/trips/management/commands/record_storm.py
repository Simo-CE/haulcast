"""Record a past storm as the demo replay: live TomTom routes plus Open-Meteo's archived forecasts.

    python manage.py record_storm   # needs TOMTOM_KEY; writes trips/fixtures/demo_storm.json

The archive (historical-forecast API) holds the short-lead forecasts the models issued on that day, so the
replay goes through exactly the same analysis code as a live trip.
"""
import json
from datetime import UTC, datetime
from pathlib import Path

from django.core.management.base import BaseCommand

from trips.integrations import weather
from trips.integrations.geocode import Place
from trips.services.analyze import analyze

HISTORICAL_URL = "https://historical-forecast-api.open-meteo.com/v1/forecast"
OUT = Path(__file__).resolve().parents[2] / "fixtures" / "demo_storm.json"

ORIGIN = Place("Denver, Colorado", 39.7392, -104.9903)
DESTINATION = Place("Salt Lake City, Utah", 40.7608, -111.891)
DEPARTURE = datetime(2025, 12, 9, 14, 0, tzinfo=UTC)
LOAD_LB = 45_000

REPLAY = {
    "title": "Wyoming wind storm, December 9, 2025",
    "summary": (
        "A strong west wind built across southern Wyoming on 9 December 2025 (the model peaked near 51 mph "
        "around Elk Mountain on I-80). This is a replay of that day's archived forecast, not today's weather."
    ),
    "forecastSource": "Open-Meteo historical forecast archive (best_match)",
}


class Command(BaseCommand):  # pragma: no cover - needs live TomTom and Open-Meteo
    help = "Record the demo storm replay (calls TomTom and Open-Meteo)."

    def handle(self, *args: object, **options: object) -> None:
        weather.URL = HISTORICAL_URL
        result = analyze(ORIGIN, DESTINATION, DEPARTURE, LOAD_LB, 25)
        result["replay"] = REPLAY
        OUT.write_text(json.dumps(result, separators=(",", ":")))
        self.stdout.write(f"wrote {OUT} ({OUT.stat().st_size // 1024} KB)")
        for r in result["routes"]:
            self.stdout.write(f"{r['name']}: {r['distanceMi']} mi, {r['durationMin']} min")
            self.stdout.write(f"  {r['milesByLevel']}")
        self.stdout.write(f"recommended {result['recommendedRouteId']}; warnings {result['warnings']}")
