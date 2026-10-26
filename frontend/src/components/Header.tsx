import DarkModeIcon from '@mui/icons-material/DarkMode'
import LightModeIcon from '@mui/icons-material/LightMode'
import LocalShippingIcon from '@mui/icons-material/LocalShipping'
import Box from '@mui/material/Box'
import IconButton from '@mui/material/IconButton'
import Stack from '@mui/material/Stack'
import { useColorScheme } from '@mui/material/styles'
import Typography from '@mui/material/Typography'
import { BRAND, TAGLINE } from '../lib/brand'
import { FONT } from '../theme'

function ThemeToggle() {
  const { colorScheme, setMode } = useColorScheme()
  const dark = colorScheme === 'dark'
  return (
    <IconButton aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'} onClick={() => setMode(dark ? 'light' : 'dark')}>
      {dark ? <LightModeIcon /> : <DarkModeIcon />}
    </IconButton>
  )
}

export function Brand() {
  return (
    <Stack direction="row" sx={{ alignItems: 'center', gap: 1.25 }}>
      <Box sx={{ width: 30, height: 30, borderRadius: '10px', display: 'grid', placeItems: 'center', bgcolor: 'primary.main', color: 'primary.contrastText' }}>
        <LocalShippingIcon sx={{ fontSize: 18 }} />
      </Box>
      <Typography component="h1" sx={{ m: 0, fontFamily: FONT, fontSize: '1.25rem', fontWeight: 700, letterSpacing: '-0.05em' }}>
        {BRAND}
      </Typography>
    </Stack>
  )
}

export function Header({ showTagline }: { showTagline: boolean }) {
  return (
    <Stack direction="row" component="header" sx={{ alignItems: 'center', justifyContent: 'space-between', px: { xs: 0, md: 3 }, height: { md: 56 } }}>
      <Stack direction="row" sx={{ alignItems: 'center', gap: 2 }}>
        <Brand />
        {showTagline && (
          <Typography variant="body2" color="text.secondary" sx={{ borderLeft: 1, borderColor: 'divider', pl: 2 }}>
            {TAGLINE}
          </Typography>
        )}
      </Stack>
      <ThemeToggle />
    </Stack>
  )
}
