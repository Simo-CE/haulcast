import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { mockApi, replay, setTheme } from './helpers'

const scan = async (page: Page) => (await new AxeBuilder({ page }).analyze()).violations

for (const dark of [false, true]) {
  test.describe(`axe, ${dark ? 'dark' : 'light'}`, () => {
    test('empty state and results have 0 violations', async ({ page }) => {
      await mockApi(page)
      await page.goto('/')
      await setTheme(page, dark)
      expect(await scan(page)).toEqual([])
      await replay(page)
      await page.waitForTimeout(500)
      expect(await scan(page)).toEqual([])
      await page.getByRole('button', { name: /checkpoints, hour by hour/ }).first().click() // the table twin of the map
      expect(await scan(page)).toEqual([])
    })

    test('place markers and the long-press hint have 0 violations', async ({ page }) => {
      await mockApi(page, { places: [{ label: 'Denver, Colorado', lat: 39.7392, lon: -104.9903 }] })
      await page.goto('/')
      await setTheme(page, dark)
      await page.getByLabel('Origin', { exact: true }).fill('Denv')
      await page.getByRole('option', { name: 'Denver, Colorado' }).click()
      await expect(page.getByTestId('marker-origin')).toHaveCSS('opacity', '1', { timeout: 3000 })
      expect(await scan(page)).toEqual([])
      await expect(page.getByText('Press and hold on the map to set your destination')).toBeVisible()
      expect(await scan(page)).toEqual([])
    })
  })
}

/** Mean luminance (0-1) of a PNG, and the share of pixels that differ clearly between two PNGs, computed in the page. */
const analyse = (page: Page, a: Buffer, b: Buffer) =>
  page.evaluate(
    async ([x, y]) => {
      const load = async (b64: string) => {
        const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob())
        const c = new OffscreenCanvas(bmp.width, bmp.height).getContext('2d')!
        c.drawImage(bmp, 0, 0)
        return c.getImageData(0, 0, bmp.width, bmp.height).data
      }
      const [p, q] = [await load(x), await load(y)]
      let lum = 0
      let changed = 0
      for (let i = 0; i < p.length; i += 4) {
        lum += (0.2126 * p[i] + 0.7152 * p[i + 1] + 0.0722 * p[i + 2]) / 255
        if (Math.abs(p[i] - q[i]) + Math.abs(p[i + 1] - q[i + 1]) + Math.abs(p[i + 2] - q[i + 2]) > 60) changed++
      }
      return { meanLuminance: lum / (p.length / 4), changedShare: changed / (p.length / 4) }
    },
    [a.toString('base64'), b.toString('base64')],
  )

test('dark mode: the real basemap is dark and the heat stays visible on it', async ({ page }, info) => {
  test.skip(info.project.name === 'phone', 'the dock covers the map on phones; measured on desktop')
  const reachable = await fetch('https://tiles.openfreemap.org/styles/liberty').then((r) => r.ok, () => false)
  test.skip(!reachable, 'needs the live OpenFreeMap style')
  await mockApi(page, { realMap: true })
  await page.goto('/')
  await setTheme(page, true)
  await replay(page)
  const slider = page.getByRole('slider', { name: 'Forecast hour' })
  await slider.focus()
  for (let i = 0; i < 8; i++) await slider.press('ArrowRight') // +2 h: the wind is building over Colorado and Wyoming
  const map = page.getByRole('region', { name: 'Route map' })
  await expect(page.locator('.maplibregl-canvas')).toBeVisible()
  await page.waitForTimeout(3000) // real tiles
  const clip = { x: 640, y: 90, width: 790, height: 560 } // map area above the time dock
  const withHeat = await page.screenshot({ clip })
  await page.getByRole('button', { name: 'Show weather heatmap' }).click()
  await page.waitForTimeout(500)
  const withoutHeat = await page.screenshot({ clip })
  await info.attach('dark-heat-on.png', { body: withHeat, contentType: 'image/png' })
  await info.attach('dark-heat-off.png', { body: withoutHeat, contentType: 'image/png' })
  const { meanLuminance, changedShare } = await analyse(page, withHeat, withoutHeat)
  await expect(map).toBeVisible()
  expect(meanLuminance).toBeLessThan(0.35) // a dark map, not a washed-out one
  expect(changedShare).toBeGreaterThan(0.03) // the heat clearly changes the picture
})
