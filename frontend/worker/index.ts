// Runs only for /api/* (run_worker_first in wrangler.jsonc); every other path is a static asset.
// Proxying keeps the API on the same origin, so the app's relative /api calls need no CORS.
interface Env {
  BACKEND_URL: string
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    return fetch(new Request(env.BACKEND_URL + url.pathname + url.search, request))
  },
}
