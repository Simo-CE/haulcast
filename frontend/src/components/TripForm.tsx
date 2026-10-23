import ArrowForwardIcon from '@mui/icons-material/ArrowForward'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import SwapVertIcon from '@mui/icons-material/SwapVert'
import Button from '@mui/material/Button'
import ButtonBase from '@mui/material/ButtonBase'
import Chip from '@mui/material/Chip'
import Collapse from '@mui/material/Collapse'
import InputAdornment from '@mui/material/InputAdornment'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Typography from '@mui/material/Typography'
import { useState } from 'react'
import { PRESETS, type Preset } from '../lib/presets'
import {
  defaultDeparture,
  type FormErrors,
  isPast,
  MAX_LOAD_LB,
  SPACINGS,
  type Spacing,
  toLocalInput,
  type TripFormValues,
  validateTrip,
} from '../lib/tripForm'
import type { AnalyzeRequest } from '../types/api'
import { FieldLabel } from './FieldLabel'
import { PlaceField } from './PlaceField'

const LOAD_SHORTCUTS = [
  ['Empty', 15_000],
  ['Typical', 42_000],
  ['Heavy', 45_000],
] as const

interface Props {
  values: TripFormValues
  onChange: (values: TripFormValues) => void
  onSubmit: (request: AnalyzeRequest) => void
  loading: boolean
  /** field messages from a 400 response */
  serverErrors: FormErrors
  /** phones: departure, load and spacing sit behind a one-line summary to save height */
  compact?: boolean
}

function Label({ children }: { children: string }) {
  return (
    <Typography variant="h3" component="p" color="text.secondary" sx={{ mb: 0.75 }}>
      {children}
    </Typography>
  )
}

export function TripForm({ values, onChange, onSubmit, loading, serverErrors, compact = false }: Props) {
  const [errors, setErrors] = useState<FormErrors>({})
  const [optionsOpen, setOptionsOpen] = useState(false)
  const [now] = useState(() => new Date())
  const shown = { ...serverErrors, ...errors }
  const showOptions = !compact || optionsOpen || Boolean(shown.departure || shown.loadLb)

  const update = (patch: Partial<TripFormValues>, cleared: (keyof FormErrors)[]) => {
    onChange({ ...values, ...patch })
    setErrors((prev) => ({ ...prev, ...Object.fromEntries(cleared.map((k) => [k, undefined])) }))
  }

  const submit = (next: TripFormValues) => {
    const { errors: found, request } = validateTrip(next)
    setErrors(found)
    if (request) onSubmit(request)
  }

  const applyPreset = (preset: Preset) => {
    const next: TripFormValues = {
      ...values,
      origin: preset.origin,
      destination: preset.destination,
      loadLb: String(preset.loadLb),
      departure: isPast(values.departure) ? defaultDeparture() : values.departure,
    }
    onChange(next)
    submit(next)
  }

  return (
    <Stack
      component="form"
      noValidate
      sx={{ gap: 2 }}
      onSubmit={(e) => {
        e.preventDefault()
        submit(values)
      }}
    >
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', minHeight: 32 }}>
        <div>
          <Typography variant="h3" component="p" color="text.secondary">
            Trip planner
          </Typography>
          {!compact && (
            <Typography variant="h2" component="h2" sx={{ mt: 0.25 }}>
              Where are you headed?
            </Typography>
          )}
        </div>
        <Button
          size="small"
          color="inherit"
          startIcon={<SwapVertIcon />}
          onClick={() => update({ origin: values.destination, destination: values.origin }, ['origin', 'destination'])}
          sx={{ color: 'text.secondary', whiteSpace: 'nowrap', fontSize: '0.75rem' }}
        >
          Swap
        </Button>
      </Stack>
      <Stack sx={{ gap: 1.25, mt: -0.5 }}>
        <PlaceField
          id="origin"
          label="Origin"
          value={values.origin}
          error={shown.origin}
          onChange={(origin) => update({ origin }, ['origin'])}
        />
        <PlaceField
          id="destination"
          label="Destination"
          value={values.destination}
          error={shown.destination}
          onChange={(destination) => update({ destination }, ['destination'])}
        />
      </Stack>

      {compact && (
        <ButtonBase
          onClick={() => setOptionsOpen((v) => !v)}
          aria-expanded={showOptions}
          sx={{
            justifyContent: 'space-between',
            textAlign: 'left',
            px: 1.5,
            py: 1,
            border: 1,
            borderColor: 'divider',
            borderRadius: '12px',
          }}
        >
          <Typography variant="body2">
            {new Date(values.departure).toLocaleString('en-US', {
              month: 'short',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
            })}
            {' · '}
            {Number(values.loadLb.replace(/,/g, '')).toLocaleString('en-US')} lb · every {values.spacingMi} mi
          </Typography>
          <ExpandMoreIcon sx={{ transform: showOptions ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }} />
        </ButtonBase>
      )}

      <Collapse in={showOptions}>
        <Stack sx={{ gap: 2 }}>
          <div>
            <FieldLabel htmlFor="departure">Departure (your local time)</FieldLabel>
            <TextField
              id="departure"
              type="datetime-local"
              value={values.departure}
              error={Boolean(shown.departure)}
              helperText={shown.departure}
              onChange={(e) => update({ departure: e.target.value }, ['departure'])}
              slotProps={{
                htmlInput: { min: toLocalInput(now), max: toLocalInput(new Date(now.getTime() + 7 * 24 * 3_600_000)) },
              }}
            />
          </div>
          <div>
            <FieldLabel htmlFor="load">Load</FieldLabel>
            <TextField
              id="load"
              value={values.loadLb}
              error={Boolean(shown.loadLb)}
              helperText={
                shown.loadLb ??
                `Payload in pounds, up to ${MAX_LOAD_LB.toLocaleString('en-US')}. Heavier loads lower the wind limits.`
              }
              onChange={(e) => update({ loadLb: e.target.value }, ['loadLb'])}
              slotProps={{
                htmlInput: { inputMode: 'numeric' },
                input: { endAdornment: <InputAdornment position="end">lb</InputAdornment> },
              }}
            />
            <Stack direction="row" sx={{ gap: 0.75, mt: 0.75, flexWrap: 'wrap' }}>
              {LOAD_SHORTCUTS.map(([name, lb]) => (
                <Chip
                  key={name}
                  size="small"
                  variant={Number(values.loadLb) === lb ? 'filled' : 'outlined'}
                  color={Number(values.loadLb) === lb ? 'primary' : 'default'}
                  label={`${name} ${lb.toLocaleString('en-US')}`}
                  onClick={() => update({ loadLb: String(lb) }, ['loadLb'])}
                />
              ))}
            </Stack>
          </div>
          <div>
            <Label>Checkpoint spacing</Label>
            <ToggleButtonGroup
              exclusive
              fullWidth
              size="small"
              value={values.spacingMi}
              aria-label="Checkpoint spacing"
              onChange={(_e, spacing: Spacing | null) => spacing && update({ spacingMi: spacing }, [])}
            >
              {SPACINGS.map((s) => (
                <ToggleButton key={s} value={s} sx={{ fontWeight: 600 }}>
                  {s} mi
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
            <Stack direction="row" sx={{ justifyContent: 'space-between', mt: 0.5 }}>
              <Typography variant="caption" color="text.secondary">
                More detail
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Faster analysis
              </Typography>
            </Stack>
          </div>
        </Stack>
      </Collapse>

      <Button
        type="submit"
        variant="contained"
        size="large"
        disabled={loading}
        endIcon={<ArrowForwardIcon />}
        sx={{ py: 1.1 }}
      >
        {loading ? 'Analysing…' : 'Find the safest route'}
      </Button>
      <div>
        <Typography variant="caption" component="p" sx={{ color: 'text.secondary', mb: 0.5 }}>
          Or try a preset
        </Typography>
        <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.75 }}>
          {PRESETS.map((p) => (
            <Chip
              key={p.name}
              label={p.name}
              size="small"
              variant="outlined"
              disabled={loading}
              onClick={() => applyPreset(p)}
            />
          ))}
        </Stack>
      </div>
    </Stack>
  )
}
