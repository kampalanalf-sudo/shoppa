// Server-only DGateway client.
//
// NEVER import this from anything under src/ — the API key must never reach the
// browser bundle. Every call here happens on the server route.
//
// Base URL: https://dgatewayapi.desispay.com
// Auth:     X-API-Key: <DGATEWAY_API_KEY>

export const DG_BASE = (process.env.DGATEWAY_API_URL || 'https://dgatewayapi.desispay.com').replace(/\/$/, '')

/**
 * True when a LIVE key is configured. Live mode moves real money, so it is held
 * to stricter rules than sandbox: a webhook secret is mandatory and the app
 * refuses to start payments without one.
 */
export function isLiveMode(): boolean {
  return (process.env.DGATEWAY_API_KEY || '').trim().startsWith('dgw_live_')
}

/** Throws when live mode is on but webhook verification is not configured. */
export function assertLiveSafety(): void {
  if (!isLiveMode()) return
  if (!(process.env.DGATEWAY_WEBHOOK_SECRET || '').trim()) {
    throw new GatewayError(
      'Live payments are enabled but DGATEWAY_WEBHOOK_SECRET is not set. ' +
        'Payments are blocked until the webhook can be verified.',
      'WEBHOOK_SECRET_MISSING',
      503,
    )
  }
}

export type PaymentStatus = 'pending' | 'completed' | 'failed'

type Json = Record<string, unknown>

export type DgTransaction = {
  reference: string
  status: string
  provider?: string
  provider_ref?: string
  amount?: number
  currency?: string
  direction?: string
  failure_reason?: string
  // Present on hosted-store transactions. Untyped upstream, so keep them loose.
  quantity?: number
  items?: Json[]
  line_items?: Json[]
  customer?: Json
  product?: Json
  metadata?: Json
}

export class GatewayError extends Error {
  code: string
  httpStatus: number
  constructor(message: string, code = 'PROVIDER_ERROR', httpStatus = 502) {
    super(message)
    this.name = 'GatewayError'
    this.code = code
    this.httpStatus = httpStatus
  }
}

function apiKey(): string {
  const key = (process.env.DGATEWAY_API_KEY || '').trim()
  if (!key) {
    // Fail loudly but without leaking anything: no request is made.
    throw new GatewayError(
      'Card and mobile money are not configured on this deployment. No payment has been requested.',
      'PAYMENT_NOT_CONFIGURED',
      503,
    )
  }
  return key
}

/**
 * Phones are accepted as 07XXXXXXXX, 2567XXXXXXXX or +2567XXXXXXXX.
 * Also KE (254), TZ (255) and RW (250).
 *
 * IMPORTANT: keep the leading 0 (or the +/country code) exactly as the user
 * gave it — DGateway routes on the prefix, so stripping "0" breaks 07... input.
 */
export function normalizePhone(input: string): string | null {
  const raw = String(input || '').trim().replace(/[\s().-]/g, '')
  if (!raw) return null

  // +2567..., +2547..., +2556..., +2507...
  if (/^\+(?:256[17]\d{8}|2547\d{8}|255[67]\d{8}|2507[2389]\d{7})$/.test(raw)) return raw

  // 2567... (no plus)
  if (/^(?:256[17]\d{8}|2547\d{8}|255[67]\d{8}|2507[2389]\d{7})$/.test(raw)) return raw

  // 07... / 01... Ugandan local form — keep the 0
  if (/^0[17]\d{8}$/.test(raw)) return raw

  return null
}

/** Mobile money is whole units; Stripe USD is cents. Both must be integers. */
export function isWholeAmount(amount: unknown): amount is number {
  return typeof amount === 'number' && Number.isInteger(amount) && amount > 0
}

export function normalizeCurrency(value: unknown): string {
  return String(value || '').trim().toUpperCase()
}

/** Only these two states are terminal. Everything else stays pending. */
export function normalizeStatus(value: unknown): PaymentStatus {
  const s = String(value || '').toLowerCase()
  if (s === 'completed') return 'completed'
  if (s === 'failed') return 'failed'
  return 'pending'
}

type DgEnvelope = {
  data?: DgTransaction
  error?: { code?: string; message?: string } | string
  message?: string
  code?: string
}

async function request(path: string, init?: { method?: string; body?: unknown }): Promise<DgTransaction> {
  const key = apiKey()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 25_000)

  try {
    const res = await fetch(`${DG_BASE}${path}`, {
      method: init?.method || 'GET',
      headers: {
        'X-API-Key': key,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
      signal: controller.signal,
    })

    const json = (await res.json().catch(() => null)) as DgEnvelope | null

    if (!res.ok || json?.error) {
      const err = json?.error
      const code = typeof err === 'object' ? err?.code : json?.code
      const message = typeof err === 'object' ? err?.message : err
      // 401/403 from our side means the key is wrong — surface as 503, not 502.
      const httpStatus =
        res.status === 429 ? 429
        : [400, 404, 409, 422].includes(res.status) ? 400
        : [401, 403].includes(res.status) ? 503
        : 502
      throw new GatewayError(
        message || json?.message || `DGateway returned HTTP ${res.status}`,
        code || (httpStatus === 503 ? 'PAYMENT_NOT_CONFIGURED' : 'PROVIDER_ERROR'),
        httpStatus,
      )
    }

    if (!json?.data) {
      throw new GatewayError('DGateway returned an incomplete response.', 'INVALID_RESPONSE', 502)
    }
    return json.data
  } catch (e) {
    if (e instanceof GatewayError) throw e
    if (controller.signal.aborted) {
      throw new GatewayError(
        'DGateway did not respond in time. Keep your reference and check again in a moment.',
        'PROVIDER_TIMEOUT',
        504,
      )
    }
    throw new GatewayError(
      "We couldn't reach DGateway. Keep your reference and try again shortly.",
      'PROVIDER_UNAVAILABLE',
      502,
    )
  } finally {
    clearTimeout(timer)
  }
}

export type CollectInput = {
  amount: number
  currency: string
  phone_number: string
  description: string
  callback_url?: string
}

/** Charge a customer. The buyer approves the mobile-money prompt on their phone. */
export async function collectPayment(input: CollectInput): Promise<DgTransaction> {
  const tx = await request('/v1/payments/collect', { method: 'POST', body: input })
  if (!tx.reference) {
    throw new GatewayError('DGateway did not return a payment reference.', 'INVALID_RESPONSE', 502)
  }
  return tx
}

/** Pay a customer out. Works for any MTN/Airtel number the user supplies. */
export async function disbursePayment(input: Omit<CollectInput, 'callback_url'>): Promise<DgTransaction> {
  const tx = await request('/v1/payments/disburse', { method: 'POST', body: input })
  if (!tx.reference) {
    throw new GatewayError('DGateway did not return a payout reference.', 'INVALID_RESPONSE', 502)
  }
  return tx
}

/**
 * Poll a transaction. Call this no faster than every 10 seconds — tighter
 * intervals hit the provider rate limiter.
 */
export async function fetchTransactionStatus(reference: string): Promise<DgTransaction> {
  const tx = await request(`/v1/transactions/${encodeURIComponent(reference)}/status`)
  if (tx.reference && tx.reference !== reference) {
    throw new GatewayError('Payment verification did not match the request.', 'INVALID_RESPONSE', 502)
  }
  return tx
}

/** Guard against acting on a reference for the wrong amount or currency. */
export function transactionMatches(
  tx: DgTransaction,
  expected: { amount: number; currency: string; direction?: 'collect' | 'disburse' },
): boolean {
  if (tx.amount !== undefined && Number(tx.amount) !== expected.amount) return false
  if (tx.currency !== undefined && normalizeCurrency(tx.currency) !== expected.currency) return false
  if (expected.direction && tx.direction && tx.direction !== expected.direction) return false
  return true
}

const encoder = new TextEncoder()

/**
 * Constant-time HMAC-SHA256 check of the raw webhook body.
 * Fails closed: no secret configured means every webhook is rejected.
 */
export async function verifyWebhookSignature(raw: string, signature: string | null | undefined): Promise<boolean> {
  const secret = (process.env.DGATEWAY_WEBHOOK_SECRET || '').trim()
  // Live mode must never fall back to trusting an unverified body.
  if (!secret) return false
  if (!signature) return false

  const received = signature.trim().replace(/^sha256=/i, '').toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(received)) return false

  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(raw)))

  let diff = 0
  for (let i = 0; i < digest.length; i++) {
    diff |= digest[i] ^ parseInt(received.slice(i * 2, i * 2 + 2), 16)
  }
  return diff === 0
}

/** UGX per PX peg used across the app: 10 PX = 1 UGX. */
export const PX_PER_UGX = 10
