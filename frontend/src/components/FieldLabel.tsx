import Typography from '@mui/material/Typography'
import type { ReactNode } from 'react'

/** Label above a field: one place sets the size and spacing, so every field lines up. */
export function FieldLabel({ htmlFor, children }: { htmlFor: string; children: ReactNode }) {
  return (
    <Typography component="label" htmlFor={htmlFor} variant="body2" sx={{ display: 'block', fontWeight: 600, mb: 0.5 }}>
      {children}
    </Typography>
  )
}
