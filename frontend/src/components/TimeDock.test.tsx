import { cleanup, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import real from '../test/fixtures/analyze-dallas-denver.json'
import { renderWithTheme } from '../test/render'
import type { AnalyzeResponse } from '../types/api'
import { TimeDock } from './TimeDock'
import { TimelineProvider } from './TimelineProvider'

const heatmap = (real as unknown as AnalyzeResponse).heatmap

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', () => 0)
  vi.stubGlobal('cancelAnimationFrame', () => {})
})
afterEach(() => vi.unstubAllGlobals())

const view = (data = heatmap) =>
  renderWithTheme(
    <TimelineProvider max={data.hours - 1} resetKey="a">
      <TimeDock heatmap={data} variant="floating" />
    </TimelineProvider>,
  )

describe('TimeDock', () => {
  it('labels the slider +Nh with the clock time, and steps with the keyboard', async () => {
    view()
    const slider = screen.getByRole('slider', { name: 'Forecast hour' })
    expect(slider).toHaveAttribute('aria-valuemin', '0')
    expect(slider).toHaveAttribute('aria-valuemax', '48')
    expect(slider.getAttribute('aria-valuetext')).toMatch(/^\+0h, /)
    slider.focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(slider.getAttribute('aria-valuetext')).toMatch(/^\+0h 15m, /)
    await userEvent.keyboard('{End}')
    expect(slider.getAttribute('aria-valuetext')).toMatch(/^\+48h, /)
    expect(screen.getByText('+48h')).toBeInTheDocument()
  })

  it('toggles play/pause and the heatmap with their state exposed', async () => {
    view()
    await userEvent.click(screen.getByRole('button', { name: 'Play forecast' }))
    expect(screen.getByRole('button', { name: 'Pause forecast playback' })).toBeInTheDocument()
    const toggle = screen.getByRole('button', { name: 'Show weather heatmap' })
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('img', { name: /Heatmap colours from Low to No Travel/ })).toBeInTheDocument()
    await userEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByRole('img', { name: /Heatmap colours/ })).not.toBeInTheDocument()
  })

  it('says "No data" in the key only when some forecast is missing', () => {
    view()
    expect(screen.queryByText('No data')).not.toBeInTheDocument()
    cleanup()
    const gap = { ...heatmap, points: heatmap.points.map((p, i) => (i === 0 ? { ...p, scores: p.scores.map(() => -1) } : p)) }
    view(gap)
    expect(screen.getByText('No data')).toBeInTheDocument()
  })
})
