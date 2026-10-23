import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { levelSx } from '../lib/levelSx'
import { LEVEL_LABELS } from '../lib/risk'

/** Always-visible key for the checkpoint colours; the label text is the real signal. */
export function MapLegend({ showUnknown }: { showUnknown: boolean }) {
  return (
    <Box
      component="ul"
      aria-label="Checkpoint risk levels"
      sx={{
        position: 'absolute',
        top: 12,
        left: 12,
        zIndex: 1,
        m: 0,
        py: 0.75,
        px: 1.25,
        listStyle: 'none',
        display: 'flex',
        flexWrap: 'wrap',
        columnGap: 1.25,
        rowGap: 0.25,
        right: { xs: 12, md: 'auto' },
        justifyContent: { xs: 'space-between', md: 'flex-start' },
        bgcolor: 'background.paper',
        borderRadius: '14px',
        boxShadow: '0 2px 10px rgb(0 0 0 / 0.18)',
      }}
    >
      {[...LEVEL_LABELS, ...(showUnknown ? (['Unknown'] as const) : [])].map((label) => (
        <Stack key={label} component="li" direction="row" sx={{ alignItems: 'center', gap: 0.5 }}>
          <Box sx={[levelSx(label), { width: 10, height: 10, borderRadius: '50%' }]} />
          <Typography variant="caption" noWrap sx={{ fontWeight: 600, fontSize: { xs: '0.65625rem', md: '0.6875rem' } }}>
            {label}
          </Typography>
        </Stack>
      ))}
    </Box>
  )
}
