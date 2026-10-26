"""One GET helper for all external services: timeout, retry with backoff, descriptive User-Agent."""
import logging
import time
from typing import Any

import httpx

log = logging.getLogger(__name__)
USER_AGENT = "Haulcast/0.1 (+https://haulcast.dooma.dev)"


class IntegrationError(Exception):
    """An external service failed or returned data we cannot trust."""


def _reason(resp: httpx.Response) -> str:
    """The service's own error code (TomTom `detailedError.code`, Open-Meteo `reason`), if it sent one."""
    try:
        body = resp.json()
        code = body.get("detailedError", {}).get("code") or body.get("reason")
    except (ValueError, AttributeError):
        return ""
    return f" ({code})" if code else ""


def get_json(
    service: str,
    url: str,
    params: dict[str, Any],
    *,
    timeout: float = 30.0,
    attempts: int = 2,
    backoff: float = 1.0,
) -> Any:
    """GET and parse JSON. Retries 429/5xx with exponential backoff; errors omit the URL (it holds a key)."""
    for attempt in range(attempts):
        last = attempt == attempts - 1
        try:
            resp = httpx.get(url, params=params, headers={"User-Agent": USER_AGENT}, timeout=timeout)
        except httpx.HTTPError as exc:
            raise IntegrationError(f"{service} request failed: {type(exc).__name__}") from None
        if resp.status_code != 200:  # host only: the URL holds a key
            keep = ("retry-after", "x-ratelimit", "cf-ray", "server")
            diagnostic = {k: v for k, v in resp.headers.items() if k.lower().startswith(keep)}
            log.warning("%s GET %s -> %s %s", service, httpx.URL(url).host, resp.status_code, diagnostic)
        if (resp.status_code == 429 or resp.status_code >= 500) and not last:
            time.sleep(backoff * 2**attempt)
            continue
        if resp.status_code != 200:
            raise IntegrationError(f"{service} returned HTTP {resp.status_code}{_reason(resp)}")
        try:
            return resp.json()
        except ValueError:
            raise IntegrationError(f"{service} returned invalid JSON") from None
    raise AssertionError("unreachable")  # pragma: no cover
