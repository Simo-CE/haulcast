"""HTTP layer: validate, call the service, map failures to status codes."""
import json
import logging
from functools import cache
from pathlib import Path

from rest_framework.decorators import api_view
from rest_framework.request import Request
from rest_framework.response import Response

from trips.integrations.geocode import autocomplete, reverse
from trips.integrations.http import IntegrationError
from trips.serializers import AnalyzeSerializer
from trips.services.analyze import InputError, analyze

BAD_GATEWAY = 502
log = logging.getLogger(__name__)
DEMO_STORM = Path(__file__).parent / "fixtures" / "demo_storm.json"


@api_view(["GET"])
def health(_request: Request) -> Response:
    return Response({"status": "ok"})


@api_view(["POST"])
def analyze_trip(request: Request) -> Response:
    serializer = AnalyzeSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data
    try:
        result = analyze(
            data["origin"], data["destination"], data["departure"], data["loadLb"], data["spacingMi"]
        )
    except InputError as exc:
        return Response({exc.field: [exc.message]}, status=400)
    except IntegrationError as exc:  # messages never contain a URL or key (see integrations/http.py)
        return Response({"error": str(exc)}, status=BAD_GATEWAY)
    except Exception:  # a bug must reach the client as JSON, not as a Django debug page with a stack trace
        log.exception("analyze failed")
        return Response({"error": "Unexpected server error"}, status=500)
    return Response(result)


@cache
def _demo_storm() -> dict:
    return json.loads(DEMO_STORM.read_text())


@api_view(["GET"])
def demo_storm(_request: Request) -> Response:
    """A recorded real storm (`manage.py record_storm`): the /api/analyze shape plus a `replay` block."""
    return Response(_demo_storm())


@api_view(["GET"])
def geocode_suggestions(request: Request) -> Response:
    try:
        places = autocomplete(request.query_params.get("q", ""))
    except IntegrationError as exc:
        return Response({"error": str(exc)}, status=BAD_GATEWAY)
    return Response([{"label": p.label, "lat": p.lat, "lon": p.lon} for p in places])


@api_view(["GET"])
def reverse_geocode(request: Request) -> Response:
    """Names a pin dropped on the map: {label, lat, lon}, or 404 when nothing is near."""
    try:
        lat, lon = float(request.query_params["lat"]), float(request.query_params["lon"])
    except (KeyError, ValueError):
        return Response({"error": "lat and lon are required numbers"}, status=400)
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return Response({"error": "lat and lon are out of range"}, status=400)
    try:
        place = reverse(lat, lon)
    except IntegrationError as exc:
        return Response({"error": str(exc)}, status=BAD_GATEWAY)
    if place is None:
        return Response({"error": "No place found here"}, status=404)
    return Response({"label": place.label, "lat": place.lat, "lon": place.lon})
