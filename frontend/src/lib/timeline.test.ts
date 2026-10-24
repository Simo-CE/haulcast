import { describe, expect, it } from 'vitest'
import three from '../test/fixtures/analyze-3-routes.json'
import real from '../test/fixtures/analyze-dallas-denver.json'
import type { AnalyzeResponse } from '../types/api'
import abq from '../test/fixtures/analyze-abq-denver-mixed.json'
import { ariaTimeText, clockAt, formatOffset, mileAt, pathLengths, arrivalHour, truckPosition } from './timeline'

const route = (real as unknown as AnalyzeResponse).routes[0]
const start = (real as unknown as AnalyzeResponse).heatmap.startTime

describe('labels', () => {
  it('formats the offset in hours and minutes', () => {
    expect(formatOffset(0)).toBe('+0h')
    expect(formatOffset(12)).toBe('+12h')
    expect(formatOffset(12.25)).toBe('+12h 15m')
    expect(formatOffset(47.999)).toBe('+48h')
  })
  it('gives the absolute local clock time and a spoken value', () => {
    const expected = new Date(Date.parse(start) + 3 * 3_600_000).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' })
    expect(clockAt(start, 3)).toBe(expected)
    expect(ariaTimeText(start, 3)).toBe(`+3h, ${expected}`)
  })
})

describe('truck position', () => {
  const cum = pathLengths(route.geometry)
  const last = route.checkpoints[route.checkpoints.length - 1]
  it('starts at the origin and ends at the destination', () => {
    expect(truckPosition(route, cum, start, 0)).toEqual(route.geometry[0])
    expect(truckPosition(route, cum, start, 48)).toEqual(route.geometry[route.geometry.length - 1])
  })
  it('follows the checkpoint ETAs', () => {
    const cp = route.checkpoints[10]
    const hour = (Date.parse(cp.eta) - Date.parse(start)) / 3_600_000
    expect(mileAt(route, start, hour)).toBeCloseTo(cp.mile)
    expect(mileAt(route, start, hour + 0.001)).toBeGreaterThan(cp.mile)
    expect(last.mile).toBeGreaterThan(800)
  })
  it('is on the route halfway through the trip and handles a route without checkpoints', () => {
    const mid = truckPosition(route, cum, start, (Date.parse(last.eta) - Date.parse(start)) / 7_200_000)
    expect(mid[0]).toBeGreaterThan(-106)
    expect(mid[0]).toBeLessThan(-96)
    const bare = { ...(three as unknown as AnalyzeResponse).routes[0], checkpoints: [] }
    expect(mileAt(bare, start, 5)).toBe(0)
  })
})

describe('arrivalHour', () => {
  const r = abq as unknown as AnalyzeResponse
  it('is when the last checkpoint is reached, per route', () => {
    const [a, b, c] = r.routes.map((route) => arrivalHour(route, r.heatmap.startTime))
    expect(a).toBeLessThan(b)
    expect(b).toBeLessThan(c)
    expect(c).toBeCloseTo(10.2, 0)
    expect(arrivalHour({ ...r.routes[0], checkpoints: [] }, r.heatmap.startTime)).toBe(0)
  })
})
