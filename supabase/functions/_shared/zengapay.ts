// Shared ZENGAPAY client. Server-side only — this module must never be imported
// by browser code. The API token is read from the function's secrets.
//
// Contract (ZENGAPAY REST API v1, developers.zengapay.com):
//   base    https://api.zengapay.com/v1        (sandbox: https://api.sandbox.zengapay.com/v1)
//   auth    Authorization: Bearer <ZENGAPAY_API_TOKEN>
//   collect POST /collections  { msisdn, amount, external_reference, narration, charge_customer }
//   payout  POST /transfers    { msisdn, amount, external_reference, narration, use_contact }
//   status  GET  /collections/{transactionReference}
//           GET  /transfers/{transactionReference}
//   webhook X-ZENGAPAY-SIGNATURE = HMAC-SHA256(transactionReference + msisdn + amount, secret)
//
// TWO THINGS THAT ARE EASY TO GET WRONG, AND BOTH COST MONEY
//
// 1. The callback URL is NOT sent per request. Unlike DGateway, ZENGAPAY takes
//    the webhook URL once, in the dashboard (Settings -> Developer Settings).
//    Setting it from code does nothing.
//
// 2. The signature is NOT over the raw body. It is over three fields
//    concatenated in a fixed order. Getting this wrong means every webhook
//    fails verification, so no top-up is ever credited — a silent, total
//    outage that looks like "payments are broken".

export type PaymentStatus = 'pending' | 'completed' | 'failed'

/** A transaction, normalised from either a collection or a transfer object. */
export type Transaction = {
  reference: string
  status: string
  provider?: string | null
  provider_ref?: string | null
  amount?: number
  currency?: string
  direction?: 'collect' | 'disburse'
  failure_reason?: string | null
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
  /** Full base including the version segment, e.g. https://api.zengapay.com/v1 */
  get apiUrl() {
    return (Deno.env.get('ZENGAPAY_API_URL') || 'https://api.zengapay.com/v1').replace(/\/$/, '')
  },
  /**
   * The API key, under either name.
   *
   * The documented name is ZENGAPAY_API_TOKEN, but the ZENGAPAY dashboard calls
   * the same value an "API key" and it is easy to store it as ZENGAPAY_API_KEY.
   * That is exactly what happened on this project, and the only symptom was a
   * 503 telling players mobile money was not configured while the secret sat
   * there set under a name nothing read.
   *
   * Both names are accepted; the token name wins if both are present, so the
   * documented one stays authoritative. Nothing is guessed: a missing value is
   * still reported as missing.
   */
  get apiToken() {
    return (
      Deno.env.get('ZENGAPAY_API_TOKEN') ||
      Deno.env.get('ZENGAPAY_API_KEY') ||
      ''
    ).trim()
  },
  /** The "Secret Hash" from Developer Settings. Used to verify webhooks. */
  get webhookSecret() {
    return (Deno.env.get('ZENGAPAY_WEBHOOK_SECRET') || '').trim()
  },
  get appUrl() {
    return (Deno.env.get('APP_URL') || '').replace(/\/$/, '')
  },
  /** True when pointed at sandbox, so safety rules can relax appropriately. */
  get isSandbox() {
    return secrets.apiUrl.includes('sandbox')
  },
}

export function requireApiToken() {
  if (!secrets.apiToken) {
    throw new GatewayError(
      'Mobile money is not configured. No payment has been requested.',
      'PAYMENT_NOT_CONFIGURED',
      503,
    )
  }
  return secrets.apiToken
}

/**
 * True when a live token is configured.
 *
 * ZENGAPAY's published token format is `ZPYPUBK-...`. Rather than trust one
 * prefix, the check is "not obviously a sandbox value": the environments have
 * separate keys and a key used against the wrong one returns 401 with an `env`
 * field, so assuming live is the safe direction for the stricter rules.
 */
export function isLiveMode(): boolean {
  return Boolean(secrets.apiToken) && !secrets.isSandbox && !/^(test|sandbox|sk_test)/i.test(secrets.apiToken)
}

/**
 * Refuse to move real money when the webhook cannot be verified.
 *
 * Without a secret every webhook fails its HMAC check, so a real charge would be
 * taken and never credited. Blocking the charge is the only safe outcome.
 */
export function assertLiveSafety(): void {
  if (!secrets.apiToken) {
    throw new GatewayError(
      'Mobile money is not configured. No payment has been requested.',
      'PAYMENT_NOT_CONFIGURED',
      503,
    )
  }
  if (!isLiveMode()) return
  if (!secrets.webhookSecret) {
    throw new GatewayError(
      'Live payments are enabled but ZENGAPAY_WEBHOOK_SECRET is not set. ' +
        'Payments are blocked until the webhook can be verified.',
      'WEBHOOK_SECRET_MISSING',
      503,
    )
  }
}

/**
 * Whether this deployment can take money right now, and if not, why.
 *
 * `assertLiveSafety` throws on the first problem because a payment must stop.
 * An operator needs the whole list instead, so this returns every blocker at
 * once without throwing. The two share `secrets`, so the health screen and the
 * payment path cannot drift apart: if this says ok, `assertLiveSafety` passes.
 *
 * Newlines are stripped from the reasons: they are rendered on one line of an
 * admin screen, and a stray newline in an env var is itself a common cause of a
 * broken token.
 */
export function paymentReadiness(): { mode: 'live' | 'sandbox' | 'unconfigured'; blockers: string[] } {
  const blockers: string[] = []
  if (!secrets.apiToken) {
    blockers.push(
      'ZENGAPAY_API_TOKEN is not set (nor ZENGAPAY_API_KEY), so no deposit can be requested',
    )
  }
  if (secrets.apiToken && !/^ZPYPUBK-/i.test(secrets.apiToken)) {
    blockers.push('ZENGAPAY_API_TOKEN does not start with ZPYPUBK-, so it is probably not an API key')
  }
  const live = Boolean(secrets.apiToken) && !secrets.isSandbox && !/^(test|sandbox|sk_test)/i.test(secrets.apiToken)
  if (live && !secrets.webhookSecret) {
    blockers.push(
      'ZENGAPAY_WEBHOOK_SECRET is not set, so a real charge could be taken and never credited',
    )
  }
  if (!secrets.isSandbox && /sandbox/i.test(secrets.apiUrl)) {
    blockers.push('ZENGAPAY_API_URL still points at the sandbox while the token looks like production')
  }
  const mode = !secrets.apiToken ? 'unconfigured' : live ? 'live' : 'sandbox'
  return { mode, blockers: blockers.map((b) => b.replace(/[\r\n]+/g, ' ')) }
}

/**
 * ZENGAPAY wants an international number without the `+`: 256775203801.
 *
 * Uganda only, deliberately. This app pays out to UGX wallets, and a
 * plausibly-wrong number is a charge sent to a stranger.
 */
export function normalizePhone(input: string): string | null {
  const raw = String(input || '').trim().replace(/[\s().-]/g, '')
  if (!raw) return null

  // 077..., 078..., 076..., 070..., 075... local form -> 256...
  if (/^0(?:7[0-9])\d{7}$/.test(raw)) return `256${raw.slice(1)}`

  // 2567XXXXXXXX
  if (/^2567\d{8}$/.test(raw)) return raw

  // +2567XXXXXXXX
  if (/^\+2567\d{8}$/.test(raw)) return raw.slice(1)

  return null
}

export function isValidGatewayPhone(input: string) {
  return normalizePhone(input) !== null
}

export function cleanPhone(input: string) {
  return normalizePhone(input) ?? ''
}

export function normalizeCurrency(value: unknown) {
  return String(value || '').trim().toUpperCase()
}

export function isWholeAmount(amount: unknown): amount is number {
  return typeof amount === 'number' && Number.isInteger(amount) && amount > 0
}

/**
 * Map a ZENGAPAY transactionStatus to ours.
 *
 * Only SUCCEEDED fulfils. FAILED is final. INDETERMINATE is NOT failed — it
 * means the outcome is unknown, so it must stay pending and be reconciled
 * rather than refunded or credited on a guess.
 */
export function normalizeStatus(value: unknown): PaymentStatus {
  const s = String(value || '').trim().toUpperCase()
  if (s === 'SUCCEEDED' || s === 'SUCCESS' || s === 'COMPLETED') return 'completed'
  if (s === 'FAILED' || s === 'DECLINED' || s === 'CANCELLED' || s === 'CANCELED') return 'failed'
  return 'pending'
}

type RawCollection = {
  code?: number
  status?: string
  message?: string
  transactionReference?: string
  data?: Record<string, unknown>
  error?: unknown
}

async function request(path: string, init?: { method?: string; body?: unknown }): Promise<Record<string, unknown>> {
  const token = requireApiToken()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 25_000)
  try {
    const res = await fetch(`${secrets.apiUrl}${path}`, {
      method: init?.method || 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
      signal: controller.signal,
    })

    const json = (await res.json().catch(() => null)) as RawCollection | null

    if (!res.ok) {
      // 401/403 is a configuration fault, not an outage: the token is wrong for
      // this environment. Say so, because the operator response is different.
      const authy = res.status === 401 || res.status === 403
      const message =
        (typeof json?.message === 'string' && json.message) ||
        (json?.error !== undefined && typeof json.error === 'string' ? json.error : '') ||
        `ZENGAPAY returned HTTP ${res.status}`
      throw new GatewayError(
        authy ? `ZENGAPAY rejected our API token. ${message}` : message,
        authy ? 'PAYMENT_NOT_CONFIGURED' : res.status === 429 ? 'PROVIDER_RATE_LIMITED' : 'PROVIDER_ERROR',
        authy ? 503 : res.status === 429 ? 429 : 502,
      )
    }

    // A collection/transfer request answers with the reference at the top
    // level; a status read answers with it nested under `data`.
    return (json ?? {}) as Record<string, unknown>
  } catch (err) {
    if (err instanceof GatewayError) throw err
    if (controller.signal.aborted) {
      throw new GatewayError(
        'ZENGAPAY did not respond in time. Keep your reference and check again shortly.',
        'PROVIDER_TIMEOUT',
        504,
      )
    }
    throw new GatewayError(
      "We couldn't reach ZENGAPAY. Keep your reference and try again shortly.",
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
  /** Our own order id, sent as external_reference. Must be unique per request. */
  order_id: string
}

/**
 * Pull money in from a mobile money wallet.
 *
 * The player receives a prompt on their phone and must approve it.
 */
export async function collectPayment(payload: CollectPayload): Promise<Transaction> {
  const msisdn = normalizePhone(payload.phone_number)
  if (!msisdn) {
    throw new GatewayError('Enter a valid Ugandan mobile money number.', 'INVALID_PHONE', 400)
  }
  if (normalizeCurrency(payload.currency) !== 'UGX') {
    throw new GatewayError('ZENGAPAY collections are UGX only.', 'UNSUPPORTED_CURRENCY', 400)
  }

  const json = await request('/collections', {
    method: 'POST',
    body: {
      msisdn,
      amount: payload.amount,
      // Uniqueness matters: ZENGAPAY rejects a repeated external_reference, and
      // that is what keeps a double-tap from charging twice.
      external_reference: payload.order_id,
      narration: payload.description.slice(0, 120),
      // Fees on the merchant unless the operator changes it in the dashboard.
      charge_customer: false,
    },
  })

  const reference = typeof json.transactionReference === 'string' ? json.transactionReference : ''
  if (!reference) {
    throw new GatewayError('ZENGAPAY did not return a transaction reference.', 'INVALID_RESPONSE')
  }
  return {
    reference,
    status: 'PENDING',
    provider: 'ZENGAPAY',
    direction: 'collect',
    amount: payload.amount,
    currency: 'UGX',
  }
}

/**
 * Push money out to a mobile money wallet.
 *
 * NOTE: transfers require IP whitelisting on the ZENGAPAY account. If payouts
 * fail with 401/403 while collections work, that is the cause — not the token.
 */
export async function disbursePayment(payload: CollectPayload): Promise<Transaction> {
  const msisdn = normalizePhone(payload.phone_number)
  if (!msisdn) {
    throw new GatewayError('Enter a valid Ugandan mobile money number to pay out to.', 'INVALID_PHONE', 400)
  }
  if (normalizeCurrency(payload.currency) !== 'UGX') {
    throw new GatewayError('ZENGAPAY transfers are UGX only.', 'UNSUPPORTED_CURRENCY', 400)
  }

  const json = await request('/transfers', {
    method: 'POST',
    body: {
      msisdn,
      amount: payload.amount,
      external_reference: payload.order_id,
      narration: payload.description.slice(0, 120),
      use_contact: false,
    },
  })

  const reference = typeof json.transactionReference === 'string' ? json.transactionReference : ''
  if (!reference) {
    throw new GatewayError('ZENGAPAY did not return a payout reference.', 'INVALID_RESPONSE')
  }
  return {
    reference,
    status: 'PENDING',
    provider: 'ZENGAPAY',
    direction: 'disburse',
    amount: payload.amount,
    currency: 'UGX',
  }
}

export type CheckoutSession = { id: string; url: string }

/**
 * Create a hosted checkout session.
 *
 * This is the ZENGAPAY replacement for DGateway's storefront link. The player
 * pays on ZENGAPAY's page, so we never handle their PIN and never need the
 * msisdn up front. The session URL is what the browser navigates to.
 *
 * `return_url` and `cancel_url` MUST contain the literal CHECKOUT_SESSION_ID
 * placeholder — the provider substitutes it — so they are built here rather
 * than passed in.
 */
export async function createCheckoutSession(payload: {
  amount: number
  order_id: string
  narration: string
  return_url: string
  cancel_url: string
}): Promise<CheckoutSession> {
  const json = await request('/checkout/sessions', {
    method: 'POST',
    body: {
      mode: 'payment',
      amount: payload.amount,
      external_reference: payload.order_id,
      narration: payload.narration.slice(0, 120),
      issue_receipt: false,
      return_url: payload.return_url,
      cancel_url: payload.cancel_url,
    },
  })

  const session = (json.session ?? {}) as Record<string, unknown>
  const url = typeof session.url === 'string' ? session.url : ''
  const id = typeof session.id === 'string' ? session.id : ''
  if (!url || !id) {
    throw new GatewayError('ZENGAPAY did not return a checkout URL.', 'INVALID_RESPONSE')
  }
  return { id, url }
}

/**
 * Read a checkout session and, if it has settled, the transaction inside it.
 *
 * A session's own status is PROCESSED once the payment is final; the nested
 * `transaction` then carries the transactionReference that a webhook would
 * send, which is what the order row is keyed on.
 */
export async function fetchCheckoutSession(sessionId: string): Promise<{
  status: string
  reference: string
  transactionStatus: string
  amount?: number
}> {
  const json = await request(`/checkout/sessions/${encodeURIComponent(sessionId)}`)
  const session = (json.session ?? {}) as Record<string, unknown>
  const tx = (session.transaction ?? {}) as Record<string, unknown>
  return {
    status: String(session.status ?? ''),
    reference: typeof tx.transactionReference === 'string' ? tx.transactionReference : '',
    transactionStatus: String(tx.transactionStatus ?? 'PENDING'),
    amount: tx.amount === undefined ? undefined : Number(tx.amount),
  }
}

/**
 * Read a transaction back from the provider.
 *
 * This is the authoritative check. A webhook body is a claim; this is the truth,
 * and the webhooks re-fetch through it before crediting anything.
 */
export async function fetchTransactionStatus(
  reference: string,
  direction: 'collect' | 'disburse' = 'collect',
): Promise<Transaction> {
  const path = direction === 'disburse' ? '/transfers' : '/collections'
  const json = await request(`${path}/${encodeURIComponent(reference)}`)
  const data = (json.data ?? {}) as Record<string, unknown>

  const returnedRef = String(data.transactionReference ?? '')
  if (returnedRef && returnedRef !== reference) {
    throw new GatewayError('Payment verification did not match the request.', 'INVALID_RESPONSE')
  }

  return {
    reference: returnedRef || reference,
    status: String(data.transactionStatus ?? 'PENDING'),
    provider: (data.paymentProvider as string) ?? 'ZENGAPAY',
    provider_ref: (data.MNOTransactionReferenceId as string) ?? null,
    amount: data.amount === undefined ? undefined : Number(data.amount),
    currency: 'UGX',
    direction,
    failure_reason: null,
  }
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

/** Constant-time compare of two hex strings. */
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/**
 * The exact string ZENGAPAY signs: transactionReference + msisdn + amount.
 *
 * There is no separator. The docs are explicit, and a separator (or JSON
 * serialisation, or the raw body) would fail every verification.
 */
export function webhookSignedPayload(body: Record<string, unknown>): string | null {
  const data = (body.data ?? body) as Record<string, unknown>
  const reference = data.transactionReference
  const msisdn = data.msisdn
  const amount = data.amount
  if (reference === undefined || msisdn === undefined || amount === undefined) return null
  return `${String(reference)}${String(msisdn)}${String(amount)}`
}

/**
 * Verify X-ZENGAPAY-SIGNATURE.
 *
 * Fails closed on every path: no secret, no header, malformed header, missing
 * signed fields. Each of those means "do not credit".
 */
export async function verifyWebhookSignature(
  raw: string,
  signature: string | null,
  headerName = 'x-zengapay-signature',
): Promise<boolean> {
  void headerName
  const secret = secrets.webhookSecret
  if (!secret) return false
  if (!signature) return false
  const received = signature.trim().replace(/^sha256=/i, '').toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(received)) return false

  let body: Record<string, unknown>
  try {
    body = JSON.parse(raw)
  } catch {
    return false
  }

  const signed = webhookSignedPayload(body)
  if (!signed) return false

  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const expected = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(signed)))
  const hex = [...expected].map((b) => b.toString(16).padStart(2, '0')).join('')
  return timingSafeEqualHex(hex, received)
}

/**
 * Pull the transaction reference out of a ZENGAPAY webhook.
 *
 * The shape is `{ event, data: { transactionReference, ... } }`, and the docs
 * themselves contain a malformed example (a doubled brace), so this reads
 * defensively rather than trusting one shape.
 */
export function webhookReference(body: Record<string, unknown>): string {
  const data = (body.data ?? {}) as Record<string, unknown>
  const direct = data.transactionReference ?? body.transactionReference
  if (typeof direct === 'string' && direct.trim()) return direct.trim()

  // Fall back to our own order id, which the provider echoes back.
  const ext = data.transactionExternalReference ?? body.transactionExternalReference
  return typeof ext === 'string' ? ext.trim() : ''
}

/** Which direction a webhook describes, from its event name. */
export function webhookDirection(body: Record<string, unknown>): 'collect' | 'disburse' {
  const event = String(body.event ?? '').toLowerCase()
  return event.startsWith('transfer') ? 'disburse' : 'collect'
}
