import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { formatClock, formatDuration, formatMiles } from '../lib/format'
import { avgRiskLabel, LEVEL_LABELS } from '../lib/risk'
import { CARD_RADIUS, FONT } from '../theme'
import type { AnalyzeResponse, Route } from '../types/api'

/** "Route A is 1 h 17 min faster but has 100 mi of Moderate weather." */
function tradeOff(fastest: Route, best: Route): string {
  const worst = [...LEVEL_LABELS].reverse().find((l) => fastest.milesByLevel[l] > 0 && l !== 'Low')
  const faster = formatDuration(best.durationMin - fastest.durationMin)
  const cost = worst
    ? ` but has ${formatMiles(fastest.milesByLevel[worst])} of ${worst} weather`
    : fastest.unknownMi > 0
      ? ' but has miles without a forecast'
      : ''
  return `${fastest.name} is ${faster} faster${cost}.`
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <Box>
      <Typography variant="caption" noWrap sx={{ opacity: 0.7, display: 'block' }}>
        {label}
      </Typography>
      <Typography noWrap sx={{ fontWeight: 650 }}>
        {value}
      </Typography>
    </Box>
  )
}

/** The answer first: which route to take, why, and what it costs against the fastest. */
export function Verdict({ result }: { result: AnalyzeResponse }) {
  const best = result.routes.find((r) => r.id === result.recommendedRouteId)
  if (!best) return null
  const fastest = result.routes.reduce((a, b) => (b.durationMin < a.durationMin ? b : a))
  const extra = Math.round(best.durationMin - fastest.durationMin)
  const reason = result.ranking.find((r) => r.routeId === best.id)?.reason
  const arrival = best.checkpoints.at(-1)?.eta
  return (
    <Box
      sx={[
        {
          bgcolor: 'primary.main',
          color: 'primary.contrastText',
          borderRadius: CARD_RADIUS,
          p: 2,
          boxShadow: '0 10px 30px -12px rgb(0 0 0 / 0.45)',
        },
        // dark mode: a deep blue card with white text, not a pale slab
        (theme) => theme.applyStyles('dark', { bgcolor: '#1c3d6e', color: '#ffffff' }),
      ]}
    >
      <Stack direction="row" sx={{ alignItems: 'center', gap: 0.75, opacity: 0.85 }}>
        <CheckCircleIcon sx={{ fontSize: 15, color: 'secondary.main' }} />
        <Typography variant="h3" component="p">
          Recommended
        </Typography>
      </Stack>
      <Typography
        sx={{
          fontFamily: FONT,
          fontSize: '1.5rem',
          fontWeight: 560,
          letterSpacing: '-0.035em',
          lineHeight: 1.15,
          mt: 0.5,
        }}
      >
        Take {best.name}
      </Typography>
      <Typography variant="body2" sx={{ mt: 0.75, opacity: 0.85 }}>
        {extra <= 0 ? `Also the fastest route. ${reason ?? ''}` : tradeOff(fastest, best)}
      </Typography>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', md: 'repeat(4, minmax(0, 1fr))' },
          gap: 1.5,
          mt: 2,
          pt: 1.5,
          borderTop: 1,
          borderColor: 'rgb(255 255 255 / 0.16)',
        }}
      >
        <Fact label="Drive time" value={formatDuration(best.durationMin)} />
        {arrival && <Fact label="Arrive (local)" value={formatClock(arrival)} />}
        <Fact label="Distance" value={formatMiles(best.distanceMi)} />
        <Fact
          label="Weather risk"
          value={best.unknownMi > 0 ? `${avgRiskLabel(best.avgRisk)}, partial data` : avgRiskLabel(best.avgRisk)}
        />
      </Box>
    </Box>
  )
}
