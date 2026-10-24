import { useColorScheme } from '@mui/material/styles'
import type { CanvasSource } from 'maplibre-gl'
import { useEffect, useMemo } from 'react'
import { useMap } from 'react-map-gl/maplibre'
import { buildGrid, buildRaster, corners, makeLut, paintField, valuesAt } from '../lib/heatField'
import type { Heatmap, Route } from '../types/api'
import { useTimelineContext } from './timelineContext'

const ID = 'risk-heat'

/**
 * The weather heat, drawn as a small canvas that MapLibre stretches over the corridor with linear filtering.
 * All 49 hours are already in the browser: a new hour only repaints the canvas (no network, no re-parse),
 * and the grid is smoothed by bilinear weights, so scrubbing and playback are continuous.
 */
export function HeatmapLayer({ heatmap, routes }: { heatmap: Heatmap; routes: Route[] }) {
  const { current: mapRef } = useMap()
  const { colorScheme } = useColorScheme()
  const scheme = colorScheme === 'dark' ? 'dark' : 'light'
  const { hour, showHeat } = useTimelineContext()

  const model = useMemo(() => {
    const grid = buildGrid(heatmap)
    const raster = buildRaster(grid, routes.map((r) => r.geometry))
    const canvas = document.createElement('canvas')
    canvas.width = raster.width
    canvas.height = raster.height
    const image = new ImageData(raster.width, raster.height)
    return { grid, raster, canvas, image, values: new Float32Array(grid.count) }
  }, [heatmap, routes])
  const lut = useMemo(() => makeLut(scheme), [scheme])

  // the source and layer live in the style, so they are added again after a light/dark style swap
  useEffect(() => {
    const map = mapRef?.getMap()
    if (!map) return
    const add = () => {
      if (map.getSource(ID)) return
      try {
        map.addSource(ID, { type: 'canvas', canvas: model.canvas, coordinates: corners(model.raster.bounds), animate: false })
        // above land and water, below every road and label, so the road lines stay readable through the heat
        const beforeId = map.getStyle().layers.find((l) => ['transportation', 'aeroway'].includes((l as { 'source-layer'?: string })['source-layer'] ?? ''))?.id
        map.addLayer({ id: ID, type: 'raster', source: ID, paint: { 'raster-fade-duration': 0 } }, beforeId)
      } catch {
        // isStyleLoaded() stays false while tiles load, so just try again on the next styledata
        if (map.getSource(ID)) map.removeSource(ID)
      }
    }
    add()
    map.on('styledata', add)
    return () => {
      map.off('styledata', add)
      if (map.getLayer(ID)) map.removeLayer(ID)
      if (map.getSource(ID)) map.removeSource(ID)
    }
  }, [mapRef, model])

  // One repaint per animation frame, whatever the number of slider events: the latest hour wins.
  useEffect(() => {
    const map = mapRef?.getMap()
    if (!showHeat) {
      if (map?.getLayer(ID)) map.setLayoutProperty(ID, 'visibility', 'none')
      return
    }
    const frame = requestAnimationFrame(() => {
      paintField(model.raster, valuesAt(model.grid, hour, model.values), lut, model.image.data)
      model.canvas.getContext('2d')?.putImageData(model.image, 0, 0)
      if (!map) return
      if (map.getLayer(ID)) map.setLayoutProperty(ID, 'visibility', 'visible')
      // upload the canvas for the next frame only, instead of re-uploading it on every frame forever
      const source = map.getSource<CanvasSource>(ID)
      source?.play()
      map.once('render', () => source?.pause())
    })
    return () => cancelAnimationFrame(frame)
  }, [mapRef, model, lut, hour, showHeat])

  return null
}
