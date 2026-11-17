export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

/**
 * Money is displayed in Ugandan Shillings. Amounts are UGX integers -- the
 * shilling has no meaningful sub-unit in practice, so we never show decimals
 * for a fiat amount.
 */
export const money = (v: number) => Math.round(v).toLocaleString('en-UG')

/** Fiat amount with the UGX prefix, e.g. "UGX 25,000". */
export const ugx = (v: number) => `UGX ${money(v)}`

/** ProxiCoin -- the in-game coin. Balances are whole coins. */
export const PROXICOIN = 'PX'

/** ProxiCoin amount with ticker, e.g. "1,250 PX". */
export const coin = (v: number) => `${money(v)} ${PROXICOIN}`

/** Compact ProxiCoin amount for tight spaces, e.g. "1.2K PX". */
export const coinCompact = (v: number) => `${compact(v)} ${PROXICOIN}`

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
