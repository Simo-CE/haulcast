import { expect, test } from '@playwright/test'
import { hourValue, mockApi, replay, thumbFraction } from './helpers'

test.describe('Replay a real storm (real backend, no mocks)', () => {
  test.beforeEach(async ({ page }) => {
    await mockApi(page)
  })

  test('is labelled a replay and shows Severe and No Travel through the normal UI', async ({ page }) => {
    await replay(page)
    await expect(page.getByText('Replay: Wyoming wind storm, December 9, 2025')).toBeVisible()
    await expect(page.getByText('Replay', { exact: true }).first()).toBeVisible() // chip beside the clock
    await expect(page.getByText('Route A has 75 mi of No Travel weather.')).toBeVisible()
    await expect(page.getByText('75 mi Severe').first()).toBeVisible()
    await expect(page.getByText('Take Route B')).toBeVisible() // the safer route, not the fastest
    await expect(page.locator('.maplibregl-canvas')).toBeVisible()
  })

  test('scrubbing and a full playback make zero API requests', async ({ page }) => {
    await replay(page)
    const calls: string[] = []
    page.on('request', (r) => new URL(r.url()).pathname.startsWith('/api/') && calls.push(r.url()))
    const slider = page.getByRole('slider', { name: 'Forecast hour' })
    await slider.focus()
    for (let i = 0; i < 20; i++) await slider.press('ArrowRight')
    await slider.press('End')
    await expect.poll(() => hourValue(page)).toBe(48)
    await page.getByRole('button', { name: 'Play forecast' }).click() // from the end: restarts at 0 and plays to 48
    await page.getByRole('button', { name: 'Pause forecast playback' }).click()
    await page.getByRole('button', { name: 'Play forecast' }).click()
    await expect(page.getByRole('button', { name: 'Play forecast' })).toBeVisible({ timeout: 25_000 }) // finished by itself
    expect(calls).toEqual([])
  })

  test('the thumb follows the clock during playback and restarts from 0 on replay', async ({ page }) => {
    await replay(page)
    await page.getByRole('slider', { name: 'Forecast hour' }).focus()
    await page.keyboard.press('End')
    await expect.poll(() => thumbFraction(page)).toBeGreaterThan(0.98)

    await page.getByRole('button', { name: 'Play forecast' }).click()
    await expect.poll(() => hourValue(page), { timeout: 2000 }).toBeLessThan(10) // restarted near 0, not at 48
    const seen: number[] = []
    for (let i = 0; i < 4; i++) {
      await page.waitForTimeout(700)
      const [frac, hour] = [await thumbFraction(page), await hourValue(page)]
      expect(Math.abs(frac - hour / 48)).toBeLessThan(0.03) // painted where the clock says (a CSS transition once froze it)
      seen.push(frac)
    }
    expect(seen).toEqual([...seen].sort((a, b) => a - b))
    expect(seen[3] - seen[0]).toBeGreaterThan(0.05)
  })

  test('the truck dims once the route has arrived', async ({ page }) => {
    await replay(page)
    const truck = page.getByTestId('truck')
    await expect(truck).toHaveCSS('opacity', '1')
    await page.getByRole('slider', { name: 'Forecast hour' }).focus()
    await page.keyboard.press('End')
    await expect(truck).toHaveCSS('opacity', '0.55')
  })
})
