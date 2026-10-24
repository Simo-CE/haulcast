import LocalShippingIcon from '@mui/icons-material/LocalShipping'
import Box from '@mui/material/Box'
import { useMemo } from 'react'
import { Marker } from 'react-map-gl/maplibre'
import { arrivalHour, pathLengths, truckPosition } from '../lib/timeline'
import type { Route } from '../types/api'
import { useTimelineContext } from './timelineContext'

/** Where the truck is on the selected route at the slider's time, from the checkpoint ETAs. */
export function TruckMarker({ route, startTime }: { route: Route; startTime: string }) {
  const { hour } = useTimelineContext()
  const cum = useMemo(() => pathLengths(route.geometry), [route])
  const arrived = hour >= arrivalHour(route, startTime)
  const [lon, lat] = truckPosition(route, cum, startTime, hour)
  return (
    <Marker longitude={lon} latitude={lat} anchor="center" style={{ pointerEvents: 'none' }}>
      <Box
        sx={{
          display: 'grid',
          placeItems: 'center',
          width: 30,
          height: 30,
          borderRadius: '50%',
          bgcolor: 'primary.main',
          opacity: arrived ? 0.55 : 1, // parked: the forecast goes on, the trip is over
          color: 'primary.contrastText',
          border: '2px solid',
          borderColor: 'background.paper',
          boxShadow: '0 1px 6px rgb(0 0 0 / .45)',
        }}
      >
        <LocalShippingIcon titleAccess="Truck position at the selected time" sx={{ fontSize: 17 }} />
      </Box>
    </Marker>
  )
}
