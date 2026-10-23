import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderWithTheme } from '../test/render'
import { mileageSegments } from '../lib/mileage'
import { MileageBar } from './MileageBar'

const miles = { Low: 300, Moderate: 50, High: 0, Severe: 25.4, 'No Travel': 0 }

describe('mileageSegments', () => {
  it('keeps only levels that have miles, in risk order', () => {
    expect(mileageSegments({ milesByLevel: miles, unknownMi: 0 }).map((s) => s.label)).toEqual([
      'Low',
      'Moderate',
      'Severe',
    ])
  })

  it('adds unknown miles as their own segment', () => {
    const segments = mileageSegments({ milesByLevel: { ...miles, Low: 0 }, unknownMi: 12 })
    expect(segments.at(-1)).toEqual({ label: 'Unknown', miles: 12 })
  })
})

describe('MileageBar', () => {
  it('describes every segment in text for screen readers', () => {
    renderWithTheme(<MileageBar route={{ milesByLevel: miles, unknownMi: 12 }} />)
    expect(screen.getByRole('img')).toHaveAttribute(
      'aria-label',
      'Miles by risk level: 300 mi Low, 50 mi Moderate, 25 mi Severe, 12 mi Unknown',
    )
  })

  it('sizes segments by miles and renders no empty ones', () => {
    renderWithTheme(<MileageBar route={{ milesByLevel: miles, unknownMi: 0 }} />)
    expect(screen.getByTestId('segment-Low')).toBeInTheDocument()
    expect(screen.queryByTestId('segment-High')).not.toBeInTheDocument()
    expect(screen.queryByTestId('segment-Unknown')).not.toBeInTheDocument()
  })
})
