import LayersIcon from '@mui/icons-material/Layers'
import PauseIcon from '@mui/icons-material/Pause'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import Box from '@mui/material/Box'
import Chip from '@mui/material/Chip'
import IconButton from '@mui/material/IconButton'
import Slider from '@mui/material/Slider'
import Stack from '@mui/material/Stack'
import ToggleButton from '@mui/material/ToggleButton'
import Typography from '@mui/material/Typography'
import { useColorScheme } from '@mui/material/styles'
import { useMemo } from 'react'
import { buildGrid, hasUnknown } from '../lib/heatField'
import { LEVEL_LABELS, LEVEL_STYLES } from '../lib/risk'
import { ariaTimeText, clockAt, formatOffset } from '../lib/timeline'
import type { Heatmap } from '../types/api'
import { useTimelineContext } from './timelineContext'

/** A tick every 1, 2, 3, 6 or 12 hours: the smallest that leaves 8 or fewer. */
const ticks = (max: number) => {
  const every = [1, 2, 3, 6, 12].find((s) => max / s <= 8) ?? 12
  return Array.from({ length: Math.floor(max / every) + 1 }, (_, i) => ({ value: i * every }))
}

/** Colours under five equal columns, so each label sits under the colour of its level. */
function HeatLegend({ scheme, showUnknown }: { scheme: 'light' | 'dark'; showUnknown: boolean }) {
  const stops = LEVEL_LABELS.map((l, i) => `${LEVEL_STYLES[l][scheme]} ${10 + i * 20}%`).join(', ')
  return (
    <Stack direction="row" sx={{ alignItems: 'flex-end', gap: 1.5 }}>
      <Box sx={{ flex: 1 }} role="img" aria-label={`Heatmap colours from ${LEVEL_LABELS[0]} to ${LEVEL_LABELS[4]}`}>
        <Box sx={{ height: 8, borderRadius: 4, background: `linear-gradient(to right, ${stops})` }} />
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', textAlign: 'center', mt: 0.25 }}>
          {LEVEL_LABELS.map((label) => (
            <Typography key={label} variant="caption" noWrap sx={{ fontSize: '0.65625rem', color: 'text.secondary', fontWeight: 600 }}>
              {label}
            </Typography>
          ))}
        </Box>
      </Box>
      {showUnknown && (
        <Stack sx={{ alignItems: 'center' }}>
          <Box sx={{ width: 22, height: 8, borderRadius: 4, bgcolor: LEVEL_STYLES.Unknown[scheme], opacity: 0.6 }} />
          <Typography variant="caption" sx={{ fontSize: '0.65625rem', color: 'text.secondary', fontWeight: 600 }}>
            No data
          </Typography>
        </Stack>
      )}
    </Stack>
  )
}

/**
 * Play/pause, the hour slider, the heatmap switch and the colour key. `floating` is the card on the desktop map;
 * `sheet` is the flat strip that sits above the phone bottom sheet's scrolling content.
 */
export function TimeDock({ heatmap, arrival, variant, replay = false }: { heatmap: Heatmap; /** hour the selected route arrives; marked on the slider */ arrival?: number; variant: 'floating' | 'sheet'; /** the data is a recorded storm: say so next to the clock */ replay?: boolean }) {
  const { colorScheme } = useColorScheme()
  const scheme = colorScheme === 'dark' ? 'dark' : 'light'
  const { hour, max, playing, scrub, toggle, showHeat, setShowHeat } = useTimelineContext()
  const tickMarks = useMemo(
    () => (arrival !== undefined && arrival <= max ? [...ticks(max), { value: arrival, label: 'Arrives' }] : ticks(max)),
    [max, arrival],
  )
  const unknown = useMemo(() => hasUnknown(buildGrid(heatmap)), [heatmap])

  return (
    <Stack
      role="region"
      aria-label="Forecast time"
      sx={[
        { gap: 0.5, px: 2, pt: 0.5, pb: 1 },
        variant === 'floating' && {
          position: 'absolute',
          zIndex: 1,
          left: 16,
          bottom: 28,
          width: 'min(520px, calc(100% - 32px))',
          bgcolor: 'background.paper',
          borderRadius: '14px',
          boxShadow: '0 2px 14px rgb(0 0 0 / 0.22)',
          pt: 1,
          px: 1.5,
        },
        variant === 'sheet' && { px: 0, borderBottom: 1, borderColor: 'divider', mx: 2 },
      ]}
    >
      <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
        <IconButton onClick={toggle} aria-label={playing ? 'Pause forecast playback' : 'Play forecast'} sx={{ bgcolor: 'primary.main', color: 'primary.contrastText', '&:hover': { bgcolor: 'primary.main' }, width: 34, height: 34 }}>
          {playing ? <PauseIcon fontSize="small" /> : <PlayArrowIcon fontSize="small" />}
        </IconButton>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="h2" sx={{ fontVariantNumeric: 'tabular-nums' }}>
            {formatOffset(hour)} <Box component="span" sx={{ color: 'text.secondary', fontWeight: 500 }}>· {clockAt(heatmap.startTime, hour)}</Box>
            {replay && <Chip size="small" label="Replay" sx={{ ml: 1, height: 20, fontWeight: 700, bgcolor: '#f2c230', color: '#2b2100' }} />}
          </Typography>
        </Box>
        <ToggleButton
          value="heat"
          size="small"
          selected={showHeat}
          onChange={() => setShowHeat(!showHeat)}
          aria-label="Show weather heatmap"
          aria-pressed={showHeat}
          sx={{ gap: 0.5, py: 0.5, borderRadius: '10px' }}
        >
          <LayersIcon fontSize="small" />
          <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>Heatmap</Box>
        </ToggleButton>
      </Stack>
      <Slider
        aria-label="Forecast hour"
        value={hour}
        min={0}
        max={max}
        step={0.25}
        shiftStep={1}
        marks={tickMarks}
        onChange={(_, value) => scrub(value)}
        getAriaValueText={(value) => ariaTimeText(heatmap.startTime, value)}
        sx={{
          mx: 1,
          width: 'auto',
          py: 1,
          // MUI animates the thumb for 150 ms on every change. Restarted each frame during playback, that animation
          // never gets going and the thumb sits still, then jumps to the end.
          '& .MuiSlider-thumb, & .MuiSlider-track': { transition: 'none' },
          '& .MuiSlider-markLabel': { fontSize: '0.65625rem', fontWeight: 600, top: 22, color: 'text.secondary' },
        }}
      />
      {showHeat && <HeatLegend scheme={scheme} showUnknown={unknown} />}
    </Stack>
  )
}
