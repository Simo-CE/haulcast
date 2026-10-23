import FlagIcon from '@mui/icons-material/Flag'
import TripOriginIcon from '@mui/icons-material/TripOrigin'
import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { useColorScheme } from '@mui/material/styles'
import type { ExpressionSpecification, LngLatBoundsLike, MapLayerMouseEvent } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import Map, { Layer, Marker, NavigationControl, Popup, Source, type MapRef } from 'react-map-gl/maplibre'
import { formatEta, formatNumber } from '../lib/format'
import { LEVEL_STYLES } from '../lib/risk'
import type { AnalyzeResponse } from '../types/api'
import { LevelBadge } from './LevelBadge'
import { MapLegend } from './MapLegend'
import { RouteBadge } from './RouteBadge'

const STYLES = {
  light: 'https://tiles.openfreemap.org/styles/liberty',
  dark: 'https://tiles.openfreemap.org/styles/dark',
}

const ROUTE_COLORS = {
  light: { main: '#0f1b2d', other: '#8a949e', casing: '#ffffff' },
  dark: { main: '#e7edf6', other: '#7d8a96', casing: '#0d1317' },
}

export interface ActiveCheckpoint {
  routeId: string
  index: number
}

interface Props {
  result: AnalyzeResponse | null
  selectedId: string | null
  hoveredId: string | null
  active: ActiveCheckpoint | null
  /** px of the map covered at the bottom (mobile sheet), so fitting keeps routes visible */
  bottomInset: number
  onSelectRoute: (id: string) => void
  onActivate: (active: ActiveCheckpoint | null) => void
  /** Slot for layers drawn under the routes (heatmap) */
  children?: ReactNode
}

const prefersReducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches

function boundsOf(result: AnalyzeResponse): LngLatBoundsLike {
  let w = 180, s = 90, e = -180, n = -90
  for (const route of result.routes) {
    for (const [lon, lat] of route.geometry) {
      w = Math.min(w, lon); e = Math.max(e, lon); s = Math.min(s, lat); n = Math.max(n, lat)
    }
  }
  return [[w, s], [e, n]]
}

export function RouteMap({ result, selectedId, hoveredId, active, bottomInset, onSelectRoute, onActivate, children }: Props) {
  const { colorScheme } = useColorScheme()
  const scheme = colorScheme === 'dark' ? 'dark' : 'light'
  const colors = ROUTE_COLORS[scheme]
  const mapRef = useRef<MapRef>(null)
  const [loaded, setLoaded] = useState(false)
  const [cursor, setCursor] = useState('')

  const routeLines = useMemo(
    () => ({
      type: 'FeatureCollection' as const,
      features: (result?.routes ?? []).map((r) => ({
        type: 'Feature' as const,
        properties: { id: r.id, recommended: r.id === result?.recommendedRouteId ? 1 : 0 },
        geometry: { type: 'LineString' as const, coordinates: r.geometry },
      })),
    }),
    [result],
  )

  const selectedRoute = result?.routes.find((r) => r.id === selectedId)
  const checkpointPoints = useMemo(
    () => ({
      type: 'FeatureCollection' as const,
      features: (selectedRoute?.checkpoints ?? []).map((cp, index) => ({
        type: 'Feature' as const,
        properties: { index, level: cp.level ?? -1 },
        geometry: { type: 'Point' as const, coordinates: [cp.lon, cp.lat] },
      })),
    }),
    [selectedRoute],
  )

  useEffect(() => {
    if (!result || !loaded) return
    mapRef.current?.fitBounds(boundsOf(result), {
      padding: { top: 70, left: 50, right: 50, bottom: bottomInset + 50 },
      duration: prefersReducedMotion() ? 0 : 900,
    })
  }, [result, loaded, bottomInset])

  const activeCheckpoint =
    active && selectedRoute?.id === active.routeId ? selectedRoute.checkpoints[active.index] : undefined
  useEffect(() => {
    if (activeCheckpoint) {
      mapRef.current?.easeTo({ center: [activeCheckpoint.lon, activeCheckpoint.lat], duration: prefersReducedMotion() ? 0 : 400 })
    }
  }, [activeCheckpoint])

  const isSelected: ExpressionSpecification = ['==', ['get', 'id'], selectedId ?? '']
  const isHovered: ExpressionSpecification = ['==', ['get', 'id'], hoveredId ?? '']
  const levelColor = (pick: 'light' | 'dark'): ExpressionSpecification => [
    'match', ['get', 'level'],
    0, LEVEL_STYLES.Low[pick], 1, LEVEL_STYLES.Moderate[pick], 2, LEVEL_STYLES.High[pick],
    3, LEVEL_STYLES.Severe[pick], 4, LEVEL_STYLES['No Travel'][pick], LEVEL_STYLES.Unknown[pick],
  ]

  const onClick = (event: MapLayerMouseEvent) => {
    const feature = event.features?.[0]
    if (!feature) return onActivate(null)
    if (feature.layer.id === 'checkpoints' && selectedId) {
      onActivate({ routeId: selectedId, index: Number(feature.properties.index) })
    } else if (feature.layer.id === 'route-line') {
      onSelectRoute(String(feature.properties.id))
    }
  }

  return (
    <Box role="region" aria-label="Route map" sx={{ position: 'absolute', inset: 0 }}>
      <MapLegend showUnknown={Boolean(result?.routes.some((r) => r.unknownMi > 0))} />
      <Map
        ref={mapRef}
        mapStyle={STYLES[scheme]}
        initialViewState={{ longitude: -98.5, latitude: 39.5, zoom: 3.6 }}
        attributionControl={{ compact: true }}
        interactiveLayerIds={['checkpoints', 'route-line']}
        cursor={cursor}
        onLoad={() => setLoaded(true)}
        onClick={onClick}
        onMouseEnter={() => setCursor('pointer')}
        onMouseLeave={() => setCursor('')}
      >
        {children}
        <NavigationControl showCompass={false} position="top-right" />
        {result?.routes.map((route, i) => {
          // staggered along the line so labels of near-identical routes do not stack
          const [lon, lat] = route.geometry[Math.floor(route.geometry.length * (0.35 + 0.15 * i))]
          return (
            <Marker key={route.id} longitude={lon} latitude={lat} onClick={(e) => { e.originalEvent.stopPropagation(); onSelectRoute(route.id) }}>
              <RouteBadge name={route.name} selected={route.id === selectedId} />
            </Marker>
          )
        })}
        {result && (
          <>
            <Source id="routes" type="geojson" data={routeLines}>
              <Layer
                id="route-casing"
                type="line"
                layout={{ 'line-cap': 'round', 'line-join': 'round', 'line-sort-key': ['case', isSelected, 2, isHovered, 1, 0] }}
                paint={{
                  'line-color': colors.casing,
                  'line-width': ['+', ['case', ['==', ['get', 'recommended'], 1], 7, 4], ['case', ['any', isSelected, isHovered], 3, 1]],
                }}
              />
              <Layer
                id="route-line"
                type="line"
                layout={{ 'line-cap': 'round', 'line-join': 'round', 'line-sort-key': ['case', isSelected, 2, isHovered, 1, 0] }}
                paint={{
                  'line-color': ['case', ['any', isSelected, isHovered, ['==', ['get', 'recommended'], 1]], colors.main, colors.other],
                  'line-width': ['case', ['==', ['get', 'recommended'], 1], 7, 4],
                }}
              />
            </Source>
            <Source id="checkpoints" type="geojson" data={checkpointPoints}>
              <Layer
                id="checkpoints"
                type="circle"
                paint={{
                  'circle-radius': ['case', ['==', ['get', 'index'], active?.index ?? -1], 9, 6],
                  'circle-color': levelColor(scheme),
                  'circle-stroke-width': 2,
                  'circle-stroke-color': scheme === 'dark' ? '#0f1519' : '#ffffff',
                }}
              />
            </Source>
            <Marker longitude={result.origin.lon} latitude={result.origin.lat} anchor="center">
              <TripOriginIcon titleAccess={`Origin: ${result.origin.label}`} sx={{ color: 'text.primary', bgcolor: 'background.paper', borderRadius: '50%' }} />
            </Marker>
            <Marker longitude={result.destination.lon} latitude={result.destination.lat} anchor="bottom-left">
              <FlagIcon titleAccess={`Destination: ${result.destination.label}`} sx={{ color: 'text.primary', fontSize: 30, filter: 'drop-shadow(0 1px 2px rgb(0 0 0 / .4))' }} />
            </Marker>
          </>
        )}
        {activeCheckpoint && (
          <Popup
            longitude={activeCheckpoint.lon}
            latitude={activeCheckpoint.lat}
            offset={14}
            closeOnClick={false}
            maxWidth="260px"
            onClose={() => onActivate(null)}
          >
            <Stack sx={{ gap: 0.5 }}>
              <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
                <LevelBadge level={activeCheckpoint.level} />
                <Typography variant="body2" sx={{ fontWeight: 700 }}>
                  Mile {activeCheckpoint.mile}
                </Typography>
              </Stack>
              <Typography variant="body2">ETA {formatEta(activeCheckpoint.eta)}</Typography>
              <Typography variant="body2">
                Wind {formatNumber(activeCheckpoint.windMph, 0, 'mph')}
                {activeCheckpoint.gustMph !== null && ` (gusts ${activeCheckpoint.gustMph.toFixed(0)})`}
              </Typography>
              <Typography variant="body2">Rain {formatNumber(activeCheckpoint.rainInHr, 2, 'in/h')}</Typography>
              <Typography variant="body2">Snow {formatNumber(activeCheckpoint.snowInHr, 2, 'in/h')}</Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                {activeCheckpoint.reason}
              </Typography>
            </Stack>
          </Popup>
        )}
      </Map>
    </Box>
  )
}
