import type { AnalyzeRequest, PlaceInput } from '../types/api'

export type Spacing = 10 | 25 | 50
export const SPACINGS: Spacing[] = [10, 25, 50]
export const MAX_LOAD_LB = 100_000
export const MIN_ADDRESS_CHARS = 3 // matches the backend's MIN_CHARS
const PAST_GRACE_MS = 5 * 60_000
const MAX_LEAD_MS = 7 * 24 * 3_600_000

export interface TripFormValues {
  origin: PlaceInput | null
  destination: PlaceInput | null
  /** value of <input type="datetime-local">, in the browser's local time */
  departure: string
  loadLb: string
  spacingMi: Spacing
}

export type FormErrors = Partial<Record<'origin' | 'destination' | 'departure' | 'loadLb', string>>

const pad = (n: number): string => String(n).padStart(2, '0')

/** Local "YYYY-MM-DDTHH:mm", the format datetime-local reads and writes. */
export function toLocalInput(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** Now rounded up to the next quarter hour, so "depart soon" is never in the past by submit time. */
export function defaultDeparture(now: Date = new Date()): string {
  const next = new Date(Math.ceil(now.getTime() / 900_000) * 900_000)
  return toLocalInput(next)
}

export const initialValues = (): TripFormValues => ({
  origin: null,
  destination: null,
  departure: defaultDeparture(),
  loadLb: '42000',
  spacingMi: 25,
})

export function isPast(departure: string, now: Date = new Date()): boolean {
  return !(new Date(departure).getTime() > now.getTime())
}

function placeText(value: PlaceInput | null): string {
  return value === null ? '' : typeof value === 'string' ? value.trim() : value.label
}

function checkPlace(value: PlaceInput | null): string | undefined {
  if (value === null || placeText(value) === '') return 'Choose a place.'
  if (typeof value === 'string' && value.trim().length < MIN_ADDRESS_CHARS) {
    return `Type at least ${MIN_ADDRESS_CHARS} characters.`
  }
  return undefined
}

function sameSpot(a: PlaceInput, b: PlaceInput): boolean {
  if (typeof a === 'string' || typeof b === 'string') return placeText(a).toLowerCase() === placeText(b).toLowerCase()
  return Math.abs(a.lat - b.lat) < 1e-4 && Math.abs(a.lon - b.lon) < 1e-4
}

export function validateTrip(
  values: TripFormValues,
  now: Date = new Date(),
): { errors: FormErrors; request?: AnalyzeRequest } {
  const errors: FormErrors = {}
  errors.origin = checkPlace(values.origin)
  errors.destination = checkPlace(values.destination)
  if (!errors.origin && !errors.destination && sameSpot(values.origin!, values.destination!)) {
    errors.destination = 'Pick a destination different from the origin.'
  }

  const departure = new Date(values.departure)
  if (Number.isNaN(departure.getTime())) {
    errors.departure = 'Choose a departure date and time.'
  } else if (departure.getTime() < now.getTime() - PAST_GRACE_MS) {
    errors.departure = 'Departure is in the past.'
  } else if (departure.getTime() > now.getTime() + MAX_LEAD_MS) {
    errors.departure = 'Forecasts cover the next 7 days.'
  }

  const load = Number(values.loadLb.replace(/,/g, ''))
  if (values.loadLb.trim() === '' || !Number.isFinite(load)) {
    errors.loadLb = 'Enter the load in pounds.'
  } else if (load <= 0) {
    errors.loadLb = 'Load must be above 0 lb.'
  } else if (load > MAX_LOAD_LB) {
    errors.loadLb = `Load can be at most ${MAX_LOAD_LB.toLocaleString('en-US')} lb.`
  }

  const clean = Object.fromEntries(Object.entries(errors).filter(([, v]) => v)) as FormErrors
  if (Object.keys(clean).length > 0) return { errors: clean }
  return {
    errors: clean,
    request: {
      origin: typeof values.origin === 'string' ? values.origin.trim() : values.origin!,
      destination: typeof values.destination === 'string' ? values.destination.trim() : values.destination!,
      departure: departure.toISOString(),
      loadLb: load,
      spacingMi: values.spacingMi,
    },
  }
}
