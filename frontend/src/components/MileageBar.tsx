import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { formatMiles } from '../lib/format'
import { levelSx } from '../lib/levelSx'
import { mileageSegments } from '../lib/mileage'
import type { Route } from '../types/api'

const hatch = {
  backgroundImage:
    'repeating-linear-gradient(45deg, rgb(255 255 255 / 0.35) 0 3px, transparent 3px 6px)',
}

/** Stacked bar of route miles per risk level; the legend repeats every number as text. */
export function MileageBar({ route }: { route: Pick<Route, 'milesByLevel' | 'unknownMi'> }) {
  const segments = mileageSegments(route)
  const summary = segments.map((s) => `${formatMiles(s.miles)} ${s.label}`).join(', ')
  return (
    <Box>
      <Box
        role="img"
        aria-label={`Miles by risk level: ${summary}`}
        sx={{ display: 'flex', height: 10, borderRadius: 5, overflow: 'hidden', bgcolor: 'divider', gap: '2px' }}
      >
        {segments.map((s) => (
          <Box
            key={s.label}
            data-testid={`segment-${s.label}`}
            sx={[levelSx(s.label), s.label === 'Unknown' && hatch, { flexGrow: s.miles, flexBasis: 0, minWidth: 4 }]}
          />
        ))}
      </Box>
      <Stack direction="row" aria-hidden sx={{ flexWrap: 'wrap', columnGap: 1.5, rowGap: 0.25, mt: 0.75 }}>
        {segments.map((s) => (
          <Stack key={s.label} direction="row" sx={{ alignItems: 'center', gap: 0.5 }}>
            <Box sx={[levelSx(s.label), { width: 9, height: 9, borderRadius: '2px' }]} />
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              {s.label === 'Unknown' ? `${formatMiles(s.miles)} unknown` : `${formatMiles(s.miles)} ${s.label}`}
            </Typography>
          </Stack>
        ))}
      </Stack>
    </Box>
  )
}
