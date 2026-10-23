import Box from '@mui/material/Box'

/** Letter chip tying a card to its line on the map ("Route B" -> B). */
export function RouteBadge({ name, selected = true, size = 28 }: { name: string; selected?: boolean; size?: number }) {
  return (
    <Box
      component="span"
      aria-hidden
      sx={{
        width: size,
        height: size,
        flexShrink: 0,
        display: 'inline-grid',
        placeItems: 'center',
        borderRadius: '50%',
        fontSize: size * 0.5,
        fontWeight: 800,
        bgcolor: selected ? 'primary.main' : 'background.paper',
        color: selected ? 'primary.contrastText' : 'text.primary',
        border: 2,
        borderColor: 'primary.main',
      }}
    >
      {name.slice(-1)}
    </Box>
  )
}
