// The API is one request, so these steps are time-based hints about what the backend does, not real progress.
const STAGES: [afterSec: number, text: string][] = [
  [0, 'Finding truck routes…'],
  [3, 'Fetching forecasts along each route…'],
  [6, 'Rating checkpoints and ranking routes…'],
  [11, 'Still working. Long trips can take up to 20 s.'],
]

export function stageText(elapsedSec: number): string {
  return STAGES.filter(([after]) => elapsedSec >= after).at(-1)![1]
}
