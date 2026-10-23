"""geocode.py against saved real Photon and TomTom responses (offline)."""
import httpx
import pytest

from trips.integrations import geocode
from trips.integrations.http import IntegrationError
from trips.tests.conftest import load_fixture

PHOTON = r"https://photon\.komoot\.io/api/.*"
TOMTOM = r"https://api\.tomtom\.com/search/2/geocode/.*"


def test_autocomplete_returns_labelled_coordinates(respx_mock):
    route = respx_mock.get(url__regex=PHOTON).respond(json=load_fixture("photon_denv.json"))
    places = geocode.autocomplete("Denv")
    assert len(places) == 5
    # GeoJSON order is lon, lat, so the Place must swap them
    assert places[0] == geocode.Place("Denver, Colorado", 39.7392364, -104.984862)
    assert places[2].label == "Denver International Airport, 8500 Peña Blvd, Denver, Colorado"
    q = dict(route.calls.last.request.url.params)
    assert q["bbox"] == "-125,24,-66,50" and q["limit"] == "5" and q["lang"] == "en"
    assert route.calls.last.request.headers["user-agent"].startswith("Haulcast")


def test_autocomplete_waits_for_three_characters(respx_mock):
    route = respx_mock.get(url__regex=PHOTON).respond(json=load_fixture("photon_denv.json"))
    assert geocode.autocomplete(" De ") == []
    assert route.call_count == 0


def test_autocomplete_is_cached_ignoring_case_and_spacing(respx_mock):
    route = respx_mock.get(url__regex=PHOTON).respond(json=load_fixture("photon_denv.json"))
    geocode.autocomplete("Denv")
    geocode.autocomplete("  denv ")
    assert route.call_count == 1


def test_unexpected_photon_shape_also_triggers_the_fallback(respx_mock):
    respx_mock.get(url__regex=PHOTON).respond(json={"nope": 1})
    respx_mock.get(url__regex=r"https://api\.tomtom\.com/search/2/search/.*").respond(
        json=load_fixture("tomtom_search_denv.json")
    )
    assert geocode.autocomplete("Denv")[0].label == "Denver, CO"


def test_typed_address_resolves_through_tomtom(respx_mock):
    route = respx_mock.get(url__regex=TOMTOM).respond(json=load_fixture("tomtom_geocode_whitehouse.json"))
    place = geocode.geocode("1600 Pennsylvania Ave NW, Washington, DC")
    assert place == geocode.Place("1600 Pennsylvania Avenue Northwest, Washington, DC 20500",
                                  38.8977018, -77.0365431)
    q = dict(route.calls.last.request.url.params)
    assert q["countrySet"] == "US" and q["key"] == "test-key"
    assert "1600%20Pennsylvania" in str(route.calls.last.request.url)
    geocode.geocode("1600 pennsylvania ave nw, washington, dc")
    assert route.call_count == 1


def test_no_match_is_none_and_is_cached(respx_mock):
    route = respx_mock.get(url__regex=TOMTOM).respond(json={"summary": {}, "results": []})
    assert geocode.geocode("zzzz nowhere") is None
    assert geocode.geocode("zzzz nowhere") is None
    assert route.call_count == 1


def test_blank_address_makes_no_request(respx_mock):
    route = respx_mock.get(url__regex=TOMTOM).respond(json={})
    assert geocode.geocode("   ") is None and route.call_count == 0


def test_geocode_errors(respx_mock):
    respx_mock.get(url__regex=TOMTOM).mock(
        side_effect=[httpx.Response(200, json={"x": 1}), httpx.Response(403)]
    )
    with pytest.raises(IntegrationError, match="unexpected shape"):
        geocode.geocode("a b c")
    with pytest.raises(IntegrationError, match="HTTP 403"):
        geocode.geocode("d e f")


TT_SEARCH = r"https://api\.tomtom\.com/search/2/search/.*"


def test_photon_outage_falls_back_to_tomtom_typeahead(respx_mock):
    photon = respx_mock.get(url__regex=PHOTON).respond(503)  # the public server's real answer under load
    tomtom = respx_mock.get(url__regex=TT_SEARCH).respond(json=load_fixture("tomtom_search_denv.json"))
    places = geocode.autocomplete("Denv")
    assert places[0] == geocode.Place("Denver, CO", 39.738453, -104.984853) and len(places) == 5
    q = dict(tomtom.calls.last.request.url.params)
    assert q["typeahead"] == "true" and q["countrySet"] == "US" and q["key"] == "test-key"
    assert photon.call_count == 2  # one retry first
    geocode.autocomplete("denv")
    assert tomtom.call_count == 1  # the fallback answer is cached too


def test_both_services_down_is_an_error(respx_mock):
    respx_mock.get(url__regex=PHOTON).respond(503)
    respx_mock.get(url__regex=TT_SEARCH).respond(429)
    with pytest.raises(IntegrationError, match="TomTom search returned HTTP 429"):
        geocode.autocomplete("Denv")


def test_malformed_fallback_is_an_error(respx_mock):
    respx_mock.get(url__regex=PHOTON).respond(503)
    respx_mock.get(url__regex=TT_SEARCH).respond(json={"nope": 1})
    with pytest.raises(IntegrationError, match="unexpected shape"):
        geocode.autocomplete("Denv")
