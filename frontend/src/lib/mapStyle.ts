import type { LayerSpecification, StyleSpecification } from 'maplibre-gl'
import type { Scheme } from './heatField'

const LIBERTY = 'https://tiles.openfreemap.org/styles/liberty'

interface Palette {
  land: string
  urban: string
  park: string
  wood: string
  water: string
  boundary: string
  /** road fill and casing per class */
  road: Record<RoadClass, [fill: string, casing: string]>
  text: { city: string; town: string; region: string; water: string; road: string; halo: string }
}

type RoadClass = 'motorway' | 'trunk' | 'secondary' | 'minor'

/** Dark follows Google Maps' night theme: blue-grey land, deeper blue water, gold highways. */
const PALETTES: Record<Scheme, Palette> = {
  light: {
    land: '#eef2f6',
    urban: '#e4e9f0',
    park: '#d6e8d2',
    wood: '#cde2c8',
    water: '#b4d2ec',
    boundary: '#9aa9bb',
    road: {
      motorway: ['#f6bd4f', '#cf922a'],
      trunk: ['#fbe0a0', '#dcb455'],
      secondary: ['#ffffff', '#c3ccd8'],
      minor: ['#ffffff', '#dbe1e9'],
    },
    text: { city: '#1b2638', town: '#44536a', region: '#8794a8', water: '#4a79a8', road: '#5b6779', halo: '#ffffff' },
  },
  dark: {
    land: '#1f2b3e',
    urban: '#273449',
    park: '#21393d',
    wood: '#1f3538',
    water: '#122038',
    boundary: '#4d6b88',
    road: {
      motorway: ['#d2a455', '#5c4520'],
      trunk: ['#7f93b0', '#162030'],
      secondary: ['#53647e', '#162030'],
      minor: ['#37465d', '#18222f'],
    },
    text: { city: '#e3ecf8', town: '#aebdd2', region: '#70859f', water: '#5f86b3', road: '#93a6bf', halo: '#18222f' },
  },
}

/** [zoom, px] stops: motorways and trunk roads are drawn from the continent view down so the route's roads read. */
const WIDTHS: Record<RoadClass, [number, number][]> = {
  motorway: [[4, 0.8], [7, 1.8], [10, 3.2], [13, 6.5], [16, 15]],
  trunk: [[5, 0.5], [7, 1.1], [10, 2.3], [13, 5], [16, 12]],
  secondary: [[8, 0.4], [10, 1], [13, 3], [16, 9]],
  minor: [[11, 0.3], [13, 1.2], [16, 5]],
}
const MIN_ZOOM: Record<RoadClass, number> = { motorway: 4, trunk: 5, secondary: 8, minor: 11 }

// everything that is clutter for a truck driver: buildings, POIs, paths, rail, service roads, small land uses
const DROP = /^(building|poi_|road_one_way|natural_earth$|landuse_(pitch|track|cemetery|hospital|school)|aeroway|airport|label_village|highway-name-(path|minor)|.*(path_pedestrian|service_track|rail|transit|area_pattern))/

function roadClass(id: string): RoadClass | null {
  if (!/^(tunnel|bridge|road)_/.test(id)) return null
  if (id.includes('motorway')) return 'motorway'
  if (id.includes('trunk_primary')) return 'trunk'
  if (id.includes('secondary_tertiary')) return 'secondary'
  if (id.includes('minor') || id.includes('street') || id.includes('link')) return 'minor'
  return null
}

const stops = (list: [number, number][], extra = 0, scale = 1): unknown[] =>
  list.flatMap(([z, w]) => [z, w * scale + (z >= 10 ? extra * 2 : extra)])

function restyleLayer(layer: LayerSpecification, p: Palette): LayerSpecification {
  const id = layer.id
  const set = (paint: Record<string, unknown>, layout?: Record<string, unknown>) => {
    const merged = { ...('paint' in layer ? layer.paint : {}), ...paint }
    for (const key of Object.keys(merged)) if (merged[key as keyof typeof merged] === undefined) delete merged[key as keyof typeof merged]
    return { ...layer, paint: merged, ...(layout && { layout: { ...('layout' in layer ? layer.layout : {}), ...layout } }) } as LayerSpecification
  }

  const cls = roadClass(id)
  if (cls) {
    const link = id.includes('link') && cls === 'motorway'
    const casing = id.endsWith('_casing')
    return {
      ...set(
        {
          'line-color': p.road[cls][casing ? 1 : 0],
          'line-width': ['interpolate', ['exponential', 1.4], ['zoom'], ...stops(WIDTHS[cls], casing ? 0.7 : 0, link ? 0.6 : 1)],
          'line-opacity': 1,
          'line-dasharray': undefined,
        },
        { 'line-cap': 'round', 'line-join': 'round' },
      ),
      minzoom: link ? 11 : MIN_ZOOM[cls],
      // the base style's own filters can hide minor classes at low zoom; the class is chosen by the layer id, so no filter edits
    } as LayerSpecification
  }
  if (id === 'background') return set({ 'background-color': p.land })
  if (id === 'water') return set({ 'fill-color': p.water })
  if (id.startsWith('waterway')) return layer.type === 'line' ? set({ 'line-color': p.water }) : set({ 'text-color': p.text.water, 'text-halo-color': p.text.halo })
  if (id === 'landuse_residential') return set({ 'fill-color': p.urban, 'fill-opacity': 0.7 })
  if (id === 'landcover_wood') return set({ 'fill-color': p.wood, 'fill-opacity': 0.8, 'fill-outline-color': p.wood })
  if (id === 'park' || id === 'landcover_grass') return set({ 'fill-color': p.park, 'fill-opacity': 0.7, 'fill-outline-color': p.park })
  if (id === 'park_outline') return set({ 'line-opacity': 0 })
  if (id.startsWith('boundary')) return set({ 'line-color': p.boundary })
  if (layer.type === 'symbol') {
    const t = p.text
    const color = id.startsWith('water') || id.includes('waterway') ? t.water
      : id.startsWith('highway') ? t.road
      : /^label_(city|city_capital)$/.test(id) ? t.city
      : /^label_(state|country)/.test(id) ? t.region
      : t.town
    return set({ 'text-color': color, 'text-halo-color': t.halo, 'text-halo-width': 1.4 })
  }
  return layer
}

/** Liberty's vector layers, recoloured and thinned: land, water and roads for the scheme, no clutter. */
export function restyle(base: StyleSpecification, scheme: Scheme): StyleSpecification {
  const p = PALETTES[scheme]
  const layers = base.layers.filter((l) => !DROP.test(l.id)).map((l) => restyleLayer(l, p))
  return { ...base, layers }
}

let liberty: Promise<StyleSpecification> | undefined
/** The base style, fetched once; a failed fetch is retried on the next call. */
export function loadBaseStyle(): Promise<StyleSpecification> {
  liberty ??= fetch(LIBERTY).then((r) => {
    if (!r.ok) throw new Error(`basemap style ${r.status}`)
    return r.json() as Promise<StyleSpecification>
  })
  liberty.catch(() => (liberty = undefined))
  return liberty
}
