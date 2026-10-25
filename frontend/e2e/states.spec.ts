import { expect, test } from '@playwright/test'
import { abq, mockApi, runPreset } from './helpers'

test.describe('banners', () => {
  test('No Travel on every route is an error banner that names the recommended route', async ({ page }) => {
    const data = abq()
    for (const route of data.routes) route.milesByLevel['No Travel'] = 30
    await mockApi(page, { analyze: data })
    await runPreset(page)
    const best = data.routes.find((r: { id: string }) => r.id === data.recommendedRouteId)
    await expect(page.getByText('No Travel conditions on every route')).toBeVisible()
    await expect(page.getByText(new RegExp(`Even the best option, ${best.name}, has 30 mi of No Travel`))).toBeVisible()
  })

  test('No Travel on some routes is a warning that lists them', async ({ page }) => {
    const data = abq()
    const other = data.routes.find((r: { id: string }) => r.id !== data.recommendedRouteId)
    other.milesByLevel['No Travel'] = 55
    await mockApi(page, { analyze: data })
    await runPreset(page)
    await expect(page.getByText(`${other.name} has 55 mi of No Travel weather`)).toBeVisible()
    await expect(page.getByText('No Travel conditions on every route')).toHaveCount(0)
  })

  test('Severe miles show in the route card, with the text label and not by colour alone', async ({ page }) => {
    const data = abq()
    data.routes[0].milesByLevel.Severe = 42
    await mockApi(page, { analyze: data })
    await runPreset(page)
    await expect(page.getByText('42 mi Severe')).toBeVisible()
  })

  test('missing forecast data is Unknown, never Low', async ({ page }) => {
    const data = abq()
    data.routes[0].unknownMi = 40
    data.routes[0].checkpoints[3].level = null
    data.routes[0].checkpoints[3].levelLabel = 'Unknown'
    await mockApi(page, { analyze: data })
    await runPreset(page)
    await expect(page.getByText('Forecast data is missing for part of this trip. Those miles are shown as Unknown, not Low.')).toBeVisible()
    await expect(page.getByRole('list', { name: 'Checkpoint risk levels' }).getByText('Unknown')).toBeVisible()
  })
})

test.describe('errors', () => {
  test('a 400 is shown on the form field and keeps the form', async ({ page }) => {
    await mockApi(page, { analyze: () => ({ status: 400, body: { destination: ['Origin and destination are the same place.'] } }) })
    await page.goto('/')
    await page.getByRole('button', { name: 'Denver → Salt Lake City' }).click()
    await expect(page.locator('#destination-helper-text')).toHaveText('Origin and destination are the same place.')
    await expect(page.getByRole('button', { name: 'Retry' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Find the safest route' })).toBeEnabled()
  })

  test('a 502 says a provider failed and Retry runs the same request again', async ({ page }) => {
    const bodies: unknown[] = []
    page.on('request', (r) => r.url().endsWith('/api/analyze') && bodies.push(r.postDataJSON()))
    await mockApi(page, {
      analyze: (n) => (n === 1 ? { status: 502, body: { error: 'TomTom returned HTTP 503' } } : { status: 200, body: abq() }),
    })
    await page.goto('/')
    await page.getByRole('button', { name: 'Denver → Salt Lake City' }).click()
    await expect(page.getByText(/A data provider is not responding \(TomTom returned HTTP 503\)/)).toBeVisible()
    await page.getByRole('button', { name: 'Retry' }).click()
    await expect(page.getByText('Recommended').first()).toBeVisible()
    expect(bodies).toHaveLength(2)
    expect(bodies[1]).toEqual(bodies[0])
  })

  test('no route (ocean) and an unexpected 500 give plain messages without a trace', async ({ page }) => {
    await mockApi(page, {
      analyze: (n) =>
        n === 1
          ? { status: 502, body: { error: 'TomTom returned HTTP 400 (NO_ROUTE_FOUND)' } }
          : { status: 500, body: { error: 'Unexpected server error' } },
    })
    await page.goto('/')
    await page.getByRole('button', { name: 'Denver → Salt Lake City' }).click()
    await expect(page.getByText('No truck route could be found between these two places.')).toBeVisible()
    await page.getByRole('button', { name: 'Retry' }).click()
    await expect(page.getByText('The server hit an unexpected error. Try again in a moment.')).toBeVisible()
    await expect(page.getByText(/Traceback|NO_ROUTE|Unexpected server error/)).toHaveCount(0)
  })

  test('the network being down says so', async ({ page }) => {
    await mockApi(page)
    await page.route('**/api/analyze', (route) => route.abort())
    await page.goto('/')
    await page.getByRole('button', { name: 'Denver → Salt Lake City' }).click()
    await expect(page.getByText('Could not reach the server. Check your connection and try again.')).toBeVisible()
  })
})

test.describe('form validation (no request is sent)', () => {
  test.beforeEach(async ({ page }) => {
    await mockApi(page)
    await page.goto('/')
    await page.getByLabel('Origin', { exact: true }).fill('Denver')
    await page.getByLabel('Destination', { exact: true }).fill('Salt Lake City')
    const options = page.getByRole('button', { name: /every \d+ mi/ })
    if (await options.count()) await options.click() // phone: options sit behind a summary line
  })
  const submit = (page: import('@playwright/test').Page) => page.getByRole('button', { name: 'Find the safest route' }).click()

  test('load 0', async ({ page }) => {
    const calls: string[] = []
    page.on('request', (r) => r.url().endsWith('/api/analyze') && calls.push(r.url()))
    await page.getByLabel('Load').fill('0')
    await submit(page)
    await expect(page.getByText('Load must be above 0 lb.')).toBeVisible()
    expect(calls).toEqual([])
  })

  test('past departure', async ({ page }) => {
    await page.getByLabel('Departure (your local time)').fill('2020-01-01T08:00')
    await submit(page)
    await expect(page.getByText('Departure is in the past.')).toBeVisible()
  })

  test('same origin and destination', async ({ page }) => {
    await page.getByLabel('Destination', { exact: true }).fill('denver')
    await submit(page)
    await expect(page.getByText('Pick a destination different from the origin.')).toBeVisible()
  })
})

test.describe('basemap', () => {
  test('a failed style fetch shows a plain map and a notice instead of a blank map, and Retry recovers', async ({ page }) => {
    await mockApi(page, { realMap: true })
    let blocked = true
    await page.route('https://tiles.openfreemap.org/**', (route) => {
      if (!blocked) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#eef2f6' } }] }) })
      return route.abort()
    })
    await runPreset(page)
    await expect(page.getByText(/The street map could not be loaded/)).toBeVisible()
    await expect(page.locator('.maplibregl-canvas')).toBeVisible()
    await expect(page.getByTestId('truck')).toBeVisible() // routes, markers and heat still draw
    blocked = false
    await page.getByRole('button', { name: 'Retry' }).click()
    await expect(page.getByText(/The street map could not be loaded/)).toHaveCount(0)
  })
})

test('phone: the bottom sheet follows a drag and snaps', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'bottom sheet is the phone layout')
  await mockApi(page)
  await runPreset(page)
  const handle = page.getByRole('button', { name: 'Resize panel' })
  const top = async () => (await handle.boundingBox())!.y
  const start = await top()
  const box = (await handle.boundingBox())!
  const x = box.x + box.width / 2
  await page.mouse.move(x, box.y + 8)
  await page.mouse.down()
  await page.mouse.move(x, box.y - 150, { steps: 6 })
  await page.mouse.move(x, box.y - 300, { steps: 6 })
  await page.mouse.up()
  await expect.poll(top).toBeLessThan(start - 100) // snapped higher
  const raised = await top()
  const b2 = (await handle.boundingBox())!
  await page.mouse.move(x, b2.y + 8)
  await page.mouse.down()
  await page.mouse.move(x, b2.y + 400, { steps: 12 })
  await page.mouse.up()
  await expect.poll(top).toBeGreaterThan(raised + 100) // and back down
  await handle.focus()
  await page.keyboard.press('ArrowUp')
  await expect.poll(top).toBeLessThan((await top()) + 1)
})
