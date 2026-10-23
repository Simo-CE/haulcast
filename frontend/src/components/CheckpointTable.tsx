import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import type { Checkpoint } from '../types/api'
import { LevelBadge } from './LevelBadge'

interface Props {
  checkpoints: Checkpoint[]
  activeIndex: number | null
  onActivate: (index: number) => void
}

const num = (value: number | null, digits = 0): string => (value === null ? 'n/a' : value.toFixed(digits))

/** Keyboard-reachable twin of the map's checkpoint circles. */
export function CheckpointTable({ checkpoints, activeIndex, onActivate }: Props) {
  return (
    <TableContainer sx={{ maxHeight: 280 }}>
      <Table
        size="small"
        stickyHeader
        aria-label="Checkpoints along the route"
        sx={{ '& th, & td': { px: 0.75, py: 0.5 } }}
      >
        <TableHead>
          <TableRow>
            <TableCell>Mile</TableCell>
            <TableCell>ETA (local)</TableCell>
            <TableCell align="right">Wind mph</TableCell>
            <TableCell align="right">Rain in/h</TableCell>
            <TableCell align="right">Snow in/h</TableCell>
            <TableCell>Risk</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {checkpoints.map((cp, i) => (
            <TableRow
              key={cp.mile}
              hover
              selected={i === activeIndex}
              tabIndex={0}
              onClick={() => onActivate(i)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onActivate(i)
                }
              }}
              sx={{ cursor: 'pointer' }}
            >
              <TableCell>{cp.mile}</TableCell>
              <TableCell sx={{ whiteSpace: 'nowrap' }}>{new Date(cp.eta).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' })}</TableCell>
              <TableCell align="right">{num(cp.windMph)}</TableCell>
              <TableCell align="right">{num(cp.rainInHr, 2)}</TableCell>
              <TableCell align="right">{num(cp.snowInHr, 2)}</TableCell>
              <TableCell>
                <LevelBadge level={cp.level} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  )
}
