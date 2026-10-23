import Autocomplete from '@mui/material/Autocomplete'
import CircularProgress from '@mui/material/CircularProgress'
import TextField from '@mui/material/TextField'
import { useQuery } from '@tanstack/react-query'
import { geocode } from '../api/client'
import { FieldLabel } from './FieldLabel'
import { MIN_ADDRESS_CHARS } from '../lib/tripForm'
import { useDebouncedValue } from '../lib/useDebouncedValue'
import type { Place, PlaceInput } from '../types/api'

interface Props {
  id: string
  label: string
  value: PlaceInput | null
  error?: string
  onChange: (value: PlaceInput | null) => void
}

const DEBOUNCE_MS = 300
const DAY_MS = 24 * 3_600_000

const textOf = (value: PlaceInput | null): string => (typeof value === 'string' ? value : (value?.label ?? ''))

/**
 * Autocomplete over the backend's Photon proxy. A picked suggestion carries coordinates (no geocoding on
 * submit); text that was typed but not picked is sent as-is and geocoded by the backend.
 */
export function PlaceField({ id, label, value, error, onChange }: Props) {
  const typed = typeof value === 'string' ? value.trim() : ''
  const query = useDebouncedValue(typed, DEBOUNCE_MS)
  // The query key changing aborts the previous request (react-query hands fetch its signal).
  const suggestions = useQuery({
    queryKey: ['geocode', query],
    queryFn: ({ signal }) => geocode(query, signal),
    enabled: query.length >= MIN_ADDRESS_CHARS && query === typed,
    staleTime: DAY_MS,
    retry: false, // the public Photon server punishes bursts
  })
  // Photon can return the same label twice
  const options: Place[] =
    query === typed ? [...new Map((suggestions.data ?? []).map((p) => [p.label, p])).values()] : []

  return (
    <div>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Autocomplete<Place, false, false, true>
        id={id}
        freeSolo
        options={options}
        value={value}
        inputValue={textOf(value)}
        filterOptions={(all) => all}
        getOptionLabel={(option) => (typeof option === 'string' ? option : option.label)}
        getOptionKey={(option) => (typeof option === 'string' ? option : `${option.lat},${option.lon}`)}
        onInputChange={(_event, text, reason) => {
          if (reason === 'input') onChange(text)
          else if (reason === 'clear') onChange(null)
        }}
        onChange={(_event, picked) => {
          if (picked !== null) onChange(picked)
        }}
        noOptionsText={
          suggestions.isError ? 'Suggestions unavailable. Press Enter to use what you typed.' : 'No matches'
        }
        loading={suggestions.isFetching}
        slotProps={{ listbox: { 'aria-label': `${label} suggestions` } }}
        renderInput={(params) => (
          <TextField
            {...params}
            placeholder="City or address"
            error={Boolean(error)}
            helperText={error}
            slotProps={{
              ...params.slotProps,
              inputLabel: { ...params.slotProps.inputLabel, shrink: textOf(value) !== '' || undefined },
              input: {
                ...params.slotProps.input,
                endAdornment: (
                  <>
                    {suggestions.isFetching ? <CircularProgress size={16} /> : null}
                    {params.slotProps.input.endAdornment}
                  </>
                ),
              },
            }}
          />
        )}
      />
    </div>
  )
}
