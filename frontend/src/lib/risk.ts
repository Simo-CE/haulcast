import type { Level, LevelLabel } from '../types/api'

export type LevelKey = LevelLabel | 'Unknown'

export const LEVEL_LABELS: LevelLabel[] = ['Low', 'Moderate', 'High', 'Severe', 'No Travel']

interface LevelStyle {
  light: string
  dark: string
  /** text colour that keeps 4.5:1 contrast on the fill */
  lightText: string
  darkText: string
}

/**
 * Colour-blind-safe ramp (blue, yellow, orange, red, near-black purple): it changes in both hue and
 * lightness, and every use pairs it with the level's text label.
 */
export const LEVEL_STYLES: Record<LevelKey, LevelStyle> = {
  Low: { light: '#2b7bba', dark: '#6cb4ee', lightText: '#ffffff', darkText: '#0b2438' },
  Moderate: { light: '#f2c230', dark: '#f2c230', lightText: '#2b2100', darkText: '#2b2100' },
  High: { light: '#e8741a', dark: '#f2913f', lightText: '#1f0f00', darkText: '#1f0f00' },
  Severe: { light: '#c1272d', dark: '#ee5a5f', lightText: '#ffffff', darkText: '#2a0507' },
  'No Travel': { light: '#4a1a6b', dark: '#b58ae0', lightText: '#ffffff', darkText: '#1c0930' },
  Unknown: { light: '#6b7280', dark: '#9ca3af', lightText: '#ffffff', darkText: '#111418' },
}

/** null (no weather data) is Unknown, never Low. */
export function levelLabel(level: Level | null): LevelLabel | 'Unknown' {
  return level === null ? 'Unknown' : LEVEL_LABELS[level]
}

/** Nearest level name for a mileage-weighted average score (0-4). */
export function avgRiskLabel(avgRisk: number | null): LevelLabel | 'Unknown' {
  return avgRisk === null ? 'Unknown' : LEVEL_LABELS[Math.min(4, Math.round(avgRisk))]
}
