import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderWithTheme } from '../test/render'
import { LevelBadge } from './LevelBadge'

describe('LevelBadge', () => {
  it.each([
    [0, 'Low'],
    [1, 'Moderate'],
    [2, 'High'],
    [3, 'Severe'],
    [4, 'No Travel'],
  ] as const)('shows level %i as the text "%s"', (level, text) => {
    renderWithTheme(<LevelBadge level={level} />)
    expect(screen.getByText(text)).toBeInTheDocument()
  })

  it('shows missing data as Unknown, never Low', () => {
    renderWithTheme(<LevelBadge level={null} />)
    expect(screen.getByText('Unknown')).toBeInTheDocument()
    expect(screen.queryByText('Low')).not.toBeInTheDocument()
  })
})
