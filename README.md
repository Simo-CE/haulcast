# Haulcast

Weather-aware truck routing. Enter an origin, a destination, a departure time and a load weight, and Haulcast
compares three truck routes using the forecast at the time the truck actually reaches each point, then
recommends the safest one and explains why the others lost.

**Live:** https://haulcast.dooma.dev

- Three distinct truck routes per trip (TomTom truck routing), each rated checkpoint by checkpoint.
- Weather is sampled every 10, 25 or 50 miles at the truck's estimated arrival time, not at departure time.
- Risk rules for wind, rain, snow and load weight, with a ranked recommendation and a reason for every route.
- Map with routes, checkpoints, ETAs and a weather heatmap with a 0-48 hour slider. The slider never makes a
  network request: all 49 hourly values come back in the same response.
- Light and dark themes, mobile layout, accessibility checks in CI.

## Run it locally

Needs Python 3.15, Node 26 and a [TomTom](https://developer.tomtom.com) API key. From the repo root:

```bash
cp .env.example .env     # then put your key in TOMTOM_KEY=
npm run setup:backend    # once: creates backend/.venv and installs the Python packages
npm run setup:frontend   # once: npm install
npm run backend          # terminal 1: API on http://127.0.0.1:8000
npm run frontend         # terminal 2: UI on http://localhost:5173 (Vite proxies /api to :8000)
```

Checks: `npm run test:backend`, `npm run lint:backend`, `npm run check:frontend` (typecheck, lint, unit tests,
build). End-to-end and accessibility tests run with Playwright and axe (`frontend/e2e`).

## How it works

```
Browser (React + MUI + MapLibre)
   |  POST /api/analyze  {origin, destination, departure, loadLb, spacingMi}
   v
Django + DRF (stateless, no database)
   1. geocode      origin/destination -> lat/lon       (Photon autocomplete; TomTom Geocoding for typed addresses)
   2. routes       3 distinct truck routes             (TomTom truck, maxAlternatives=2)
   3. checkpoints  a point every N miles, ETA from TomTom's per-point cumulative travel time
   4. weather      batched hourly forecast on one shared grid (Open-Meteo), hour matched to each ETA
   5. risk         per checkpoint: worst of wind/rain/snow, then load rules   (pure Python)
   6. rollup       per route: miles at each level, average risk, duration
   7. recommend    rank routes, explain why each loser lost                   (pure Python)
   8. heatmap      corridor grid x 49 hourly risk values, in the same response
   v
JSON -> map, route cards, checkpoint popups, heatmap + slider
```

### Risk rules

| Condition | Low | Moderate | High | Severe | No Travel |
|---|---|---|---|---|---|
| Wind | <25 mph | 25-34 | 35-44 | 45-54 | >=55 mph |
| Rain | <0.10 in/hr | 0.10-0.25 | 0.25-0.50 | 0.50-1.00 | >1.00 |
| Snow | <0.5 in/hr | 0.5-1.0 | 1.0-2.0 | 2.0-3.0 | >3.0 |

Load rules (wind only):
- Wind >=55 mph: **No Travel** for any load.
- Wind 45-54 mph and load >30,000 lb: **No Travel**.
- Wind 35-44 mph and load >40,000 lb: **Severe**.

Routes are ranked by: fewest No Travel miles, fewest Severe miles, fewest High miles, lowest average risk,
shortest travel time.

### Design decisions and assumptions

- **ETA per checkpoint.** `ETA = departure + cumulative driving seconds`, and the forecast for that hour at that
  place is used.
- **Boundaries.** Lower bound inclusive, upper bound exclusive, except No Travel for rain and snow, which is strictly
  greater than the Severe maximum (exactly 1.00 in/hr rain is Severe; exactly 55 mph wind is No Travel). Load limits
  (30,000 and 40,000 lb) are strict `>`.
- **Checkpoint level** is the worst of wind, rain and snow, then the load rules, which only ever raise it.
  Levels score Low=0, Moderate=1, High=2, Severe=3, No Travel=4.
- **Miles at a level.** Each checkpoint owns half of the gap to each neighbour. Average risk is mileage-weighted.
- **Open-Meteo timestamps.** Rain and snowfall are preceding-hour sums stamped at the hour end, while wind is
  instantaneous, so an ETA of 10:30 uses the rain and snow value stamped 11:00.
- **Wind input** is sustained 10 m wind; gusts are shown as extra information only.
- **Snow** uses Open-Meteo `snowfall` (centimetres converted to inches), not liquid equivalent.
- **Missing data is never Low.** A checkpoint with a missing weather value is "Unknown", its miles are counted
  separately, and the route gets a warning.
- **One weather grid** serves the heatmap and the checkpoints, because Open-Meteo bills every location as one call.
  An analysis stays under about 300 locations; long trips fall back to a coarser lattice with a warning.
- **Three routes.** One TomTom request with `maxAlternatives=2`; if fewer than three distinct routes come back, extra
  requests route through waypoints on either side of the trip. Near-duplicates and large detours are dropped, and the
  response says `complete: false` if three cannot be found.
- Hours of service, live incidents and road closures are out of scope. Weather is a model forecast, not radar.

## Stack

| Layer | Choice |
|---|---|
| Frontend | Vite, React, TypeScript, Material UI (custom theme, light and dark), TanStack Query |
| Map | MapLibre GL via `react-map-gl/maplibre`, OpenFreeMap tiles, WebGL heatmap layer |
| Backend | Django and Django REST Framework, `httpx`, `LocMemCache` |
| Routing | TomTom truck routing |
| Geocoding | Photon (autocomplete), TomTom Geocoding (typed addresses) |
| Weather | Open-Meteo (`best_match`) |
| Tests | pytest, pytest-django, respx, hypothesis; Vitest; Playwright and axe |
| CI | GitHub Actions |

## Repository layout

```
backend/
  config/                 Django project (settings, urls, wsgi)
  trips/
    domain/               pure Python: risk, checkpoints, rollup, ranking (no Django imports)
    integrations/         geocode, routing, weather clients (timeouts, retries, caching)
    services/analyze.py   orchestration
    serializers.py, views.py, urls.py
    tests/                unit tests and fixtures (saved real API responses)
frontend/
  src/components/, src/api/, src/lib/, src/types/
  worker/                 Cloudflare Worker: serves the build and proxies /api
  e2e/                    Playwright tests
Dockerfile                production image for the API
.github/workflows/ci.yml
```

## API

`POST /api/analyze`
```json
{ "origin": "Dallas, TX", "destination": {"lat": 39.74, "lon": -104.99, "label": "Denver, CO"},
  "departure": "2026-11-03T08:00:00-06:00", "loadLb": 42000, "spacingMi": 25 }
```
`origin` and `destination` are text (geocoded by the backend) or exact coordinates. `departure` must carry a
timezone, be no more than 5 minutes in the past and within 7 days. `loadLb` is the payload, 0 < load <= 100,000.
`spacingMi` is 10, 25 or 50 (default 25).

Response (times are ISO 8601 UTC; miles, mph, inches/hr):
```
origin, destination      {label, lat, lon}
routes[]                 id, name, distanceMi, durationMin, milesByLevel, unknownMi, avgRisk,
                         geometry [[lon, lat], ...],
                         checkpoints[{mile, lat, lon, eta, windMph, gustMph, rainInHr, snowInHr,
                                      level (0-4, null = unknown), levelLabel, reason}]
recommendedRouteId, ranking[{routeId, rank, reason}]
heatmap                  {startTime, hours: 49, stepDeg, scoreScale: 10, unknownScore: -1,
                          points[{lat, lon, scores[49]}]}
warnings[], complete     complete is false when fewer than 3 distinct routes exist
timingsMs                geocode / routes / weather / risk / total
```
Errors: `400 {"field": ["message"]}` for bad input (including an address that cannot be found and origin equal to
destination); `502 {"error": "..."}` when TomTom, Open-Meteo or the geocoder fail, with the service's own reason code
and never a URL or key.

Other endpoints: `GET /api/geocode?q=...` (cached autocomplete proxy), `GET /api/demo/storm` (a recorded real storm
in the `/api/analyze` shape, re-recorded with `python manage.py record_storm`) and `GET /api/health`.

## Deployment

- **Frontend and `/api` proxy:** a Cloudflare Worker (`frontend/wrangler.jsonc`, `frontend/worker/index.ts`) serves
  the static build and forwards `/api/*` to the backend, so the browser only talks to one origin and no CORS is needed.
  Set `BACKEND_URL` in `wrangler.jsonc`, then `cd frontend && npm run build && npx wrangler deploy`.
- **API:** the `Dockerfile` builds a production image that listens on port 8000. Runtime variables: `DEBUG=0`,
  `DJANGO_SECRET_KEY`, `DJANGO_ALLOWED_HOSTS` (the API's public hostname) and `TOMTOM_KEY`. Use a TCP readiness
  probe, because an HTTP probe's Host header would be rejected by `ALLOWED_HOSTS`.
- Run the image locally:
  ```bash
  docker build -t haulcast-api .
  docker run -p 8000:8000 --env-file .env -e DJANGO_SECRET_KEY=local \
    -e DJANGO_ALLOWED_HOSTS=127.0.0.1,localhost haulcast-api
  ```

The TomTom key is only ever used by the Django backend and is never sent to the browser. `.env` is gitignored;
`.env.example` lists the variables.
