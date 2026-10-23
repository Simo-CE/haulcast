import Box from '@mui/material/Box'
import Card from '@mui/material/Card'
import { useTheme } from '@mui/material/styles'
import Divider from '@mui/material/Divider'
import Stack from '@mui/material/Stack'
import useMediaQuery from '@mui/material/useMediaQuery'
import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { analyze, ApiError } from './api/client'
import { BottomSheet } from './components/BottomSheet'
import { Header } from './components/Header'
import { ResultsView } from './components/ResultsView'
import { type ActiveCheckpoint, RouteMap } from './components/RouteMap'
import { TripForm } from './components/TripForm'
import { TripSummary } from './components/TripSummary'
import { SHEET_FULL, SHEET_HALF, SNAPS } from './lib/sheet'
import { type FormErrors, initialValues, type TripFormValues } from './lib/tripForm'
import type { AnalyzeRequest } from './types/api'

export default function App() {
  const desktop = useMediaQuery(useTheme().breakpoints.up('md'))
  const [values, setValues] = useState<TripFormValues>(initialValues)
  const [lastRequest, setLastRequest] = useState<AnalyzeRequest | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [active, setActive] = useState<ActiveCheckpoint | null>(null)
  const [snap, setSnap] = useState(SHEET_HALF)
  const [editing, setEditing] = useState(false)

  const mutation = useMutation({
    mutationFn: (request: AnalyzeRequest) => analyze(request),
    onSuccess: (data) => {
      setSelectedId(data.recommendedRouteId)
      setActive(null)
      setSnap(SHEET_HALF) // show the map and the first card together
    },
  })

  const run = (request: AnalyzeRequest) => {
    setLastRequest(request)
    setEditing(false)
    mutation.mutate(request)
  }

  const error = mutation.error
  const serverErrors: FormErrors = error instanceof ApiError && error.kind === 'validation' ? (error.fields as FormErrors) : {}
  const result = mutation.data ?? null

  const showSummary = result && !editing && !mutation.isPending && !error
  const form = showSummary ? (
    <TripSummary
      result={result}
      onEdit={() => {
        setEditing(true)
        if (!desktop) setSnap(SHEET_FULL)
      }}
    />
  ) : (
    <TripForm
      values={values}
      onChange={setValues}
      onSubmit={run}
      loading={mutation.isPending}
      serverErrors={serverErrors}
      compact={!desktop}
    />
  )

  const panel = (
    <Stack sx={{ gap: 2.5, p: desktop ? 2.5 : 0, pt: desktop ? 2.5 : 0.5 }}>
      {!desktop && <Header showTagline={false} />}
      {desktop ? <Card sx={{ p: 2.25, borderRadius: '13px' }}>{form}</Card> : form}
      {!desktop && <Divider />}
      <ResultsView
        pending={mutation.isPending}
        error={error}
        result={result}
        selectedId={selectedId}
        active={active}
        onRetry={() => lastRequest && run(lastRequest)}
        onSelect={(id) => {
          setSelectedId(id)
          setActive(null)
        }}
        onHover={setHoveredId}
        onActivate={setActive}
      />
    </Stack>
  )

  const map = (
    <RouteMap
      result={result}
      selectedId={selectedId}
      hoveredId={hoveredId}
      active={active}
      bottomInset={desktop ? 0 : Math.min(SNAPS[snap], SNAPS[SHEET_HALF]) * window.innerHeight}
      onSelectRoute={setSelectedId}
      onActivate={setActive}
    />
  )

  if (desktop) {
    return (
      <Box sx={{ display: 'grid', gridTemplate: '56px 1fr / 460px 1fr', height: '100dvh', bgcolor: 'background.default' }}>
        <Box sx={{ gridColumn: '1 / -1', borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper' }}>
          <Header showTagline />
        </Box>
        <Box component="main" sx={{ overflowY: 'auto', borderRight: 1, borderColor: 'divider' }}>
          {panel}
        </Box>
        <Box sx={{ position: 'relative' }}>{map}</Box>
      </Box>
    )
  }
  return (
    <Box component="main" sx={{ position: 'relative', height: '100dvh', overflow: 'hidden' }}>
      {map}
      <BottomSheet snap={snap} onSnap={setSnap}>
        {panel}
      </BottomSheet>
    </Box>
  )
}

