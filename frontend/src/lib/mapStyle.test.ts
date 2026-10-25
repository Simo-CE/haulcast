import type { StyleSpecification } from 'maplibre-gl'
import { describe, expect, it } from 'vitest'
import { plainStyle, restyle } from './mapStyle'

const line = (id: string, paint: object = {}) => ({ id, type: 'line', source: 'o', 'source-layer': 'transportation', paint }) as never
const base = {
  version: 8,
  sources: { o: { type: 'vector', url: 'x' } },
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': '#fff' } },
    { id: 'water', type: 'fill', source: 'o', 'source-layer': 'water', paint: {} },
    line('road_motorway'),
    line('road_motorway_casing'),
    line('road_trunk_primary', { 'line-dasharray': [2, 2] }),
    line('road_path_pedestrian'),
    line('road_major_rail'),
    { id: 'poi_r20', type: 'symbol', source: 'o', 'source-layer': 'poi' },
    { id: 'building', type: 'fill', source: 'o', 'source-layer': 'building' },
    { id: 'label_city', type: 'symbol', source: 'o', 'source-layer': 'place', paint: {} },
  ],
} as unknown as StyleSpecification

const byId = (s: StyleSpecification, id: string) => s.layers.find((l) => l.id === id) as { paint: Record<string, unknown>; minzoom?: number }

describe('plainStyle', () => {
  it('is a valid style with only a background, so the map is never blank when the basemap fails', () => {
    for (const scheme of ['light', 'dark'] as const) {
      const style = plainStyle(scheme)
      expect(style.layers.map((l) => l.id)).toEqual(['background'])
      expect(Object.keys(style.sources)).toEqual([])
    }
  })
})

describe('restyle', () => {
  it('drops clutter (POIs, buildings, paths, rail) and keeps roads, water and labels', () => {
    const ids = restyle(base, 'dark').layers.map((l) => l.id)
    expect(ids).toEqual(['background', 'water', 'road_motorway', 'road_motorway_casing', 'road_trunk_primary', 'label_city'])
  })

  it('uses the Google-night blue land in dark and a pale land in light', () => {
    expect(byId(restyle(base, 'dark'), 'background').paint['background-color']).toBe('#1f2b3e')
    expect(byId(restyle(base, 'light'), 'background').paint['background-color']).toBe('#eef2f6')
  })

  it('draws motorways in a warm colour with a darker casing, wider and visible from the continent view', () => {
    const dark = restyle(base, 'dark')
    expect(byId(dark, 'road_motorway').paint['line-color']).toBe('#d2a455')
    expect(byId(dark, 'road_motorway_casing').paint['line-color']).toBe('#5c4520')
    expect(byId(dark, 'road_motorway').minzoom).toBe(4)
    expect(JSON.stringify(byId(dark, 'road_motorway').paint['line-width'])).toContain('interpolate')
  })

  it('removes dash patterns from the base road style instead of leaving undefined paint values', () => {
    expect('line-dasharray' in byId(restyle(base, 'light'), 'road_trunk_primary').paint).toBe(false)
  })
})
