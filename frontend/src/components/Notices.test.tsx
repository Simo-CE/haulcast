import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import abq from '../test/fixtures/analyze-abq-denver-mixed.json'
import { renderWithTheme } from '../test/render'
import type { AnalyzeResponse } from '../types/api'
import { Notices } from './Notices'

const base = abq as unknown as AnalyzeResponse

describe('Notices', () => {
  it('labels a recorded storm as a replay, and says nothing about replay for a live analysis', () => {
    const replay = { title: 'Wyoming wind storm', summary: 'This is a replay, not today.', forecastSource: 'archive' }
    const { unmount } = renderWithTheme(<Notices result={{ ...base, replay }} />)
    expect(screen.getByText('Replay: Wyoming wind storm')).toBeTruthy()
    unmount()
    renderWithTheme(<Notices result={base} />)
    expect(screen.queryByText(/Replay:/)).toBeNull()
  })
})
