import { describe, expect, it } from 'vitest'
import real from '../test/fixtures/analyze-dallas-denver.json'
import type { AnalyzeResponse, Heatmap } from '../types/api'
import { buildGrid, buildRaster, hasUnknown, makeLut, paintField, rampAlpha, rampColor, ribbonHalfWidthMi, valuesAt } from './heatField'
import { LEVEL_STYLES } from './risk'

const heatmap = (scores: number[][]): Heatmap => ({
  startTime: '2026-10-24T14:00:00Z',
  hours: scores[0].length,
  stepDeg: 1,
  scoreScale: 10,
  unknownScore: -1,
  // a 3 x 3 block of cells around (40, -100); only the middle one is given unless `scores` has 9 rows
  points: scores.map((s, i) => ({ lat: 40 + Math.floor(i / 3) - (scores.length > 1 ? 1 : 0), lon: -100 + (i % 3) - (scores.length > 1 ? 1 : 0), scores: s })),
})
const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
const ROUTE: [number, number][][] = [[[-101, 40], [-99, 40]]] // runs through the middle row of the 3 x 3 block
const centre = (g: ReturnType<typeof buildGrid>, values: Float32Array) => {
  const r = buildRaster(g, ROUTE)
  const out = new Uint8ClampedArray(r.width * r.height * 4)
  paintField(r, values, makeLut('light'), out)
  const o = ((Math.floor(r.height / 2) * r.width) + Math.floor(r.width / 2)) * 4
  return { out, o, rgba: [...out.slice(o, o + 4)], r }
}

describe('rampColor', () => {
  it('is exactly the level colours at whole scores, and blends between them', () => {
    expect(rampColor(0, 'light')).toEqual(hex(LEVEL_STYLES.Low.light))
    expect(rampColor(3, 'light')).toEqual(hex(LEVEL_STYLES.Severe.light))
    expect(rampColor(4, 'dark')).toEqual(hex(LEVEL_STYLES['No Travel'].dark))
    const mid = rampColor(0.5, 'light')
    expect(mid[0]).toBeGreaterThan(hex(LEVEL_STYLES.Low.light)[0])
    expect(mid[0]).toBeLessThan(hex(LEVEL_STYLES.Moderate.light)[0])
  })
  it('clamps out-of-range scores and grows more opaque with risk', () => {
    expect(rampColor(9, 'light')).toEqual(rampColor(4, 'light'))
    expect(rampAlpha(4)).toBeGreaterThan(rampAlpha(0))
  })
})

describe('buildGrid / valuesAt', () => {
  const grid = buildGrid(heatmap([[0, 20, 40], [-1, -1, 10]]))
  it('converts tenths to risk and marks unknown as -1', () => {
    expect([...grid.scores]).toEqual([0, 2, 4, -1, -1, 1])
    expect(hasUnknown(grid)).toBe(true)
  })
  it('interpolates between hours so scrubbing is continuous', () => {
    expect(valuesAt(grid, 0.5)[0]).toBeCloseTo(1)
    expect(valuesAt(grid, 1.25)[0]).toBeCloseTo(2.5)
    expect(valuesAt(grid, 99)[0]).toBe(4) // clamped to the last hour
  })
  it('never averages unknown into a level: it takes the nearer hour', () => {
    const g = buildGrid(heatmap([[-1, 20], [0, 0]]))
    expect(valuesAt(g, 0.25)[0]).toBe(-1)
    expect(valuesAt(g, 0.75)[0]).toBe(2)
  })
})

describe('paintField', () => {
  const block = (v: number) => buildGrid(heatmap(Array.from({ length: 9 }, () => [v * 10, v * 10])))
  it('paints the level colour for a uniform field and fades to transparent outside the data', () => {
    const g = block(2)
    const { rgba, out, r } = centre(g, valuesAt(g, 0))
    expect(rgba.slice(0, 3)).toEqual(hex(LEVEL_STYLES.High.light))
    expect(rgba[3]).toBeGreaterThan(100)
    expect(out[3]).toBe(0) // top-left corner pixel is in the empty margin
    expect(r.width).toBeGreaterThan(0)
  })
  it('draws unknown as grey, never as Low', () => {
    const g = block(0)
    const values = valuesAt(g, 0).fill(-1)
    const { rgba } = centre(g, values)
    expect(rgba.slice(0, 3)).toEqual(hex(LEVEL_STYLES.Unknown.light))
    expect(rgba.slice(0, 3)).not.toEqual(hex(LEVEL_STYLES.Low.light))
  })
  it('keeps the colour of the known cells when a neighbour has no data', () => {
    const g = block(3)
    const values = valuesAt(g, 0)
    values[0] = -1 // one corner cell unknown; the centre pixel stays Severe-dominated
    const { rgba } = centre(g, values)
    expect(rgba[0]).toBeGreaterThan(150) // red channel of Severe, not grey/blue
  })
})

describe('ribbon', () => {
  it('scales with the trip: thin for a short hop, capped for a long one', () => {
    expect(ribbonHalfWidthMi(80)).toBe(6)
    expect(ribbonHalfWidthMi(300)).toBeCloseTo(18)
    expect(ribbonHalfWidthMi(3000)).toBe(28)
  })
  it('keeps the heat near the route and clear of data that is far from every route', () => {
    const g = buildGrid(heatmap(Array.from({ length: 9 }, () => [20, 20])))
    const r = buildRaster(g, ROUTE)
    const out = new Uint8ClampedArray(r.width * r.height * 4)
    paintField(r, valuesAt(g, 0), makeLut('light'), out)
    const alphaAt = (lat: number) => {
      const [west, south, east, north] = r.bounds
      const merc = (v: number) => Math.log(Math.tan(Math.PI / 4 + (v * Math.PI) / 360))
      const row = Math.round(((merc(north) - merc(lat)) / (merc(north) - merc(south))) * r.height)
      return out[(row * r.width + Math.round(((-100 - west) / (east - west)) * r.width)) * 4 + 3]
    }
    expect(alphaAt(40)).toBeGreaterThan(40) // on the route
    expect(alphaAt(40.9)).toBe(0) // data is there (cell at 41), but 60+ miles from the route
  })
})

describe('real Dallas to Denver response', () => {
  const heat = (real as unknown as AnalyzeResponse).heatmap
  it('builds a raster within the pixel cap and paints every hour without NaN', () => {
    const grid = buildGrid(heat)
    const raster = buildRaster(grid, (real as unknown as AnalyzeResponse).routes.map((r) => r.geometry))
    expect(raster.width * raster.height).toBeLessThanOrEqual(512 * 512)
    const out = new Uint8ClampedArray(raster.width * raster.height * 4)
    const lut = makeLut('dark')
    const values = new Float32Array(grid.count)
    for (let h = 0; h <= 48; h += 0.5) paintField(raster, valuesAt(grid, h, values), lut, out)
    expect(out.some((v) => v > 0)).toBe(true)
  })
})
