import { createTheme } from '@mui/material/styles'

export const FONT = '"DM Sans Variable", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
export const CARD_RADIUS = '12px'

/*
 * Type scale (px): 10.5 caps label, 11 caption, 12 secondary, 13 body and inputs, 14 card title,
 * 20 route time, 24 verdict and hero. Every component takes its size from a variant below, so sizes do not drift.
 *
 * Palette "midnight and mist": ink navy on cool grey paper, with aqua as the one accent. Aqua is not in the
 * risk ramp (lib/risk.ts: blue, yellow, orange, red, purple), so the brand never reads as a risk level.
 */
export const theme = createTheme({
  cssVariables: { colorSchemeSelector: 'data' },
  colorSchemes: {
    light: {
      palette: {
        primary: { main: '#0f1b2d', contrastText: '#ffffff' },
        secondary: { main: '#2bd4c0', contrastText: '#06231f' },
        background: { default: '#f1f4f9', paper: '#ffffff' },
        text: { primary: '#182235', secondary: '#586579' },
        divider: '#dfe5ee',
      },
    },
    dark: {
      palette: {
        primary: { main: '#e7edf6', contrastText: '#0b1220' },
        secondary: { main: '#2bd4c0', contrastText: '#06231f' },
        background: { default: '#0a0f19', paper: '#121a28' },
        text: { primary: '#e7edf6', secondary: '#9aa8bd' },
        divider: '#232e42',
      },
    },
  },
  shape: { borderRadius: 10 },
  typography: {
    fontFamily: FONT,
    fontSize: 13,
    htmlFontSize: 16,
    h1: { fontSize: '1.5rem', fontWeight: 560, letterSpacing: '-0.035em', lineHeight: 1.2 },
    h2: { fontSize: '0.875rem', fontWeight: 600, letterSpacing: '-0.015em', lineHeight: 1.35 },
    h3: { fontSize: '0.65625rem', fontWeight: 650, letterSpacing: '0.12em', textTransform: 'uppercase', lineHeight: 1.4 },
    body1: { fontSize: '0.8125rem', lineHeight: 1.5 },
    body2: { fontSize: '0.75rem', lineHeight: 1.5 },
    caption: { fontSize: '0.6875rem', lineHeight: 1.4 },
    button: { fontSize: '0.8125rem', textTransform: 'none', fontWeight: 600, letterSpacing: '-0.01em' },
  },
  components: {
    MuiButton: { defaultProps: { disableElevation: true }, styleOverrides: { root: { borderRadius: 10 } } },
    MuiTextField: { defaultProps: { size: 'small', fullWidth: true } },
    MuiOutlinedInput: { styleOverrides: { root: { fontSize: '0.8125rem', minHeight: 40, borderRadius: 10 }, input: { padding: '9px 12px', fontSize: '0.8125rem' } } },
    MuiFormHelperText: { styleOverrides: { root: { fontSize: '0.6875rem', marginLeft: 2, marginRight: 2 } } },
    MuiCard: { defaultProps: { variant: 'outlined' } },
    MuiChip: { styleOverrides: { root: { fontWeight: 600, fontSize: '0.6875rem', height: 24 } } },
    MuiToggleButton: { styleOverrides: { root: { fontSize: '0.75rem', padding: '7px 10px', textTransform: 'none' } } },
    MuiTableCell: { styleOverrides: { root: { fontSize: '0.6875rem' } } },
    MuiAlert: { styleOverrides: { root: { fontSize: '0.75rem', padding: '4px 12px' }, message: { padding: '6px 0' } } },
    MuiAutocomplete: {
      styleOverrides: {
        inputRoot: { padding: '0 9px !important' },
        input: { padding: '9px 3px !important' },
        option: { fontSize: '0.8125rem' },
      },
    },
  },
})
