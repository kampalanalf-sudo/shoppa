export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

export const money = (v: number, decimals = 2) =>
  v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })

export const coin = (v: number) => `${money(v)} FB`

export const compact = (v: number) =>
  Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(v)

export const mult = (v: number) => `${v.toFixed(2)}×`

export const pct = (v: number, d = 1) => `${(v * 100).toFixed(d)}%`

export const shortHash = (h: string, n = 6) => (h ? `${h.slice(0, n)}…${h.slice(-n)}` : '—')

export const timeAgo = (ts: number) => {
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000))
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

export const uid = () => Math.random().toString(36).slice(2, 10)
