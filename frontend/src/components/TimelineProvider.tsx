import { type ReactNode, useMemo, useState } from 'react'
import { useTimeline } from '../lib/useTimeline'
import { TimelineContext } from './timelineContext'

/**
 * Holds the slider hour above both the map and the dock. Only consumers re-render per frame:
 * `children` is the same element tree App built, so React skips it.
 */
export function TimelineProvider({ max, resetKey, children }: { max: number; resetKey: unknown; children: ReactNode }) {
  const { hour, playing, scrub, toggle } = useTimeline(max, resetKey)
  const [showHeat, setShowHeat] = useState(true)
  const value = useMemo(() => ({ hour, max, playing, scrub, toggle, showHeat, setShowHeat }), [hour, max, playing, scrub, toggle, showHeat])
  return <TimelineContext.Provider value={value}>{children}</TimelineContext.Provider>
}
