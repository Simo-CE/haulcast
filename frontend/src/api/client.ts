import type { AnalyzeRequest, AnalyzeResponse, Place } from '../types/api'

/** `fields` is set for 400s ({"field": ["message"]}); `kind` tells the UI where to show it. */
export class ApiError extends Error {
  readonly kind: 'validation' | 'upstream' | 'network' | 'server'
  readonly fields: Record<string, string>

  constructor(kind: ApiError['kind'], message: string, fields: Record<string, string> = {}) {
    super(message)
    this.kind = kind
    this.fields = fields
  }
}

const NETWORK_MESSAGE = 'Could not reach the server. Check your connection and try again.'

function fieldMessages(body: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [field, value] of Object.entries(body)) {
    out[field] = Array.isArray(value) ? value.join(' ') : String(value)
  }
  return out
}

/** Maps a non-2xx response (status + parsed JSON body, if any) to an ApiError. */
export function toApiError(status: number, body: unknown): ApiError {
  const obj = body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
  if (status === 400) {
    const fields = fieldMessages(obj)
    return new ApiError('validation', Object.values(fields).join(' ') || 'The request was not valid.', fields)
  }
  if (status === 502) {
    const reason = typeof obj.error === 'string' ? obj.error : 'a data provider failed'
    if (reason.includes('NO_ROUTE_FOUND')) {
      return new ApiError('upstream', 'No truck route could be found between these two places.')
    }
    return new ApiError('upstream', `A data provider is not responding (${reason}). Try again in a moment.`)
  }
  return new ApiError('server', 'The server hit an unexpected error. Try again in a moment.')
}

async function request<T>(path: string, init: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, init)
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new ApiError('network', NETWORK_MESSAGE)
  }
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) throw toApiError(response.status, body)
  return body as T
}

export function analyze(payload: AnalyzeRequest, signal?: AbortSignal): Promise<AnalyzeResponse> {
  return request('/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  })
}

export function demoStorm(signal?: AbortSignal): Promise<AnalyzeResponse> {
  return request('/api/demo/storm', { signal })
}

export function reverseGeocode(lat: number, lon: number, signal?: AbortSignal): Promise<Place> {
  return request(`/api/reverse?lat=${lat}&lon=${lon}`, { signal })
}

export function geocode(query: string, signal?: AbortSignal): Promise<Place[]> {
  return request(`/api/geocode?q=${encodeURIComponent(query)}`, { signal })
}
