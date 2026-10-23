import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import Box from '@mui/material/Box'
import ButtonBase from '@mui/material/ButtonBase'
import Card from '@mui/material/Card'
import Collapse from '@mui/material/Collapse'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { useState } from 'react'
import { formatClock, formatDuration, formatMiles } from '../lib/format'
import { avgRiskLabel } from '../lib/risk'
import { CARD_RADIUS, FONT } from '../theme'
import type { Level, Ranking, Route } from '../types/api'
import { CheckpointTable } from './CheckpointTable'
import { LevelBadge } from './LevelBadge'
import { MileageBar } from './MileageBar'
import { RouteBadge } from './RouteBadge'

interface Props {
  route: Route
  ranking: Ranking | undefined
  recommended: boolean
  selected: boolean
  activeCheckpoint: number | null
  onSelect: () => void
  onHover: (hovering: boolean) => void
  onActivateCheckpoint: (index: number) => void
}

export function RouteCard({
  route,
  ranking,
  recommended,
  selected,
  activeCheckpoint,
  onSelect,
  onHover,
  onActivateCheckpoint,
}: Props) {
  const [showTable, setShowTable] = useState(false)
  const noTravelMi = route.milesByLevel['No Travel']
  const risk = avgRiskLabel(route.avgRisk)
  const avgLevel = route.avgRisk === null ? null : (Math.min(4, Math.round(route.avgRisk)) as Level)
  const arrival = route.checkpoints.at(-1)?.eta
  return (
    <Card
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      sx={{
        borderRadius: CARD_RADIUS,
        borderColor: selected ? 'primary.main' : 'divider',
        boxShadow: selected ? '0 0 0 1px var(--mui-palette-primary-main)' : 'none',
        transition: 'box-shadow .15s, border-color .15s',
      }}
    >
      <ButtonBase
        onClick={onSelect}
        onFocus={() => onHover(true)}
        onBlur={() => onHover(false)}
        aria-pressed={selected}
        sx={{ display: 'block', width: '100%', textAlign: 'left', p: 1.75 }}
      >
        <Stack direction="row" sx={{ alignItems: 'center', gap: 1.25, mb: 1.25 }}>
          <RouteBadge name={route.name} selected={selected} />
          <Typography variant="h2" component="p" sx={{ flex: 1 }}>
            {route.name}
          </Typography>
          {recommended ? (
            <Box sx={{ bgcolor: 'secondary.main', color: 'secondary.contrastText', px: 1, py: 0.25, borderRadius: '6px' }}>
              <Typography variant="caption" sx={{ fontWeight: 700 }}>
                Recommended
              </Typography>
            </Box>
          ) : (
            <Typography variant="caption" color="text.secondary">
              Rank {ranking?.rank ?? '–'}
            </Typography>
          )}
        </Stack>
        <Stack direction="row" sx={{ alignItems: 'flex-end', justifyContent: 'space-between', gap: 2, mb: 1.5 }}>
          <div>
            <Typography sx={{ fontFamily: FONT, fontSize: '1.25rem', fontWeight: 580, letterSpacing: '-0.035em', lineHeight: 1.1 }}>
              {formatDuration(route.durationMin)}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {formatMiles(route.distanceMi)}
              {arrival && ` · arrive ${formatClock(arrival)}`}
            </Typography>
          </div>
          <Stack sx={{ alignItems: 'flex-end', gap: 0.25 }}>
            <Typography variant="caption" color="text.secondary">
              Average risk
            </Typography>
            <LevelBadge level={avgLevel} />
            <span hidden>{route.avgRisk === null ? 'Unknown' : `${risk} (${route.avgRisk.toFixed(1)}/4)`}</span>
          </Stack>
        </Stack>
        <MileageBar route={route} />
        {ranking && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1.25 }}>
            {ranking.reason}
          </Typography>
        )}
        {(noTravelMi > 0 || route.unknownMi > 0) && (
          <Stack direction="row" sx={{ alignItems: 'flex-start', gap: 0.75, mt: 1 }}>
            <WarningAmberIcon sx={{ fontSize: 18, mt: '1px' }} color="warning" />
            <Typography variant="body2">
              {noTravelMi > 0 && `${formatMiles(noTravelMi)} of No Travel conditions. `}
              {route.unknownMi > 0 && `No forecast for ${formatMiles(route.unknownMi)}; it is not counted as Low.`}
            </Typography>
          </Stack>
        )}
      </ButtonBase>
      {selected && (
        <>
          <ButtonBase
            onClick={() => setShowTable((v) => !v)}
            aria-expanded={showTable}
            sx={{ width: '100%', justifyContent: 'space-between', px: 2, py: 1.25, borderTop: 1, borderColor: 'divider' }}
          >
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {route.checkpoints.length} checkpoints, hour by hour
            </Typography>
            <ExpandMoreIcon sx={{ transform: showTable ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }} />
          </ButtonBase>
          <Collapse in={showTable} unmountOnExit>
            <CheckpointTable checkpoints={route.checkpoints} activeIndex={activeCheckpoint} onActivate={onActivateCheckpoint} />
          </Collapse>
        </>
      )}
    </Card>
  )
}
