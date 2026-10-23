import Alert from '@mui/material/Alert'
import AlertTitle from '@mui/material/AlertTitle'
import Stack from '@mui/material/Stack'
import { formatMiles } from '../lib/format'
import type { AnalyzeResponse } from '../types/api'

/** Banners that change how the result should be read: No Travel, unknown data, fewer than 3 routes. */
export function Notices({ result }: { result: AnalyzeResponse }) {
  const recommended = result.routes.find((r) => r.id === result.recommendedRouteId)
  const hit = result.routes.filter((r) => r.milesByLevel['No Travel'] > 0)
  const unknownMi = result.routes.reduce((sum, r) => sum + r.unknownMi, 0)
  const allBlocked = hit.length === result.routes.length

  return (
    <Stack sx={{ gap: 1 }}>
      {recommended && recommended.milesByLevel['No Travel'] > 0 && (
        <Alert severity="error" variant="filled">
          <AlertTitle>No Travel conditions on every route</AlertTitle>
          Even the best option, {recommended.name}, has {formatMiles(recommended.milesByLevel['No Travel'])} of No
          Travel weather for this load and departure. Consider another departure time.
        </Alert>
      )}
      {!allBlocked && hit.length > 0 && (
        <Alert severity="warning">
          {hit.map((r) => `${r.name} has ${formatMiles(r.milesByLevel['No Travel'])} of No Travel weather`).join('; ')}.
        </Alert>
      )}
      {unknownMi > 0 && (
        <Alert severity="warning">
          Forecast data is missing for part of this trip. Those miles are shown as Unknown, not Low.
        </Alert>
      )}
      {!result.complete && (
        <Alert severity="info">
          We found only {result.routes.length} reasonable truck {result.routes.length === 1 ? 'route' : 'routes'} for
          this trip, so that is all we show.
        </Alert>
      )}
      {result.warnings
        .filter((w) => result.complete || !/distinct route/i.test(w))
        .map((w) => (
          <Alert key={w} severity="info">
            {w}
          </Alert>
        ))}
    </Stack>
  )
}
