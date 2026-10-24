import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PLAY_SPEED, useTimeline } from './useTimeline'

let frames: ((t: number) => void)[] = []
const flush = (t: number) => act(() => { const f = frames; frames = []; f.forEach((cb) => cb(t)) })

beforeEach(() => {
  frames = []
  vi.stubGlobal('requestAnimationFrame', (cb: (t: number) => void) => frames.push(cb))
  vi.stubGlobal('cancelAnimationFrame', () => { frames = [] })
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
})
afterEach(() => vi.unstubAllGlobals())

describe('useTimeline', () => {
  it('scrubs at once, clamped to the range, so repeated key steps never read a stale value', () => {
    const { result } = renderHook(() => useTimeline(48, 'a'))
    act(() => result.current.scrub(9.5))
    expect(result.current.hour).toBe(9.5)
    act(() => result.current.scrub(80))
    expect(result.current.hour).toBe(48)
    act(() => result.current.scrub(-3))
    expect(result.current.hour).toBe(0)
  })

  it('plays continuously at PLAY_SPEED, stops at the end, and replays from 0', () => {
    const { result } = renderHook(() => useTimeline(48, 'a'))
    act(() => result.current.toggle())
    expect(result.current.playing).toBe(true)
    flush(1000)
    flush(2000)
    expect(result.current.hour).toBeCloseTo(PLAY_SPEED)
    flush(1_000_000)
    expect(result.current.hour).toBe(48)
    expect(result.current.playing).toBe(false)
    act(() => result.current.toggle())
    expect(result.current.hour).toBe(0)
    expect(result.current.playing).toBe(true)
  })

  it('scrubbing pauses playback', () => {
    const { result } = renderHook(() => useTimeline(48, 'a'))
    act(() => result.current.toggle())
    act(() => result.current.scrub(10))
    expect(result.current.playing).toBe(false)
  })

  it('steps whole hours once a second under prefers-reduced-motion', () => {
    vi.useFakeTimers()
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    const { result } = renderHook(() => useTimeline(3, 'a'))
    act(() => result.current.toggle())
    act(() => { vi.advanceTimersByTime(1000) })
    expect(result.current.hour).toBe(1)
    act(() => { vi.advanceTimersByTime(5000) })
    expect(result.current.hour).toBe(3)
    expect(result.current.playing).toBe(false)
    vi.useRealTimers()
  })

  it('rewinds and pauses when a new analysis arrives', () => {
    const { result, rerender } = renderHook(({ k }) => useTimeline(48, k), { initialProps: { k: 'a' } })
    act(() => result.current.scrub(20))
    act(() => result.current.toggle())
    rerender({ k: 'b' })
    expect(result.current.hour).toBe(0)
    expect(result.current.playing).toBe(false)
  })
})
