import type { Theme } from '@mui/material/styles'
import type { SystemStyleObject } from '@mui/system'
import { LEVEL_STYLES, type LevelKey } from './risk'

/** Fill + text colours for a level, switching with the colour scheme. */
export function levelSx(label: LevelKey): (theme: Theme) => SystemStyleObject<Theme> {
  const s = LEVEL_STYLES[label]
  return (theme: Theme) => ({
    bgcolor: s.light,
    color: s.lightText,
    ...theme.applyStyles('dark', { bgcolor: s.dark, color: s.darkText }),
  })
}
