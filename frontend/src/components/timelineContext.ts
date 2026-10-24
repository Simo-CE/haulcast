import { createContext, useContext } from 'react'

export interface TimelineValue {
  hour: number
  /** last slider hour: the end of the trip */
  max: number
  playing: boolean
  scrub: (hour: number) => void
  toggle: () => void
  showHeat: boolean
  setShowHeat: (show: boolean) => void
}

export const TimelineContext = createContext<TimelineValue | null>(null)

export function useTimelineContext(): TimelineValue {
  const value = useContext(TimelineContext)
  if (!value) throw new Error('useTimelineContext needs a TimelineProvider')
  return value
}
