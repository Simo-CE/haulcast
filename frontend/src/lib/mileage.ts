import type { Route } from '../types/api'
import { LEVEL_LABELS, type LevelKey } from './risk'

export interface Segment {
  label: LevelKey
  miles: number
}

export function mileageSegments(route: Pick<Route, 'milesByLevel' | 'unknownMi'>): Segment[] {
  const segments: Segment[] = LEVEL_LABELS.map((label) => ({ label, miles: route.milesByLevel[label] }))
  segments.push({ label: 'Unknown', miles: route.unknownMi })
  return segments.filter((s) => s.miles > 0)
}
