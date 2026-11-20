/**
 * ProxiCash -- crypto-to-mobile-money exchange.
 *
 * Converts supported crypto assets and ProxiCoin (PX) into Ugandan Shillings
 * paid out to a mobile money wallet (MTN MoMo / Airtel Money).
 *
 * This is a demo model: rates are fixed reference rates, not live market data.
 */

export type Rail = 'MTN' | 'Airtel'

export type AssetId = 'PX' | 'USDT' | 'BTC' | 'ETH' | 'USDC'

export type Asset = {
  id: AssetId
  name: string
  /** UGX per 1 unit of the asset */
  ugxRate: number
  /** network fee, charged in the asset itself */
  networkFee: number
  /** min amount of the asset you can send */
  min: number
  /** step used by the amount input */
  step: number
  decimals: number
  color: string
  kind: 'coin' | 'crypto'
}

/**
 * How many PX make one UGX. 100 PX = 1 UGX, so 100,000 PX = 1,000 UGX.
 *
 * This was 10:1 until PX became the in-house currency. PX is now *earned*
 * (15,000 a day for logging in) rather than bought, so the peg had to make
 * that a meaningful but not extractive amount: a day's allowance is worth
 * UGX 150, and a month of perfect attendance is UGX 4,500. At 10:1 the same
 * allowance was UGX 1,500 a day, which is a wage rather than a game.
 */
export const PX_PER_UGX = 100

/** Convert a PX balance into UGX at the platform peg. */
export function pxToUgx(px: number): number {
  return Math.floor(Math.max(0, px) / PX_PER_UGX)
}

/** Convert UGX into PX at the platform peg. */
export function ugxToPx(ugx: number): number {
  return Math.round(Math.max(0, ugx) * PX_PER_UGX)
}

/**
 * Reference UGX rates. PX is pegged at 100 PX = 1 UGX so the in-game coin has a
 * predictable payout value: 100,000 PX cashes out as 1,000 UGX.
 */
export const ASSETS: Record<AssetId, Asset> = {
  // Minimums are in PX and scale with the peg: 50,000 PX was 5,000 UGX at the
  // old 10:1 rate, so at 100:1 the same UGX floor is 500,000 PX. Leaving it at
  // 50,000 would let a player cash out UGX 500, under the 1,000 UGX floor
  // request_cashout enforces, and they would only find out after submitting.
  PX: { id: 'PX', name: 'ProxiCoin', ugxRate: 1 / PX_PER_UGX, networkFee: 0, min: 500000, step: 100000, decimals: 0, color: '#c6f24e', kind: 'coin' },
  USDT: { id: 'USDT', name: 'Tether', ugxRate: 3780, networkFee: 0.6, min: 2, step: 1, decimals: 2, color: '#26a17b', kind: 'crypto' },
  USDC: { id: 'USDC', name: 'USD Coin', ugxRate: 3778, networkFee: 0.6, min: 2, step: 1, decimals: 2, color: '#2775ca', kind: 'crypto' },
  BTC: { id: 'BTC', name: 'Bitcoin', ugxRate: 356_000_000, networkFee: 0.00004, min: 0.0002, step: 0.0001, decimals: 5, color: '#f7931a', kind: 'crypto' },
  ETH: { id: 'ETH', name: 'Ethereum', ugxRate: 12_400_000, networkFee: 0.0012, min: 0.01, step: 0.005, decimals: 4, color: '#8a92b2', kind: 'crypto' },
}

export const ASSET_IDS: AssetId[] = ['PX', 'USDT', 'USDC', 'BTC', 'ETH']

/** Mobile money payout fee tiers, as a fraction of the payout. */
export const RAIL_FEE = 0.01

export type Quote = {
  asset: AssetId
  /** amount of the asset being sent */
  send: number
  /** subtotal before fees, in UGX */
  gross: number
  /** network fee expressed in UGX */
  networkFeeUgx: number
  /** mobile money payout fee in UGX */
  payoutFeeUgx: number
  /** final amount the wallet receives */
  net: number
  /** effective rate after fees */
  effectiveRate: number
  /** true when the send amount is below the asset minimum */
  tooSmall: boolean
}

export function quote(asset: AssetId, send: number): Quote {
  const a = ASSETS[asset]
  const gross = Math.max(0, send) * a.ugxRate
  const networkFeeUgx = a.networkFee * a.ugxRate
  const payoutFeeUgx = Math.max(0, gross - networkFeeUgx) * RAIL_FEE
  const net = Math.max(0, gross - networkFeeUgx - payoutFeeUgx)
  return {
    asset,
    send,
    gross,
    networkFeeUgx,
    payoutFeeUgx,
    net,
    effectiveRate: send > 0 ? net / send : 0,
    tooSmall: send < a.min,
  }
}

/** The reverse direction: how much crypto is needed to receive a UGX target. */
export function quoteForPayout(asset: AssetId, targetUgx: number): Quote {
  const a = ASSETS[asset]
  const net = Math.max(0, targetUgx)
  const gross = (net + a.networkFee * a.ugxRate) / (1 - RAIL_FEE)
  return quote(asset, gross / a.ugxRate)
}

/** Ugandan mobile money numbers: 07XXXXXXXX, or +2567XXXXXXXX. */
export function normalisePhone(raw: string): string | null {
  const d = raw.replace(/[^\d+]/g, '')
  if (/^\+2567\d{8}$/.test(d)) return '0' + d.slice(4)
  if (/^2567\d{8}$/.test(d)) return '0' + d.slice(3)
  if (/^07\d{8}$/.test(d)) return d
  return null
}

export function validPhone(raw: string): boolean {
  return normalisePhone(raw) !== null
}

/** MTN numbers in Uganda are 077/078/076/039; Airtel are 070/075/074. */
export function railForPhone(raw: string): Rail | null {
  const p = normalisePhone(raw)
  if (!p) return null
  const pfx = p.slice(0, 3)
  if (['077', '078', '076', '039'].includes(pfx)) return 'MTN'
  if (['070', '075', '074'].includes(pfx)) return 'Airtel'
  return null
}

export type ExchangeStatus = 'quoted' | 'awaiting_deposit' | 'confirming' | 'paid' | 'failed'

export type ExchangeOrder = {
  id: string
  asset: AssetId
  send: number
  phone: string
  rail: Rail
  net: number
  status: ExchangeStatus
  createdAt: number
  /** deposit address for crypto sends */
  address: string
  txHash?: string
}

const B32 = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export function depositAddress(asset: AssetId): string {
  let out = asset === 'PX' ? 'PX' : asset === 'BTC' ? 'bc1q' : '0x'
  const len = asset === 'PX' ? 20 : asset === 'BTC' ? 34 : 38
  for (let i = 0; i < len; i++) out += B32[Math.floor(Math.random() * B32.length)]
  return out
}

export function newOrder(asset: AssetId, send: number, phone: string, rail: Rail): ExchangeOrder {
  const q = quote(asset, send)
  return {
    id: 'PC-' + Math.random().toString(36).slice(2, 8).toUpperCase(),
    asset,
    send,
    phone: normalisePhone(phone) ?? phone,
    rail,
    net: Math.round(q.net),
    status: 'awaiting_deposit',
    createdAt: Date.now(),
    address: depositAddress(asset),
  }
}

/** Human label for a status. */
export const STATUS_LABEL: Record<ExchangeStatus, string> = {
  quoted: 'Quoted',
  awaiting_deposit: 'Awaiting deposit',
  confirming: 'Confirming',
  paid: 'Paid to MoMo',
  failed: 'Failed',
}
