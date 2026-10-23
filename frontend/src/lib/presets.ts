import type { Place } from '../types/api'

export interface Preset {
  name: string
  origin: Place
  destination: Place
  loadLb: number
}

// Coordinates are sent as-is, so a preset never needs geocoding. Dallas-Denver and Chicago-Milwaukee
// return two routes (complete=false), which shows that state.
export const PRESETS: Preset[] = [
  {
    name: 'Denver → Salt Lake City',
    origin: { label: 'Denver, Colorado', lat: 39.7392, lon: -104.9903 },
    destination: { label: 'Salt Lake City, Utah', lat: 40.7608, lon: -111.891 },
    loadLb: 42_000,
  },
  {
    name: 'Dallas → Denver',
    origin: { label: 'Dallas, Texas', lat: 32.7767, lon: -96.797 },
    destination: { label: 'Denver, Colorado', lat: 39.7392, lon: -104.9903 },
    loadLb: 42_000,
  },
  {
    name: 'Chicago → Milwaukee',
    origin: { label: 'Chicago, Illinois', lat: 41.8781, lon: -87.6298 },
    destination: { label: 'Milwaukee, Wisconsin', lat: 43.0389, lon: -87.9065 },
    loadLb: 30_000,
  },
  {
    name: 'Seattle → Spokane',
    origin: { label: 'Seattle, Washington', lat: 47.6062, lon: -122.3321 },
    destination: { label: 'Spokane, Washington', lat: 47.6588, lon: -117.426 },
    loadLb: 40_000,
  },
]
