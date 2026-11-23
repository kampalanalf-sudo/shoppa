// Shared DGateway client. Server-side only — this module must never be imported
// by browser code. The API key is read from the function's secrets.
//
// Contract (identical to the Tank Tickets integration):
//   base    https://dgatewayapi.desispay.com
//   auth    X-API-Key: <DGATEWAY_API_KEY>
//   collect POST /v1/payments/collect   { amount, currency, phone_number, description, callback_url }
//   disburse POST /v1/payments/disburse (same shape)
//   status  GET  /v1/transactions/{reference}/status
//   webhook X-DGateway-Signature = HMAC-SHA256(raw body, DGATEWAY_WEBHOOK_SECRET)

export type PaymentStatus = 'pending' | 'completed' | 'failed'

export type Transaction = {
  reference: string
  status: string
  provider?: string
  provider_slug?: string
  provider_ref?: string
  amount?: number
  currency?: string
  direction?: string
  failure_reason?: string
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

/** Secrets, read through one place. */
export const secrets = {
  get apiUrl() {
    return (Deno.env.get('DGATEWAY_API_URL') || 'https://dgatewayapi.desispay.com').replace(/\/$/, '')
  },
  get apiKey() {
    return (Deno.env.get('DGATEWAY_API_KEY') || '').trim()
  },
  get webhookSecret() {
    return (Deno.env.get('DGATEWAY_WEBHOOK_SECRET') || '').trim()
  },
  get allowTestPayments() {
    return (Deno.env.get('DGATEWAY_ALLOW_TEST_PAYMENTS') || 'false') === 'true'
  },
  get appUrl() {
    return (Deno.env.get('APP_URL') || '').replace(/\/$/, '')
  },
}

export function requireApiKey() {
  if (!secrets.apiKey) {
    throw new GatewayError(
      'Mobile money is not configured. No payment has been requested.',
      'PAYMENT_NOT_CONFIGURED',
      503,
    )
  }
  return secrets.apiKey
}

/** DGateway accepts the leading 0 or +256 country code form. */
export function cleanPhone(input: string) {
  return String(input || '').trim().replace(/[\s().-]/g, '')
}

export function isValidGatewayPhone(input: string) {
  const phone = cleanPhone(input)
  return /^(?:0[17]\d{8}|\+?256[17]\d{8})$/.test(phone)
}

export function normalizeCurrency(value: unknown) {
  return String(value || '').trim().toUpperCase()
}

export function isWholeUnitAmount(amount: unknown, currency: string) {
  if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0) return false
  return ['UGX', 'KES', 'TZS', 'RWF', 'USD'].includes(currency)
}

/** Whole unit amounts only, in a currency we support. (Vercel name, kept so the
 *  ported routes read identically to api/pay.ts.) */
export function isWholeAmount(amount: unknown): amount is number {
  return typeof amount === 'number' && Number.isInteger(amount) && amount > 0
}

/**
 * Normalise a mobile-money number to the form DGateway accepts, or null.
 *
 * Returns null rather than a best guess: a plausibly-wrong number is a charge
 * sent to a stranger.
 */
export function normalizePhone(input: string): string | null {
  const raw = String(input || '').trim().replace(/[\s().-]/g, '')
  if (!raw) return null

  // +2567..., +2547..., +2556..., +2507...
  if (/^\+(?:256[17]\d{8}|2547\d{8}|255[67]\d{8}|2507[2389]\d{7})$/.test(raw)) return raw

  // 2567... (no plus)
  if (/^(?:256[17]\d{8}|2547\d{8}|255[67]\d{8}|2507[2389]\d{7})$/.test(raw)) return raw

  // 07... / 01... local form — keep the 0, which is what the provider expects
  if (/^0[17]\d{8}$/.test(raw)) return raw

  return null
}

/**
 * True when a LIVE key is configured. Live mode moves real money, so it is held
 * to stricter rules than sandbox: a webhook secret is mandatory.
 */
export function isLiveMode(): boolean {
  return secrets.apiKey.startsWith('dgw_live')
}

/**
 * Refuse to move real money when the webhook cannot be verified.
 *
 * Without a secret, every webhook fails the HMAC check, so a real charge would
 * be taken and never credited. Blocking the charge is the only safe outcome.
 */
export function assertLiveSafety(): void {
  // No key at all: refuse before anything is sent, so a misconfigured function
  // reads as "not set up" rather than as a provider outage.
  if (!secrets.apiKey) {
    throw new GatewayError(
      'Mobile money is not configured. No payment has been requested.',
      'PAYMENT_NOT_CONFIGURED',
      503,
    )
  }
  if (!isLiveMode()) return
  if (!secrets.webhookSecret) {
    throw new GatewayError(
      'Live payments are enabled but DGATEWAY_WEBHOOK_SECRET is not set. ' +
        'Payments are blocked until the webhook can be verified.',
      'WEBHOOK_SECRET_MISSING',
      503,
    )
  }
}

/** Only the exact terminal states from DGateway may fulfil or fail an order. */
export function normalizeStatus(value: unknown): PaymentStatus {
  const s = String(value || '').toLowerCase()
  if (s === 'completed') return 'completed'
  if (s === 'failed') return 'failed'
  return 'pending'
}

async function request(path: string, init?: { method?: string; body?: unknown }) {
  const key = requireApiKey()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 25_000)
  try {
    const res = await fetch(`${secrets.apiUrl}${path}`, {
      method: init?.method || 'GET',
      headers: { 'X-API-Key': key, 'Content-Type': 'application/json' },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
      signal: controller.signal,
    })
    const json = (await res.json().catch(() => null)) as
      | { data?: Transaction; error?: { code?: string; message?: string } | string; message?: string; code?: string }
      | null

    if (!res.ok || json?.error) {
      const error = json?.error
      const code = typeof error === 'object' ? error?.code : json?.code
      const message = typeof error === 'object' ? error?.message : error
      const status = res.status === 429
        ? 429
        : [400, 404, 409, 422].includes(res.status)
          ? 400
          : [401, 403].includes(res.status)
            ? 503
            : 502
      throw new GatewayError(
        message || json?.message || `DGateway returned HTTP ${res.status}`,
        code || (status === 503 ? 'PAYMENT_NOT_CONFIGURED' : 'PROVIDER_ERROR'),
        status,
      )
    }
    if (!json?.data) throw new GatewayError('DGateway returned an incomplete response.', 'INVALID_RESPONSE')
    return json.data
  } catch (err) {
    if (err instanceof GatewayError) throw err
    if (controller.signal.aborted) {
      throw new GatewayError(
        'DGateway did not respond in time. Keep your reference and check again shortly.',
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
    clearTimeout(timeout)
  }
}

export type CollectPayload = {
  amount: number
  currency: string
  phone_number: string
  description: string
  callback_url?: string
}

/** Pull money in from a mobile money wallet. */
export async function collectPayment(payload: CollectPayload) {
  const tx = await request('/v1/payments/collect', { method: 'POST', body: payload })
  if (!tx.reference) throw new GatewayError('DGateway did not return a payment reference.', 'INVALID_RESPONSE')
  return tx
}

/** Push money out to a mobile money wallet. */
export async function disbursePayment(payload: CollectPayload) {
  const tx = await request('/v1/payments/disburse', { method: 'POST', body: payload })
  if (!tx.reference) throw new GatewayError('DGateway did not return a payout reference.', 'INVALID_RESPONSE')
  return tx
}

export async function fetchTransactionStatus(reference: string) {
  const tx = await request(`/v1/transactions/${encodeURIComponent(reference)}/status`)
  if (tx.reference !== reference) {
    throw new GatewayError('Payment verification did not match the request.', 'INVALID_RESPONSE')
  }
  return tx
}

export function transactionMatches(
  tx: Transaction,
  expected: { reference: string; amount: number; currency: string; direction?: 'collect' | 'disburse' },
) {
  if (tx.reference !== expected.reference) return false
  if (tx.amount !== undefined && Number(tx.amount) !== expected.amount) return false
  if (tx.currency !== undefined && normalizeCurrency(tx.currency) !== expected.currency) return false
  if (expected.direction && tx.direction && tx.direction !== expected.direction) return false
  return true
}

/** Constant-time HMAC check of the raw webhook body. Fails closed. */
export async function verifyWebhookSignature(raw: string, signature: string | null) {
  const secret = secrets.webhookSecret
  if (!secret) return false // no secret configured => reject, never trust blindly
  if (!signature) return false
  const received = signature.trim().replace(/^sha256=/i, '').toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(received)) return false

  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const expected = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(raw)))
  let diff = 0
  for (let i = 0; i < expected.length; i++) {
    diff |= expected[i] ^ parseInt(received.slice(i * 2, i * 2 + 2), 16)
  }
  return diff === 0
}
