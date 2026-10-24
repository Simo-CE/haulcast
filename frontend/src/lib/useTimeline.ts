import { useCallback, useEffect, useRef, useState } from 'react'

/** Hours of forecast per second of playback: the full 48 h in 16 s. */
export const PLAY_SPEED = 3

const reducedMotion = (): boolean => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

/**
 * The slider position in hours (0..max, fractional), plus play/pause.
 * Scrubbing updates at once (a held arrow key must never lose a step); the map throttles its own repaint
 * to one per animation frame. With reduced motion, play steps one whole
 * hour per second instead of sweeping continuously. `resetKey` changing (a new analysis) rewinds and pauses.
 */
export function useTimeline(max: number, resetKey: unknown) {
  const [hour, setHourState] = useState(0)
  const [playing, setPlaying] = useState(false)
  const hourRef = useRef(0)

  const commit = useCallback((h: number) => {
    hourRef.current = h
    setHourState(h)
  }, [])

  const scrub = useCallback(
    (h: number) => {
      setPlaying(false)
      commit(Math.min(max, Math.max(0, h)))
    },
    [max, commit],
  )

  const toggle = useCallback(() => {
    if (!playing && hourRef.current >= max) commit(0)
    setPlaying((p) => !p)
  }, [playing, max, commit])

  useEffect(() => {
    if (!playing) return
    if (reducedMotion()) {
      const id = setInterval(() => {
        const next = Math.min(max, Math.floor(hourRef.current) + 1)
        commit(next)
        if (next >= max) setPlaying(false)
      }, 1000)
      return () => clearInterval(id)
    }
    let last: number | null = null
    let raf = 0
    const tick = (now: number) => {
      const next = Math.min(max, hourRef.current + (last === null ? 0 : ((now - last) / 1000) * PLAY_SPEED))
      last = now
      commit(next)
      if (next >= max) setPlaying(false)
      else raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, max, commit])

  // reset while rendering rather than in an effect, so no frame shows the old hour with the new data
  const [seenKey, setSeenKey] = useState(resetKey)
  if (seenKey !== resetKey) {
    setSeenKey(resetKey)
    setHourState(0)
    setPlaying(false)
  }
  useEffect(() => {
    hourRef.current = hour
  }, [hour])

  return { hour, playing, scrub, toggle }
}
