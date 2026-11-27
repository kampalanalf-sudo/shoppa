export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

/**
 * Money is displayed in Ugandan Shillings. Amounts are UGX integers -- the
 * shilling has no meaningful sub-unit in practice, so we never show decimals
 * for an amount.
 */
export const money = (v: number) => Math.round(v).toLocaleString('en-UG')

/** Fiat amount with the UGX prefix, e.g. "UGX 25,000". */
export const ugx = (v: number) => `UGX ${money(v)}`

/**
 * A stake or a balance, always labelled with its currency.
 *
 * `stake()` and `ugx()` are the same function on purpose: the label must never
 * depend on context, because the one place it silently does is the place a
 * player sees a number they think is shillings and it is not.
 */
export const stake = (v: number) => `UGX ${money(v)}`

/** Compact amount for tight spaces, e.g. "1.2M". */
export const compact = (v: number) =>
  Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(v)

/** Compact amount with currency, e.g. "1.2M UGX". */
export const compactUgx = (v: number) => `${compact(v)} UGX`

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
