import FlagIcon from '@mui/icons-material/Flag'
import PlaceIcon from '@mui/icons-material/Place'
import Box from '@mui/material/Box'
import { keyframes } from '@mui/material/styles'
import { useState } from 'react'
import { Marker, useMap } from 'react-map-gl/maplibre'
import type { Place } from '../types/api'

export const PREVIEW_FLIGHT_MS = 900
/** a marker waits for the camera to arrive, then hops */
const HOP_DELAY_MS = PREVIEW_FLIGHT_MS - 150

export type PlaceKind = 'origin' | 'destination'

/** Blue pin for where the trip starts, dark flag for where it ends: different in colour and in shape. */
const COLORS = { origin: { light: '#1d5fd1', dark: '#7db0ff' }, destination: { light: '#111418', dark: '#f4f6f8' } }

const hopIn = keyframes`
  0% { opacity: 0; transform: translateY(-36px) scale(0.8); }
  45% { opacity: 1; transform: translateY(0) scale(1); }
  65% { transform: translateY(-12px); }
  85% { transform: translateY(0); }
  93% { transform: translateY(-3px); }
  100% { transform: translateY(0); }
`

interface Props {
  kind: PlaceKind
  place: Place
  /** hop in: after the camera flight, or at once when the place is already on screen (a click on the map) */
  hop?: boolean
}

export function PlaceMarker({ kind, place, hop = false }: Props) {
  const { current: map } = useMap()
  // Decided when the marker mounts: a later change would restart the animation.
  const [hopAfterMs] = useState<number | undefined>(() =>
    hop ? (map?.getBounds().contains([place.lon, place.lat]) ? 0 : HOP_DELAY_MS) : undefined,
  )
  const label = kind === 'origin' ? `Origin: ${place.label}` : `Destination: ${place.label}`
  const Icon = kind === 'origin' ? PlaceIcon : FlagIcon
  return (
    <Marker longitude={place.lon} latitude={place.lat} anchor={kind === 'origin' ? 'bottom' : 'bottom-left'}>
      <Box
        data-testid={`marker-${kind}`}
        sx={[
          { display: 'flex' },
          hopAfterMs !== undefined && {
            animation: `${hopIn} 650ms cubic-bezier(.3,.7,.4,1) ${hopAfterMs}ms both`,
            '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
          },
        ]}
      >
        <Icon
          titleAccess={label}
          sx={[
            { fontSize: kind === 'origin' ? 40 : 32, filter: 'drop-shadow(0 1px 2px rgb(0 0 0 / .45))' },
            (theme) => ({
              color: COLORS[kind].light,
              ...theme.applyStyles('dark', { color: COLORS[kind].dark }),
            }),
          ]}
        />
      </Box>
    </Marker>
  )
}
