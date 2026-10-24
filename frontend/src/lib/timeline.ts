import type { Route } from '../types/api'
import { formatClock } from './format'

/** "+12h", or "+12h 15m" between whole hours. */
export function formatOffset(hour: number): string {
  const total = Math.round(hour * 60)
  const h = Math.floor(total / 60)
  const m = total % 60
  return m === 0 ? `+${h}h` : `+${h}h ${m}m`
}

/** Browser-local clock time of the slider position, e.g. "Sat 8:15 PM". */
export function clockAt(startTime: string, hour: number): string {
  return formatClock(new Date(Date.parse(startTime) + hour * 3_600_000).toISOString())
}

export const ariaTimeText = (startTime: string, hour: number): string =>
  `${formatOffset(hour)}, ${clockAt(startTime, hour)}`

const R_MI = 3958.8
const rad = Math.PI / 180

function haversine([lon1, lat1]: [number, number], [lon2, lat2]: [number, number]): number {
  const a = Math.sin(((lat2 - lat1) * rad) / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lon2 - lon1) * rad) / 2) ** 2
  return 2 * R_MI * Math.asin(Math.sqrt(a))
}

/** Cumulative miles along a polyline, so a mile position can be turned back into a point. */
export function pathLengths(geometry: [number, number][]): Float64Array {
  const cum = new Float64Array(geometry.length)
  for (let i = 1; i < geometry.length; i++) cum[i] = cum[i - 1] + haversine(geometry[i - 1], geometry[i])
  return cum
}

/** Route mile reached at `hour` after the heatmap start: linear between checkpoint ETAs, clamped to the trip. */
export function mileAt(route: Route, startTime: string, hour: number): number {
  const t = Date.parse(startTime) + hour * 3_600_000
  const cps = route.checkpoints
  if (cps.length === 0 || t <= Date.parse(cps[0].eta)) return 0
  for (let i = 1; i < cps.length; i++) {
    const t1 = Date.parse(cps[i].eta)
    if (t <= t1) {
      const t0 = Date.parse(cps[i - 1].eta)
      const f = t1 === t0 ? 1 : (t - t0) / (t1 - t0)
      return cps[i - 1].mile + (cps[i].mile - cps[i - 1].mile) * f
    }
  }
  return cps[cps.length - 1].mile
}

/** [lon, lat] of the truck: the route mile mapped onto the geometry (their lengths agree within rounding). */
export function truckPosition(route: Route, cum: Float64Array, startTime: string, hour: number): [number, number] {
  const geometry = route.geometry
  const lastMile = route.checkpoints[route.checkpoints.length - 1]?.mile || route.distanceMi
  const target = Math.min(1, mileAt(route, startTime, hour) / lastMile) * cum[cum.length - 1]
  let i = 1
  while (i < cum.length - 1 && cum[i] < target) i++
  const span = cum[i] - cum[i - 1]
  const f = span === 0 ? 0 : (target - cum[i - 1]) / span
  const [a, b] = [geometry[i - 1], geometry[i]]
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]
}

/** Hours after the heatmap start at which the route's last checkpoint is reached (fractional). */
export function arrivalHour(route: Route, startTime: string): number {
  const last = route.checkpoints[route.checkpoints.length - 1]
  return last ? (Date.parse(last.eta) - Date.parse(startTime)) / 3_600_000 : 0
}
