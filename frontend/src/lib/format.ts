export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  return h === 0 ? `${m} min` : `${h} h ${String(m).padStart(2, '0')} min`
}

export function formatMiles(miles: number): string {
  return `${Math.round(miles).toLocaleString('en-US')} mi`
}

/** Browser-local clock time with the zone, e.g. "Sat 8:30 AM MDT". */
export function formatEta(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  })
}

/** Local clock time without the zone, for places that already say "local": "Sat 4:01 AM". */
export function formatClock(iso: string): string {
  return new Date(iso).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' })
}

export function formatNumber(value: number | null, digits: number, unit: string): string {
  return value === null ? 'n/a' : `${value.toFixed(digits)} ${unit}`
}
