import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client'
import two from '../test/fixtures/analyze-2-routes.json'
import three from '../test/fixtures/analyze-3-routes.json'
import { stageText } from '../lib/stageText'
import { renderWithTheme } from '../test/render'
import type { AnalyzeResponse } from '../types/api'
import { ResultsView } from './ResultsView'

const handlers = { onRetry: vi.fn(), onSelect: vi.fn(), onHover: vi.fn(), onActivate: vi.fn() }
const view = (props: Partial<Parameters<typeof ResultsView>[0]>) =>
  renderWithTheme(
    <ResultsView pending={false} error={null} result={null} selectedId={null} active={null} {...handlers} {...props} />,
  )

describe('ResultsView', () => {
  it('shows the empty state before any analysis', () => {
    view({})
    expect(screen.getByText('Plan around the weather, not through it.')).toBeInTheDocument()
  })

  it('shows progress text while pending', () => {
    view({ pending: true })
    expect(screen.getByRole('status')).toHaveTextContent('Finding truck routes')
  })

  it('shows three ranked cards with a single Recommended badge and the ranking reason', () => {
    const result = three as unknown as AnalyzeResponse
    view({ result, selectedId: result.recommendedRouteId })
    expect(screen.getAllByRole('button', { name: /^Route [A-C]/ })).toHaveLength(3)
    // once in the verdict, once as the badge on the recommended card
    expect(screen.getAllByText('Recommended')).toHaveLength(2)
    expect(screen.getByText('Take Route A')).toBeInTheDocument()
    expect(screen.getByText(/Also the fastest route/)).toBeInTheDocument()
    expect(screen.getAllByText(/travel time 7h 36m vs 8h 05m on Route B/).length).toBeGreaterThan(0)
    expect(screen.queryByText(/Only \d distinct/)).not.toBeInTheDocument()
  })

  it('designs for two routes: explains why there are only two', () => {
    const result = two as unknown as AnalyzeResponse
    view({ result, selectedId: result.recommendedRouteId })
    expect(screen.getAllByRole('button', { name: /^Route [A-C]/ })).toHaveLength(2)
    expect(screen.getAllByText(/We found only 2 reasonable truck routes/)).toHaveLength(1)
    // the backend's own "Only 2 distinct route(s)" warning is not repeated
    expect(screen.queryByText('Only 2 distinct route(s) found for this trip.')).not.toBeInTheDocument()
  })

  it('selects a route on click', async () => {
    const result = three as unknown as AnalyzeResponse
    view({ result, selectedId: 'r0' })
    await userEvent.click(screen.getByRole('button', { name: /^Route B/ }))
    expect(handlers.onSelect).toHaveBeenCalledWith('r1')
  })

  it('banners No Travel on the recommended route and keeps unknown miles out of Low', () => {
    const result = structuredClone(three) as unknown as AnalyzeResponse
    for (const r of result.routes) {
      r.milesByLevel['No Travel'] = 40
      r.milesByLevel.Low -= 40
    }
    result.routes[1].unknownMi = 30
    view({ result, selectedId: 'r0' })
    expect(screen.getByText('No Travel conditions on every route')).toBeInTheDocument()
    expect(screen.getByText(/shown as Unknown, not Low/)).toBeInTheDocument()
    const card = screen.getByRole('button', { name: /^Route B/ })
    expect(within(card).getByText(/No forecast for 30 mi; it is not counted as Low/)).toBeInTheDocument()
  })

  it('shows a retry for upstream failures but not for validation errors', async () => {
    const { unmount } = view({ error: new ApiError('upstream', 'A data provider is not responding (TomTom).') })
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(handlers.onRetry).toHaveBeenCalled()
    unmount()
    view({ error: new ApiError('validation', 'Departure is in the past.') })
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
  })
})

describe('stageText', () => {
  it.each([
    [0, 'Finding truck routes…'],
    [4, 'Fetching forecasts along each route…'],
    [8, 'Rating checkpoints and ranking routes…'],
    [15, 'Still working. Long trips can take up to 20 s.'],
  ])('at %i s says %s', (sec, text) => expect(stageText(sec)).toBe(text))
})
