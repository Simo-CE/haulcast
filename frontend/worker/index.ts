// Runs only for /api/* (run_worker_first in wrangler.jsonc); every other path is a static asset.
// Proxying keeps the API on the same origin, so the app's relative /api calls need no CORS.
interface Env {
  BACKEND_URL: string
}

const OPEN_METEO_PATH = "/openmeteo"
const OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === OPEN_METEO_PATH) return fetch(OPEN_METEO_URL + url.search, { headers: request.headers })
    return fetch(new Request(env.BACKEND_URL + url.pathname + url.search, request))
  },
  // Render's free tier sleeps after 15 min idle; a ping every 10 min keeps cold starts away from users.
  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    await fetch(env.BACKEND_URL + "/api/health")
  },
}
