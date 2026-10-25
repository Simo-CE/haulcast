import { readFileSync } from 'node:fs'
import { expect, type Page, type Route } from '@playwright/test'

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../src/test/fixtures/${name}`, import.meta.url), 'utf8'))
export const abq = () => fixture('analyze-abq-denver-mixed.json')

type Json = Record<string, any>

const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })

/** A style with only a background: deterministic and offline. Tests that need the real basemap pass `realMap`. */
const PLAIN_STYLE = { version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#eef2f6' } }] }

export interface Mocks {
  /** what /api/analyze answers; a function is called per request */
  analyze?: Json | ((n: number) => { status: number; body: unknown })
  realMap?: boolean
  /** suggestions for /api/geocode (default none) */
  places?: { label: string; lat: number; lon: number }[]
  /** status and body for /api/reverse (default: no place found) */
  reverse?: { status: number; body: unknown }
  /** collects every /api request path, so a test can assert none happened */
  apiCalls?: string[]
}

export async function mockApi(page: Page, { analyze, realMap = false, apiCalls = [], places = [], reverse }: Mocks = {}) {
  let analyzeCalls = 0
  await page.route('**/api/geocode*', (route) => json(route, places))
  await page.route('**/api/reverse*', (route) => json(route, reverse?.body ?? { error: 'No place found here' }, reverse?.status ?? 404))
  await page.route('**/api/analyze', (route) => {
    apiCalls.push('/api/analyze')
    analyzeCalls += 1
    if (typeof analyze === 'function') {
      const { status, body } = analyze(analyzeCalls)
      return json(route, body, status)
    }
    return json(route, analyze ?? abq())
  })
  if (!realMap) await page.route('https://tiles.openfreemap.org/**', (route) => json(route, PLAIN_STYLE))
  page.on('request', (r) => {
    const path = new URL(r.url()).pathname
    if (path.startsWith('/api/') && path !== '/api/analyze') apiCalls.push(path)
  })
  return apiCalls
}

export async function runPreset(page: Page, name = 'Denver → Salt Lake City') {
  await page.goto('/')
  await page.getByRole('button', { name }).click()
  await expect(page.getByText('Recommended').first()).toBeVisible()
}

export const replay = async (page: Page) => {
  await page.goto('/')
  await page.getByRole('button', { name: /Replay a real storm/ }).click()
  await expect(page.getByText('Recommended').first()).toBeVisible()
}

/** Painted position of the slider thumb as a fraction of the rail, read from the DOM (what the user sees). */
export const thumbFraction = (page: Page) =>
  page.evaluate(() => {
    const thumb = document.querySelector('.MuiSlider-thumb')!.getBoundingClientRect()
    const rail = document.querySelector('.MuiSlider-rail')!.getBoundingClientRect()
    return (thumb.left + thumb.width / 2 - rail.left) / rail.width
  })

export const hourValue = (page: Page) => page.getByRole('slider', { name: 'Forecast hour' }).evaluate((el) => Number((el as HTMLInputElement).value))

export const setTheme = async (page: Page, dark: boolean) => {
  const toggle = page.getByRole('button', { name: /Switch to (dark|light) theme/ }).first()
  if ((await toggle.getAttribute('aria-label'))?.includes('dark') === dark) await toggle.click()
}
