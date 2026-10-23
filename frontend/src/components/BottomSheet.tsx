import Box from '@mui/material/Box'
import { SNAPS } from '../lib/sheet'
import { type KeyboardEvent, type PointerEvent, type ReactNode, useRef, useState } from 'react'

interface Props {
  snap: number
  onSnap: (snap: number) => void
  children: ReactNode
}

/** Draggable bottom sheet for phones. The handle is also a button: click cycles, arrow keys step. */
export function BottomSheet({ snap, onSnap, children }: Props) {
  const [dragPx, setDragPx] = useState<number | null>(null)
  const start = useRef<{ y: number; height: number; moved: boolean } | null>(null)
  const viewport = () => window.innerHeight

  const onPointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    start.current = { y: e.clientY, height: SNAPS[snap] * viewport(), moved: false }
  }
  const onPointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    if (!start.current) return
    const dy = e.clientY - start.current.y
    if (Math.abs(dy) > 4) start.current.moved = true
    const px = start.current.height - dy
    setDragPx(Math.min(SNAPS[2] * viewport(), Math.max(SNAPS[0] * viewport(), px)))
  }
  const onPointerUp = () => {
    const s = start.current
    start.current = null
    if (s?.moved && dragPx !== null) {
      const share = dragPx / viewport()
      onSnap(SNAPS.reduce((best, v, i) => (Math.abs(v - share) < Math.abs(SNAPS[best] - share) ? i : best), 0))
    } else if (s) {
      onSnap((snap + 1) % SNAPS.length)
    }
    setDragPx(null)
  }
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowUp') onSnap(Math.min(SNAPS.length - 1, snap + 1))
    if (e.key === 'ArrowDown') onSnap(Math.max(0, snap - 1))
  }

  return (
    <Box
      sx={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        height: dragPx ?? `${SNAPS[snap] * 100}dvh`,
        transition: dragPx === null ? 'height .25s ease' : 'none',
        '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
        bgcolor: 'background.paper',
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        boxShadow: '0 -4px 24px rgb(0 0 0 / 0.22)',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 2,
      }}
    >
      <Box
        component="button"
        type="button"
        aria-label="Resize panel"
        aria-expanded={snap > 0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          start.current = null
          setDragPx(null)
        }}
        onKeyDown={onKeyDown}
        sx={{
          all: 'unset',
          boxSizing: 'border-box',
          display: 'flex',
          justifyContent: 'center',
          py: 1.25,
          cursor: 'grab',
          touchAction: 'none',
          flexShrink: 0,
          '&:focus-visible > span': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 },
        }}
      >
        <Box component="span" sx={{ width: 44, height: 5, borderRadius: 3, bgcolor: 'text.disabled' }} />
      </Box>
      <Box sx={{ flex: 1, overflowY: 'auto', px: 2, pb: 'calc(16px + env(safe-area-inset-bottom))' }}>{children}</Box>
    </Box>
  )
}
