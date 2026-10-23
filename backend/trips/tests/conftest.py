import json
from pathlib import Path

import pytest
from django.core.cache import cache

FIXTURES = Path(__file__).parent / "fixtures"


def load_fixture(name: str):
    return json.loads((FIXTURES / name).read_text())


@pytest.fixture(autouse=True)
def _isolated(settings, monkeypatch):
    """Every test starts with an empty cache, a fake key, and no real sleeping between retries."""
    cache.clear()
    settings.TOMTOM_KEY = "test-key"
    sleeps: list[float] = []
    monkeypatch.setattr("trips.integrations.http.time.sleep", sleeps.append)
    return sleeps


@pytest.fixture
def sleeps(_isolated):
    return _isolated
