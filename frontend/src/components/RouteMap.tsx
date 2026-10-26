import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { useColorScheme } from '@mui/material/styles'
import { setWorkerUrl } from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import type { ExpressionSpecification, LngLatBoundsLike, MapLayerMouseEvent, StyleSpecification } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import Map, { Layer, Marker, NavigationControl, Popup, Source, type MapRef } from 'react-map-gl/maplibre'
import { formatEta, formatNumber } from '../lib/format'
import { loadBaseStyle, plainStyle, restyle } from '../lib/mapStyle'
import { LEVEL_STYLES } from '../lib/risk'
import type { AnalyzeResponse, Place } from '../types/api'
import { LevelBadge } from './LevelBadge'
import { PlaceMarker, PREVIEW_FLIGHT_MS } from './PlaceMarker'
import { MapLegend } from './MapLegend'
import { RouteBadge } from './RouteBadge'

// Vite does not emit maplibre 6's worker file on its own; without this the deployed map 404s on /assets/maplibre-gl-worker.mjs.
setWorkerUrl(workerUrl)

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
  /** places chosen in the form before any analysis: the map shows them and keeps them in view */
  preview: { origin: Place | null; destination: Place | null }
  /** a long press on the map: the app decides whether it sets the origin or the destination */
  onLongPress: (lon: number, lat: number) => void
  /** Slot for layers drawn under the routes (heatmap) */
  children?: ReactNode
}

/** how long a press has to be held to count as a long press */
const LONG_PRESS_MS = 550

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

export function RouteMap({ result, selectedId, hoveredId, active, bottomInset, onSelectRoute, onActivate, preview, onLongPress, children }: Props) {
  const { colorScheme } = useColorScheme()
  const scheme = colorScheme === 'dark' ? 'dark' : 'light'
  const colors = ROUTE_COLORS[scheme]
  const mapRef = useRef<MapRef>(null)
  const [loaded, setLoaded] = useState(false)
  const [cursor, setCursor] = useState('')
  const [baseStyle, setBaseStyle] = useState<StyleSpecification | null>(null)
  const [styleFailed, setStyleFailed] = useState(false)
  const [styleAttempt, setStyleAttempt] = useState(0)
  useEffect(() => {
    loadBaseStyle().then(
      (style) => {
        setBaseStyle(style)
        setStyleFailed(false)
      },
      () => setStyleFailed(true),
    )
  }, [styleAttempt])
  // a blank map would hide the routes too: fall back to a plain background and say so
  const mapStyle = useMemo(
    () => (baseStyle ? restyle(baseStyle, scheme) : styleFailed ? plainStyle(scheme) : null),
    [baseStyle, styleFailed, scheme],
  )

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

  // Before any analysis: fly to a single chosen place, or fit both places in view (zooming out as far as needed).
  const { origin: previewOrigin, destination: previewDestination } = preview
  useEffect(() => {
    const map = mapRef.current
    if (result || !loaded || !map) return
    const duration = prefersReducedMotion() ? 0 : PREVIEW_FLIGHT_MS
    if (previewOrigin && previewDestination) {
      const [a, b] = [previewOrigin, previewDestination]
      map.fitBounds(
        [[Math.min(a.lon, b.lon), Math.min(a.lat, b.lat)], [Math.max(a.lon, b.lon), Math.max(a.lat, b.lat)]],
        { padding: { top: 90, left: 60, right: 60, bottom: bottomInset + 70 }, duration, maxZoom: 10 },
      )
    } else if (previewOrigin || previewDestination) {
      const place = (previewOrigin ?? previewDestination)!
      // offset keeps the place in the part of the map the phone sheet leaves free
      if (!map.getBounds().contains([place.lon, place.lat])) {
        map.flyTo({ center: [place.lon, place.lat], zoom: Math.max(map.getZoom(), 7), offset: [0, -bottomInset / 2], duration })
      }
    }
  }, [previewOrigin, previewDestination, result, loaded, bottomInset])

  // Press and hold sets the next empty place (see App). Moving, zooming or lifting before the delay cancels it.
  const pressTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const swallowClick = useRef(false)
  const cancelPress = () => clearTimeout(pressTimer.current)
  const startPress = (event: { lngLat: { lng: number; lat: number } }) => {
    if (result) return
    cancelPress()
    pressTimer.current = setTimeout(() => {
      swallowClick.current = true // the release that follows is not a click
      setTimeout(() => (swallowClick.current = false), 500)
      onLongPress(event.lngLat.lng, event.lngLat.lat)
    }, LONG_PRESS_MS)
  }
  useEffect(() => cancelPress, [])
  useEffect(() => {
    // a long press on a phone would otherwise open the browser's own menu over the map
    const container = mapRef.current?.getContainer()
    const stop = (e: Event) => e.preventDefault()
    container?.addEventListener('contextmenu', stop)
    return () => container?.removeEventListener('contextmenu', stop)
  }, [loaded])

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
    if (swallowClick.current) return
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
      {!result && !(previewOrigin && previewDestination) && (
        <Paper
          elevation={3}
          sx={{ position: 'absolute', zIndex: 1, left: '50%', transform: 'translateX(-50%)', bottom: bottomInset + 28, px: 1.75, py: 0.75, borderRadius: '999px', maxWidth: 'calc(100% - 24px)', pointerEvents: 'none' }}
        >
          <Typography variant="caption" sx={{ fontWeight: 600 }}>
            Press and hold on the map to set your {previewOrigin ? 'destination' : 'origin'}
          </Typography>
        </Paper>
      )}
      {styleFailed && !baseStyle && (
        <Alert
          severity="warning"
          sx={{ position: 'absolute', zIndex: 1, left: 12, right: 12, top: { xs: 76, md: 60 }, width: 'fit-content', maxWidth: 420 }}
          action={<Button color="inherit" size="small" onClick={() => setStyleAttempt((n) => n + 1)}>Retry</Button>}
        >
          The street map could not be loaded. Routes and weather still work on a plain background.
        </Alert>
      )}
      {mapStyle && (
      <Map
        ref={mapRef}
        mapStyle={mapStyle}
        initialViewState={{ longitude: -98.5, latitude: 39.5, zoom: 3.6 }}
        attributionControl={{ compact: true }}
        interactiveLayerIds={['checkpoints', 'route-line']}
        cursor={cursor}
        onLoad={() => setLoaded(true)}
        onClick={onClick}
        onMouseDown={startPress}
        onTouchStart={(e) => (e.originalEvent.touches.length > 1 ? cancelPress() : startPress(e))}
        onMouseUp={cancelPress}
        onTouchEnd={cancelPress}
        onTouchCancel={cancelPress}
        onDragStart={cancelPress}
        onZoomStart={cancelPress}
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
            <PlaceMarker kind="origin" place={result.origin} />
            <PlaceMarker kind="destination" place={result.destination} />
          </>
        )}
        {!result && previewOrigin && <PlaceMarker key={`o${previewOrigin.lat},${previewOrigin.lon}`} kind="origin" place={previewOrigin} hop />}
        {!result && previewDestination && <PlaceMarker key={`d${previewDestination.lat},${previewDestination.lon}`} kind="destination" place={previewDestination} hop />}
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
      )}
    </Box>
  )
}
