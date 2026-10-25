"""Place lookup: Photon for typeahead (no quota), TomTom Geocoding for a complete typed address."""
from dataclasses import dataclass
from hashlib import sha1
from urllib.parse import quote

from django.conf import settings
from django.core.cache import cache

from trips.integrations.http import IntegrationError, get_json

PHOTON_URL = "https://photon.komoot.io/api/"
PHOTON_REVERSE_URL = "https://photon.komoot.io/reverse"
TOMTOM_URL = "https://api.tomtom.com/search/2/geocode/{q}.json"
TOMTOM_SEARCH_URL = "https://api.tomtom.com/search/2/search/{q}.json"
MIN_CHARS = 3
CACHE_SECONDS = 24 * 3600


@dataclass(frozen=True)
class Place:
    label: str
    lat: float
    lon: float


def _key(kind: str, query: str) -> str:
    return f"geo:{kind}:{sha1(query.lower().encode()).hexdigest()}"


def _photon_label(props: dict) -> str:
    street = " ".join(filter(None, (props.get("housenumber"), props.get("street"))))
    parts = [props.get("name"), street, props.get("city"), props.get("state")]
    out: list[str] = []
    for part in parts:
        if part and part not in out:
            out.append(part)
    return ", ".join(out)


def autocomplete(query: str) -> list[Place]:
    query = " ".join(query.split())
    if len(query) < MIN_CHARS:
        return []
    key = _key("ac", query)
    if (hit := cache.get(key)) is not None:
        return hit
    try:
        places = _photon(query)
    except IntegrationError:
        # Public Photon rate-limits bursts (measured: 503s, then refused connections). The TomTom search
        # quota is small (2,500/month), so it is only spent while Photon is down.
        places = _tomtom_typeahead(query)
    cache.set(key, places, CACHE_SECONDS)
    return places


def _photon(query: str) -> list[Place]:
    data = get_json("Photon", PHOTON_URL, {"q": query, "limit": 5, "lang": "en"})
    try:
        return [
            Place(_photon_label(f["properties"]), *reversed(f["geometry"]["coordinates"][:2]))
            for f in data["features"]
        ]
    except (KeyError, IndexError, TypeError):
        raise IntegrationError("Photon response has an unexpected shape") from None


def reverse(lat: float, lon: float) -> Place | None:
    """Name for a dropped pin (Photon reverse); None when nothing is near. Keeps the pin's own coordinates."""
    lat, lon = round(lat, 4), round(lon, 4)  # about 10 m: nearby pins share a cache entry
    key = _key("rev", f"{lat},{lon}")
    if (hit := cache.get(key)) is not None:
        return hit or None
    data = get_json("Photon", PHOTON_REVERSE_URL, {"lat": lat, "lon": lon, "limit": 1, "lang": "en"})
    try:
        features = data["features"]
        label = _photon_label(features[0]["properties"]) if features else ""
        place = Place(label or f"{lat}, {lon}", lat, lon) if features else None
    except (KeyError, IndexError, TypeError):
        raise IntegrationError("Photon response has an unexpected shape") from None
    cache.set(key, place or (), CACHE_SECONDS)
    return place


def _tomtom_typeahead(query: str) -> list[Place]:
    params = {"key": settings.TOMTOM_KEY, "typeahead": "true", "limit": 5, "idxSet": "Geo,PAD"}
    data = get_json("TomTom search", TOMTOM_SEARCH_URL.format(q=quote(query, safe="")), params)
    try:
        return [Place(r["address"]["freeformAddress"], r["position"]["lat"], r["position"]["lon"])
                for r in data["results"]]
    except (KeyError, TypeError):
        raise IntegrationError("TomTom search response has an unexpected shape") from None


def geocode(address: str) -> Place | None:
    """Resolve a complete typed address with TomTom; None when nothing matches."""
    address = " ".join(address.split())
    if not address:
        return None
    key = _key("geo", address)
    if (hit := cache.get(key)) is not None:
        return hit or None  # an empty tuple caches "no match"
    data = get_json(
        "TomTom geocoding",
        TOMTOM_URL.format(q=quote(address, safe="")),
        {"key": settings.TOMTOM_KEY, "limit": 1},
    )
    try:
        results = data["results"]
        top = results[0] if results else None
        pos = top["position"] if top else None
        place = Place(top["address"]["freeformAddress"], pos["lat"], pos["lon"]) if top else None
    except (KeyError, TypeError):
        raise IntegrationError("TomTom geocoding response has an unexpected shape") from None
    cache.set(key, place or (), CACHE_SECONDS)
    return place
