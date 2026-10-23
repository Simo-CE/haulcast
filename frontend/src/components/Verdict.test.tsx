import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import three from '../test/fixtures/analyze-3-routes.json'
import { renderWithTheme } from '../test/render'
import type { AnalyzeResponse } from '../types/api'
import { Verdict } from './Verdict'

const base = () => structuredClone(three) as unknown as AnalyzeResponse

describe('Verdict', () => {
  it('names the route and says it is also the fastest when it is', () => {
    renderWithTheme(<Verdict result={base()} />)
    expect(screen.getByText('Take Route A')).toBeInTheDocument()
    expect(screen.getByText(/Also the fastest route/)).toBeInTheDocument()
  })

  it('spells out the trade-off when a faster route was passed over', () => {
    const result = base()
    result.recommendedRouteId = 'r1'
    result.routes[0].milesByLevel.Moderate = 100
    renderWithTheme(<Verdict result={result} />)
    expect(screen.getByText('Take Route B')).toBeInTheDocument()
    expect(screen.getByText('Route A is 29 min faster but has 100 mi of Moderate weather.')).toBeInTheDocument()
  })

  it('never presents partial forecast data as plain Low', () => {
    const result = base()
    result.routes[0].unknownMi = 40
    renderWithTheme(<Verdict result={result} />)
    expect(screen.getByText('Low, partial data')).toBeInTheDocument()
  })
})
