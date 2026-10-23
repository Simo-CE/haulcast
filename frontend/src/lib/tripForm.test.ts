import { describe, expect, it } from 'vitest'
import { defaultDeparture, toLocalInput, type TripFormValues, validateTrip } from './tripForm'

const NOW = new Date('2026-11-03T12:00:00')
const denver = { label: 'Denver', lat: 39.74, lon: -104.99 }
const slc = { label: 'Salt Lake City', lat: 40.76, lon: -111.89 }

const valid = (patch: Partial<TripFormValues> = {}): TripFormValues => ({
  origin: denver,
  destination: slc,
  departure: toLocalInput(new Date(NOW.getTime() + 3_600_000)),
  loadLb: '42,000',
  spacingMi: 25,
  ...patch,
})

describe('validateTrip', () => {
  it('builds the API request, sending picked places as coordinates and the departure as UTC', () => {
    const { errors, request } = validateTrip(valid(), NOW)
    expect(errors).toEqual({})
    expect(request).toEqual({
      origin: denver,
      destination: slc,
      departure: new Date('2026-11-03T13:00:00').toISOString(),
      loadLb: 42000,
      spacingMi: 25,
    })
  })

  it('passes typed text through trimmed so the backend geocodes it', () => {
    const { request } = validateTrip(valid({ origin: '  Dallas, TX ' }), NOW)
    expect(request?.origin).toBe('Dallas, TX')
  })

  it.each([
    [{ origin: null }, 'origin', 'Choose a place.'],
    [{ destination: 'ab' }, 'destination', 'Type at least 3 characters.'],
    [{ destination: denver }, 'destination', 'Pick a destination different from the origin.'],
    [{ departure: '' }, 'departure', 'Choose a departure date and time.'],
    [{ loadLb: '' }, 'loadLb', 'Enter the load in pounds.'],
    [{ loadLb: 'heavy' }, 'loadLb', 'Enter the load in pounds.'],
    [{ loadLb: '0' }, 'loadLb', 'Load must be above 0 lb.'],
    [{ loadLb: '-5' }, 'loadLb', 'Load must be above 0 lb.'],
    [{ loadLb: '100001' }, 'loadLb', 'Load can be at most 100,000 lb.'],
  ] as const)('rejects %j', (patch, field, message) => {
    const { errors, request } = validateTrip(valid(patch), NOW)
    expect(errors[field]).toBe(message)
    expect(request).toBeUndefined()
  })

  it('accepts the load limit and a departure inside the 5 minute grace, rejects beyond', () => {
    expect(validateTrip(valid({ loadLb: '100000' }), NOW).request).toBeDefined()
    expect(validateTrip(valid({ departure: '2026-11-03T11:57' }), NOW).request).toBeDefined()
    expect(validateTrip(valid({ departure: '2026-11-03T11:50' }), NOW).errors.departure).toBe('Departure is in the past.')
  })

  it('limits departure to 7 days ahead', () => {
    expect(validateTrip(valid({ departure: '2026-11-10T11:59' }), NOW).request).toBeDefined()
    expect(validateTrip(valid({ departure: '2026-11-10T12:30' }), NOW).errors.departure).toBe('Forecasts cover the next 7 days.')
  })

  it('reports every problem at once', () => {
    const { errors } = validateTrip(valid({ origin: null, destination: null, loadLb: '0' }), NOW)
    expect(Object.keys(errors).sort()).toEqual(['destination', 'loadLb', 'origin'])
  })
})

describe('defaultDeparture', () => {
  it('rounds up to the next quarter hour and is never in the past', () => {
    const now = new Date('2026-11-03T12:01:00')
    expect(defaultDeparture(now)).toBe('2026-11-03T12:15')
    expect(new Date(defaultDeparture(now)).getTime()).toBeGreaterThanOrEqual(now.getTime())
  })
})
