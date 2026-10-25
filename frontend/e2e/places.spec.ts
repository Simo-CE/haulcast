import { expect, type Locator, type Page, test } from '@playwright/test'
import { mockApi } from './helpers'

const DENVER = { label: 'Denver, Colorado', lat: 39.7392, lon: -104.9903 }
const SLC = { label: 'Salt Lake City, Utah', lat: 40.7608, lon: -111.891 }

const choose = async (page: Page, field: 'Origin' | 'Destination', typed: string, label: string) => {
  await page.getByLabel(field, { exact: true }).fill(typed)
  await page.getByRole('option', { name: label }).click()
}
const centre = async (el: Locator) => {
  const box = (await el.boundingBox())!
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}
/** Top edge of whatever covers the map from below: the phone's bottom sheet (or the page bottom on desktop). */
const coverTop = async (page: Page, isMobile: boolean) =>
  isMobile ? (await page.getByRole('button', { name: 'Resize panel' }).boundingBox())!.y : page.viewportSize()!.height

test.describe('markers for chosen places', () => {
  test.beforeEach(async ({ page }) => {
    await mockApi(page, { places: [DENVER, SLC] })
    await page.goto('/')
  })

  test('a chosen place gets a marker that hops in, and the map brings it into view first', async ({ page }) => {
    await expect(page.getByTestId('marker-origin')).toHaveCount(0)
    await choose(page, 'Origin', 'Denv', DENVER.label)
    const marker = page.getByTestId('marker-origin')
    await expect(marker).toHaveCount(1)
    expect(await marker.evaluate((el) => el.getAnimations().length)).toBe(1) // the hop is running (after its delay)
    await expect(marker).toHaveCSS('opacity', '1', { timeout: 3000 })
    const { x, y } = await centre(marker)
    const size = page.viewportSize()!
    expect(x).toBeGreaterThan(0)
    expect(x).toBeLessThan(size.width)
    expect(y).toBeGreaterThan(0)
  })

  test('with reduced motion the marker simply appears', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await choose(page, 'Destination', 'Salt', SLC.label)
    const marker = page.getByTestId('marker-destination')
    await expect(marker).toHaveCSS('opacity', '1')
    expect(await marker.evaluate((el) => el.getAnimations().length)).toBe(0)
  })

  test('two places: both stay in view in different colours, in either order', async ({ page, isMobile }) => {
    for (const order of [['Destination', 'Origin'], ['Origin', 'Destination']] as const) {
      await page.goto('/')
      const picks = { Origin: ['Denv', DENVER.label], Destination: ['Salt', SLC.label] } as const
      for (const field of order) await choose(page, field, picks[field][0], picks[field][1])
      const [origin, destination] = [page.getByTestId('marker-origin'), page.getByTestId('marker-destination')]
      await expect(destination).toHaveCSS('opacity', '1', { timeout: 3000 })
      await expect(origin).toHaveCSS('opacity', '1')
      await page.waitForTimeout(1200) // the fit finishes
      const bottom = await coverTop(page, isMobile)
      const size = page.viewportSize()!
      for (const marker of [origin, destination]) {
        const { x, y } = await centre(marker)
        expect(x).toBeGreaterThan(20)
        expect(x).toBeLessThan(size.width - 20)
        expect(y).toBeGreaterThan(60)
        expect(y).toBeLessThan(bottom)
      }
      const colour = (m: Locator) => m.locator('svg').evaluate((el) => getComputedStyle(el).color)
      expect(await colour(origin)).not.toBe(await colour(destination))
      const [a, b] = [await centre(origin), await centre(destination)]
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(100) // fitted, not stacked on one point
    }
  })
})

test.describe('long press on the map', () => {
  const mapX = (page: Page) => (page.viewportSize()!.width > 700 ? 960 : 187) // middle of the visible map
  const press = async (page: Page, x: number, y: number, ms = 800) => {
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.waitForTimeout(ms)
    await page.mouse.up()
  }
  const field = (page: Page, name: 'Origin' | 'Destination') => page.getByLabel(name, { exact: true })

  test.beforeEach(async ({ page }) => {
    await mockApi(page, { reverse: { status: 200, body: { label: 'Rest area, Wyoming', lat: 0, lon: 0 } } })
    await page.goto('/')
    await expect(page.locator('.maplibregl-canvas')).toBeVisible() // the map has to exist to be pressed
  })

  test('there is no Pick on map button, and the map says how to set a place', async ({ page }) => {
    await expect(page.getByRole('button', { name: /Pick on map/ })).toHaveCount(0)
    await expect(page.getByText('Press and hold on the map to set your origin')).toBeVisible()
  })

  test('the first long press sets the origin, the second the destination, with pin and flag markers', async ({ page }) => {
    const [x1, y1, x2, y2] = [mapX(page) - 150, 330, mapX(page) + 150, 360]
    await press(page, x1, y1)
    await expect(field(page, 'Origin')).toHaveValue('Rest area, Wyoming')
    await expect(field(page, 'Destination')).toHaveValue('')
    const origin = page.getByTestId('marker-origin')
    await expect(origin).toHaveCSS('opacity', '1', { timeout: 500 }) // already on screen: it hops at once
    expect(await origin.locator('[data-testid="PlaceIcon"]').count()).toBe(1) // the pin icon
    const box = (await origin.boundingBox())!
    expect(Math.abs(box.x + box.width / 2 - x1)).toBeLessThan(20)
    expect(Math.abs(box.y + box.height - y1)).toBeLessThan(20) // the tip of the pin is on the pressed spot
    await expect(page.getByText('Press and hold on the map to set your destination')).toBeVisible()

    await press(page, x2, y2)
    await expect(field(page, 'Destination')).toHaveValue('Rest area, Wyoming')
    const destination = page.getByTestId('marker-destination')
    await expect(destination).toHaveCSS('opacity', '1', { timeout: 3000 })
    expect(await destination.locator('[data-testid="FlagIcon"]').count()).toBe(1)
    await expect(page.getByText(/Press and hold on the map/)).toHaveCount(0)
  })

  test('the pressed point, not the map centre, is what gets named', async ({ page }) => {
    const lons: number[] = []
    page.on('request', (r) => r.url().includes('/api/reverse') && lons.push(Number(new URL(r.url()).searchParams.get('lon'))))
    await press(page, mapX(page) - 150, 330)
    await expect.poll(() => lons.length).toBe(1)
    await press(page, mapX(page) + 150, 330)
    await expect.poll(() => lons.length).toBe(2)
    expect(lons[1]).toBeGreaterThan(lons[0] + 3) // right of the first press on a continent-wide map
  })

  test('a quick click, a drag and a zoom set nothing', async ({ page }) => {
    const [x, y] = [mapX(page), 330]
    await page.mouse.click(x, y)
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.waitForTimeout(300)
    await page.mouse.move(x - 120, y + 30, { steps: 8 }) // dragging before the delay cancels the press
    await page.waitForTimeout(700)
    await page.mouse.up()
    await expect(field(page, 'Origin')).toHaveValue('')
    await expect(page.getByTestId('marker-origin')).toHaveCount(0)
  })

  test('the place is kept when the name lookup fails', async ({ page }) => {
    await page.route('**/api/reverse*', (route) => route.fulfill({ status: 502, json: { error: 'down' } }))
    await press(page, mapX(page), 330)
    await expect(field(page, 'Origin')).toHaveValue(/^Pinned location \(\d+\.\d+, -?\d+\.\d+\)$/)
    await expect(page.getByTestId('marker-origin')).toHaveCount(1)
  })

  test('a third long press replaces the destination; both places stay in view and can be analysed', async ({ page, isMobile }) => {
    const lats: number[] = []
    page.on('request', (r) => r.url().includes('/api/reverse') && lats.push(Number(new URL(r.url()).searchParams.get('lat'))))
    await press(page, mapX(page) - 120, 330)
    await press(page, mapX(page) + 120, 400)
    await expect.poll(() => lats.length).toBe(2)
    await page.waitForTimeout(1300) // the fit settles before the third press
    await press(page, mapX(page) + 60, 250)
    await expect.poll(() => lats.length).toBe(3) // it looked up a new place...
    await expect(page.getByTestId('marker-destination')).toHaveCount(1) // ...and replaced the destination
    await expect(page.getByTestId('marker-origin')).toHaveCount(1)
    await page.waitForTimeout(1300)
    const cover = isMobile ? (await page.getByRole('button', { name: 'Resize panel' }).boundingBox())!.y : page.viewportSize()!.height
    for (const kind of ['origin', 'destination']) {
      const box = (await page.getByTestId(`marker-${kind}`).boundingBox())!
      expect(box.x).toBeGreaterThan(0)
      expect(box.y).toBeGreaterThan(60)
      expect(box.y + box.height).toBeLessThan(cover)
    }
    await page.getByRole('button', { name: 'Find the safest route' }).click()
    await expect(page.getByText('Recommended').first()).toBeVisible()
  })
})
