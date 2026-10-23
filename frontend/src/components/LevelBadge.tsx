import Box from '@mui/material/Box'
import { levelSx } from '../lib/levelSx'
import { levelLabel } from '../lib/risk'
import type { Level } from '../types/api'

interface Props {
  /** 0-4, or null for "no weather data" which reads Unknown, never Low */
  level: Level | null
}

export function LevelBadge({ level }: Props) {
  const label = levelLabel(level)
  return (
    <Box
      component="span"
      sx={[
        levelSx(label),
        {
          display: 'inline-block',
          px: 1,
          py: 0.25,
          borderRadius: 1,
          fontSize: '0.6875rem',
          fontWeight: 700,
          lineHeight: 1.5,
          whiteSpace: 'nowrap',
        },
      ]}
    >
      {label}
    </Box>
  )
}
