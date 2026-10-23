"""Input validation for POST /api/analyze."""
import math
from datetime import UTC, datetime, timedelta

from rest_framework import serializers

from trips.integrations.geocode import MIN_CHARS, Place

MAX_LOAD_LB = 100_000
SPACINGS_MI = (10, 25, 50)
MAX_ADDRESS_CHARS = 200
# "Depart now" is sent a moment before it arrives; routing floors the departure to the hour anyway.
PAST_GRACE = timedelta(minutes=5)
MAX_LEAD = timedelta(days=7)  # Open-Meteo reaches 16 days; the trip itself can run 2+ days on top


def _now() -> datetime:
    return datetime.now(UTC)


def _number(value: object) -> float | None:
    if isinstance(value, bool) or not isinstance(value, int | float) or not math.isfinite(value):
        return None
    return float(value)


class PlaceField(serializers.Field):
    """Either text to geocode ("Dallas, TX") or exact coordinates {"lat", "lon", "label"?}."""

    default_error_messages = {
        # Braces are doubled because DRF runs str.format on these messages.
        "invalid": 'Send an address as text, or coordinates as {{"lat": 41.88, "lon": -87.63}}.',
        "length": f"Address must be {MIN_CHARS} to {MAX_ADDRESS_CHARS} characters.",
        "range": "Latitude must be within -90..90 and longitude within -180..180.",
    }

    def to_internal_value(self, data: object) -> str | Place:
        if isinstance(data, str):
            text = " ".join(data.split())
            if not MIN_CHARS <= len(text) <= MAX_ADDRESS_CHARS:
                self.fail("length")
            return text
        if not isinstance(data, dict):
            self.fail("invalid")
        lat, lon = _number(data.get("lat")), _number(data.get("lon"))
        if lat is None or lon is None:
            self.fail("invalid")
        if not (-90 <= lat <= 90 and -180 <= lon <= 180):
            self.fail("range")
        label = str(data.get("label") or "").strip()[:MAX_ADDRESS_CHARS]
        return Place(label or f"{lat:.4f}, {lon:.4f}", lat, lon)


class AnalyzeSerializer(serializers.Serializer):
    origin = PlaceField()
    destination = PlaceField()
    departure = serializers.CharField()
    loadLb = serializers.FloatField(max_value=MAX_LOAD_LB)
    spacingMi = serializers.ChoiceField(choices=SPACINGS_MI, default=25)

    def validate_loadLb(self, value: float) -> float:
        if value <= 0:
            raise serializers.ValidationError("Load must be greater than 0 lb.")
        return value

    def validate_departure(self, value: str) -> datetime:
        try:
            departure = datetime.fromisoformat(value)
        except ValueError:
            raise serializers.ValidationError("Use ISO 8601, e.g. 2026-11-03T08:00:00-06:00.") from None
        if departure.tzinfo is None:
            raise serializers.ValidationError("Departure needs a timezone offset, for example -06:00 or Z.")
        now = _now()
        if departure < now - PAST_GRACE:
            raise serializers.ValidationError("Departure is in the past.")
        if departure > now + MAX_LEAD:
            raise serializers.ValidationError("Departure must be within the next 7 days.")
        return departure.astimezone(UTC)
