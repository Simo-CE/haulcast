import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { ApiError } from '../api/client'
import { FONT } from '../theme'
import type { AnalyzeResponse } from '../types/api'
import { AnalysisProgress } from './AnalysisProgress'
import { Notices } from './Notices'
import { RouteCard } from './RouteCard'
import { Verdict } from './Verdict'
import type { ActiveCheckpoint } from './RouteMap'

interface Props {
  pending: boolean
  error: Error | null
  result: AnalyzeResponse | null
  selectedId: string | null
  active: ActiveCheckpoint | null
  onRetry: () => void
  onSelect: (id: string) => void
  onHover: (id: string | null) => void
  onActivate: (active: ActiveCheckpoint | null) => void
}

const STEPS = [
  ['Routes', 'Up to three real truck routes, with the drive time to every point.'],
  ['Weather at your ETA', 'The forecast for the hour your truck reaches each checkpoint, not the hour you leave.'],
  ['Risk for your load', 'Wind, rain and snow rated against your payload, then ranked: safest first.'],
]

function EmptyState() {
  return (
    <Stack sx={{ gap: 2, py: 1 }}>
      <Typography variant="h3" component="p" color="text.secondary">
        How it works
      </Typography>
      <Typography variant="h1" component="h2" sx={{ maxWidth: 340 }}>
        Plan around the weather, not through it.
      </Typography>
      {STEPS.map(([title, text], i) => (
        <Stack key={title} direction="row" sx={{ gap: 1.5 }}>
          <Typography sx={{ fontFamily: FONT, fontSize: '0.8125rem', fontWeight: 650, color: 'text.secondary', width: 18, pt: '2px' }}>
            {i + 1}
          </Typography>
          <div>
            <Typography variant="h2" component="p">
              {title}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {text}
            </Typography>
          </div>
        </Stack>
      ))}
    </Stack>
  )
}

export function ResultsView({ pending, error, result, selectedId, active, onRetry, onSelect, onHover, onActivate }: Props) {
  let body
  if (pending) {
    body = <AnalysisProgress />
  } else if (error) {
    // 400s are shown on the form fields; anything else is a service problem the user can retry
    const retryable = !(error instanceof ApiError) || error.kind !== 'validation'
    body = (
      <Alert
        severity={retryable ? 'error' : 'warning'}
        action={retryable ? <Button color="inherit" size="small" onClick={onRetry}>Retry</Button> : undefined}
      >
        {error.message}
      </Alert>
    )
  } else if (result) {
    const ranks = new Map(result.ranking.map((r) => [r.routeId, r]))
    body = (
      <Stack sx={{ gap: 1.5 }}>
        <Verdict result={result} />
        <Notices result={result} />
        <Typography variant="h3" component="h2" sx={{ color: 'text.secondary' }}>
          Route options · {result.routes.length}, best first
        </Typography>
        {[...result.routes]
          .sort((a, b) => (ranks.get(a.id)?.rank ?? 99) - (ranks.get(b.id)?.rank ?? 99))
          .map((route) => (
            <RouteCard
              key={route.id}
              route={route}
              ranking={ranks.get(route.id)}
              recommended={route.id === result.recommendedRouteId}
              selected={route.id === selectedId}
              activeCheckpoint={active?.routeId === route.id ? active.index : null}
              onSelect={() => onSelect(route.id)}
              onHover={(hovering) => onHover(hovering ? route.id : null)}
              onActivateCheckpoint={(index) => onActivate({ routeId: route.id, index })}
            />
          ))}
      </Stack>
    )
  } else {
    body = <EmptyState />
  }
  return (
    <div aria-live="polite" aria-busy={pending}>
      {body}
    </div>
  )
}
