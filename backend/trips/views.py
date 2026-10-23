"""HTTP layer: validate, call the service, map failures to status codes."""
from rest_framework.decorators import api_view
from rest_framework.request import Request
from rest_framework.response import Response

from trips.integrations.geocode import autocomplete
from trips.integrations.http import IntegrationError
from trips.serializers import AnalyzeSerializer
from trips.services.analyze import InputError, analyze

BAD_GATEWAY = 502


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
    return Response(result)


@api_view(["GET"])
def geocode_suggestions(request: Request) -> Response:
    try:
        places = autocomplete(request.query_params.get("q", ""))
    except IntegrationError as exc:
        return Response({"error": str(exc)}, status=BAD_GATEWAY)
    return Response([{"label": p.label, "lat": p.lat, "lon": p.lon} for p in places])
