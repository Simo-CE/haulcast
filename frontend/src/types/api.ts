/** Shapes of the Django API (README section 3). Times are ISO 8601 UTC, distances miles. */

export type Level = 0 | 1 | 2 | 3 | 4
export type LevelLabel = 'Low' | 'Moderate' | 'High' | 'Severe' | 'No Travel'

export interface Place {
  label: string
  lat: number
  lon: number
}

export interface Checkpoint {
  mile: number
  lat: number
  lon: number
  eta: string
  windMph: number | null
  gustMph: number | null
  rainInHr: number | null
  snowInHr: number | null
  /** null = no usable weather: shown as "Unknown", never as Low */
  level: Level | null
  levelLabel: LevelLabel | 'Unknown'
  reason: string
}

export interface Route {
  id: string
  name: string
  distanceMi: number
  durationMin: number
  milesByLevel: Record<LevelLabel, number>
  unknownMi: number
  /** 0-4, null when there is no weather at all */
  avgRisk: number | null
  /** [lon, lat] pairs */
  geometry: [number, number][]
  checkpoints: Checkpoint[]
}

export interface Ranking {
  routeId: string
  rank: number
  reason: string
}

export interface Heatmap {
  startTime: string
  hours: number
  stepDeg: number
  scoreScale: number
  unknownScore: number
  points: { lat: number; lon: number; scores: number[] }[]
}

export interface AnalyzeResponse {
  origin: Place
  destination: Place
  departure: string
  loadLb: number
  spacingMi: number
  routes: Route[]
  recommendedRouteId: string
  ranking: Ranking[]
  heatmap: Heatmap
  warnings: string[]
  complete: boolean
  timingsMs: Record<string, number>
}

export type PlaceInput = string | Place

export interface AnalyzeRequest {
  origin: PlaceInput
  destination: PlaceInput
  departure: string
  loadLb: number
  spacingMi: 10 | 25 | 50
}
