import LinearProgress from '@mui/material/LinearProgress'
import Skeleton from '@mui/material/Skeleton'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { useEffect, useState } from 'react'
import { stageText } from '../lib/stageText'

export function AnalysisProgress() {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setElapsed((s) => s + 1), 1000)
    return () => clearInterval(id)
  }, [])
  return (
    <Stack aria-busy="true" sx={{ gap: 1.5 }}>
      <div>
        <Typography variant="body2" role="status" sx={{ fontWeight: 600, mb: 0.75 }}>
          {stageText(elapsed)}
        </Typography>
        <LinearProgress aria-label="Analysing trip" />
      </div>
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} variant="rounded" height={132} animation="wave" />
      ))}
    </Stack>
  )
}
