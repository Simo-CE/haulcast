import { afterEach, describe, expect, it, vi } from 'vitest'
import { analyze, ApiError, demoStorm, geocode, toApiError } from './client'

describe('toApiError', () => {
  it('maps a 400 field map to per-field messages', () => {
    const error = toApiError(400, { origin: ['Could not find "Zzz".'], loadLb: ['Too big.', 'Really.'] })
    expect(error.kind).toBe('validation')
    expect(error.fields).toEqual({ origin: 'Could not find "Zzz".', loadLb: 'Too big. Really.' })
    expect(error.message).toContain('Zzz')
  })

  it('maps a 502 to an upstream error carrying the provider reason', () => {
    const error = toApiError(502, { error: 'TomTom: timeout' })
    expect(error.kind).toBe('upstream')
    expect(error.message).toContain('timeout')
  })

  it('explains NO_ROUTE_FOUND in plain words', () => {
    expect(toApiError(502, { error: 'TomTom routing failed: NO_ROUTE_FOUND' }).message).toBe(
      'No truck route could be found between these two places.',
    )
  })

  it.each([500, 503, 404])('maps %i to a generic server error', (status) => {
    expect(toApiError(status, null).kind).toBe('server')
  })
})

describe('request helpers', () => {
  afterEach(() => vi.unstubAllGlobals())

  const stub = (response: Response | Error) =>
    vi.stubGlobal('fetch', vi.fn(() => (response instanceof Response ? Promise.resolve(response) : Promise.reject(response))))

  it('returns parsed JSON on success and URL-encodes the geocode query', async () => {
    stub(Response.json([{ label: 'Denver, CO', lat: 39.7, lon: -105 }]))
    expect(await geocode('Denver, CO')).toHaveLength(1)
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe('/api/geocode?q=Denver%2C%20CO')
  })

  it('throws a validation ApiError for a 400', async () => {
    stub(Response.json({ departure: ['Departure is in the past.'] }, { status: 400 }))
    await expect(analyze({} as never)).rejects.toMatchObject({ kind: 'validation', fields: { departure: 'Departure is in the past.' } })
  })

  it('throws an upstream ApiError for a 502 with a non-JSON body too', async () => {
    stub(new Response('<html>Bad gateway</html>', { status: 502 }))
    await expect(analyze({} as never)).rejects.toMatchObject({ kind: 'upstream' })
  })

  it('reports a network failure, but lets aborts through untouched', async () => {
    stub(new TypeError('Failed to fetch'))
    await expect(geocode('abc')).rejects.toBeInstanceOf(ApiError)
    stub(new DOMException('aborted', 'AbortError'))
    await expect(geocode('abc')).rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('demoStorm', () => {
  it('reads the recorded storm from /api/demo/storm', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ replay: { title: 'x' } }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const data = await demoStorm()
    expect(fetchMock.mock.calls[0][0]).toBe('/api/demo/storm')
    expect(data.replay?.title).toBe('x')
    vi.unstubAllGlobals()
  })
})
