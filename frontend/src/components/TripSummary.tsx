import EditIcon from '@mui/icons-material/Edit'
import Button from '@mui/material/Button'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import type { AnalyzeResponse } from '../types/api'

/** Phone view of the submitted trip: leaves the sheet's height to the results. */
export function TripSummary({ result, onEdit }: { result: AnalyzeResponse; onEdit: () => void }) {
  const departs = new Date(result.departure).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  return (
    <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
      <div>
        <Typography variant="body2" sx={{ fontWeight: 700 }}>
          {result.origin.label} → {result.destination.label}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {departs} · {result.loadLb.toLocaleString('en-US')} lb · every {result.spacingMi} mi
        </Typography>
      </div>
      <Button size="small" startIcon={<EditIcon />} onClick={onEdit}>
        Edit
      </Button>
    </Stack>
  )
}
