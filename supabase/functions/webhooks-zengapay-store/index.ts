// supabase/functions/webhooks-zengapay-store/index.ts
//
// Hosted-store variant of the payment webhook. This existed for a DGateway store
// product. ZENGAPAY has no cart payload — it sends the same
// { event, data: { transactionReference, ... } } object as its sibling — so this
// route now shares that handling and exists mainly to keep the old URL working
// for any integration still pointed at it.
//
// Rules, in order — the same discipline as the API webhook:
//   1. verify the HMAC signature over the raw body (fails closed)
//   2. pull the transaction reference out of the payload
//   3. RE-FETCH the transaction from ZENGAPAY and trust only that response
//   4. fulfil ONLY on "completed"; "failed" is final
//   5. credit only when the account is identifiable
//   6. be idempotent — a repeated reference must never credit twice
//
// Public route, like its sibling: verify_jwt is false and the HMAC is the gate.
import { CORS, json, readEnv } from '../_shared/http.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.45.4'
import {
  fetchTransactionStatus, normalizeStatus, verifyWebhookSignature, webhookDirection, webhookReference,
} from '../_shared/zengapay.ts'

/** Env var, trimmed. Missing becomes '' and never the string "undefined". */
const env = (key: string) => readEnv(key)

type Json = Record<string, unknown>

const str = (v: unknown, max = 300): string =>
  typeof v === 'string' ? v.trim().slice(0, max) : ''

const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)
const meta = (v: unknown): Json => (isObj(v) ? v : {})

/**
 * Read a key from the first object that has it. Order = trust order.
 *
 * An empty string counts as absent: treating "" as a match would shadow every
 * later source. That exact bug silently blanked the buyer email on the Vercel
 * version, which parks every payment.
 */
function first<T>(sources: Json[], keys: string[], pick: (v: unknown) => T | null): T | null {
  for (const s of sources) {
    for (const k of keys) {
      const got = pick(s[k])
      if (got !== null && got !== '') return got
    }
  }
  return null
}

type Item = { id: string; slug: string; quantity: number }

function items(data: Json): Item | null {
  const raw = Array.isArray(data.items)
    ? data.items
    : Array.isArray(data.line_items)
      ? data.line_items
      : null
  if (!raw || raw.length === 0) return null

  let combined: Item | null = null
  for (const candidate of raw) {
    if (!isObj(candidate)) return null
    const product = isObj(candidate.product) ? candidate.product : {}
    const id = str(candidate.product_id, 100) || str(product.id, 100)
    const slug = str(candidate.product_slug, 120) || str(product.slug, 120)
    const qtyRaw = Number(candidate.quantity ?? 1)
    const quantity = Number.isInteger(qtyRaw) && qtyRaw > 0 ? qtyRaw : 1

    if (!combined) {
      combined = { id, slug, quantity }
    } else {
      // A mixed cart makes the expected total ambiguous. Block, never guess.
      if ((id && combined.id && id !== combined.id) || (slug && combined.slug && slug !== combined.slug)) {
        return null
      }
      combined = {
        id: combined.id || id,
        slug: combined.slug || slug,
        quantity: combined.quantity + quantity,
      }
    }
  }
  return combined
}

/**
 * True when the cart holds more than one distinct product: the expected total
 * would be ambiguous, so it must be blocked rather than guessed at.
 */
function isMixedCart(data: Json): boolean {
  const raw = Array.isArray(data.items)
    ? data.items
    : Array.isArray(data.line_items)
      ? data.line_items
      : null
  if (!raw || raw.length < 2) return false

  const seen = new Set<string>()
  for (const c of raw) {
    if (!isObj(c)) return true
    const product = isObj(c.product) ? c.product : {}
    const id = str(c.product_id, 100) || str(product.id, 100)
    const slug = str(c.product_slug, 120) || str(product.slug, 120)
    seen.add(id || slug || '?')
  }
  return seen.size > 1
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight()
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  const raw = await req.text()
  const signature =
    req.headers.get('X-ZENGAPAY-SIGNATURE') || req.headers.get('x-zengapay-signature')

  if (!(await verifyWebhookSignature(raw, signature))) {
    return json({ error: 'invalid signature' }, 401)
  }

  let data: Json
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isObj(parsed)) return json({ error: 'invalid JSON body' }, 400)
    data = parsed
  } catch {
    return json({ error: 'invalid JSON body' }, 400)
  }

  // Block an ambiguous cart before spending a look-up on it.
  const cartBody = isObj(data.data) ? data.data : data
  if (isMixedCart(cartBody)) {
    return json({ error: 'mixed carts must be split into one product per payment' }, 409)
  }

  // ZENGAPAY nests the transaction under `data`; older payloads put it at the
  // top level. Accept either; never trust either for money.
  const body = isObj(data.data) ? data.data : data

  const reference = webhookReference(data)
  if (!reference) return json({ error: 'reference is required' }, 400)
  const direction = webhookDirection(data)

  // ---- RE-FETCH from ZENGAPAY. The webhook body is a notification, not proof.
  let verified
  try {
    verified = await fetchTransactionStatus(reference, direction)
  } catch (e) {
    const err = e as { message?: string; code?: string }
    // The look-up succeeded but described a different transaction. Retrying
    // cannot fix that, so 409 rather than 502.
    if (err.code === 'INVALID_RESPONSE') return json({ error: 'reference mismatch' }, 409)
    console.error('zengapay-store: verify failed', err.message)
    return json({ error: 'could not verify transaction' }, 502)
  }

  if (verified.reference !== reference) return json({ error: 'reference mismatch' }, 409)

  const status = normalizeStatus(verified.status)

  // ---- buyer + product, preferring the verified response over the body -----
  const verifiedRaw = verified as unknown as Json
  const vMeta = meta(verifiedRaw.metadata)
  const nMeta = meta(body.metadata)
  const vCustomer = isObj(verifiedRaw.customer) ? verifiedRaw.customer : {}
  const nCustomer = isObj(body.customer) ? body.customer : {}
  const customer = { ...nCustomer, ...vCustomer }
  const sources = [verifiedRaw, vMeta, customer, body, nMeta]

  const email = (first(sources, ['customer_email', 'email'], (v) => str(v, 160)) || '').toLowerCase()
  const name = first(sources, ['customer_name', 'name', 'full_name'], (v) => str(v, 80)) || ''
  const phone = (first(sources, ['customer_phone', 'phone_number', 'phone'], (v) => str(v, 30)) || '')
    .replace(/[\s().-]/g, '')

  const verifiedItem = items(verifiedRaw)
  const bodyItem = items(body)
  const vProduct = isObj(verifiedRaw.product) ? verifiedRaw.product : {}

  const productId =
    verifiedItem?.id || first([verifiedRaw, vMeta], ['product_id', 'productId'], (v) => str(v, 100)) ||
    str(vProduct.id, 100) || bodyItem?.id || ''
  const productSlug = (
    verifiedItem?.slug || first([verifiedRaw, vMeta], ['product_slug', 'productSlug'], (v) => str(v, 120)) ||
    str(vProduct.slug, 120) || bodyItem?.slug || ''
  ).toLowerCase()

  if (verifiedItem && bodyItem && verifiedItem.id && bodyItem.id && verifiedItem.id !== bodyItem.id) {
    return json({ error: 'product mismatch' }, 409)
  }

  const quantity =
    verifiedItem?.quantity ??
    bodyItem?.quantity ??
    (Number(first([verifiedRaw, vMeta, body, nMeta], ['quantity', 'qty'], (v) => (Number.isFinite(Number(v)) ? Number(v) : null))) || 1)

  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10) {
    return json({ error: 'invalid quantity' }, 400)
  }

  const amount = Number(verified.amount)
  const currency = (verified.currency || 'UGX').toUpperCase()
  if (!Number.isInteger(amount) || amount <= 0) return json({ error: 'invalid amount' }, 400)

  const storeSlug = env('DGATEWAY_STORE_SLUG').toLowerCase()
  if (storeSlug) {
    const found = (
      first([verifiedRaw, vMeta, body, nMeta], ['store_slug', 'app_slug', 'shop_slug'], (v) => str(v, 100)) || ''
    ).toLowerCase()
    if (found && found !== storeSlug) {
      return json({ error: 'payment belongs to a different store' }, 409)
    }
  }

  const providerRef =
    first([verifiedRaw, body], ['provider_ref', 'provider_reference'], (v) => str(v, 200)) || ''
  const reason = first([verifiedRaw, body], ['failure_reason'], (v) => str(v, 500)) || ''

  const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false },
  })

  const { data: result, error } = await admin.rpc('apply_store_topup', {
    p_reference: reference,
    p_status: status,
    p_amount: amount,
    p_currency: currency,
    p_quantity: quantity,
    p_product_id: productId || null,
    p_product_slug: productSlug || null,
    p_store_slug: storeSlug || null,
    p_buyer_name: name || null,
    p_buyer_email: email || null,
    p_buyer_phone: phone || null,
    p_provider: verified.provider || null,
    p_provider_ref: providerRef || null,
    p_failure: status === 'failed' ? reason || 'provider reported failure' : null,
  })

  if (error) {
    console.error('zengapay-store: database rejected verified payment', error.message)
    // 503 so DGateway retries rather than dropping a real payment.
    return json({ error: 'could not record payment' }, 503)
  }

  // Never echo the buyer email back; the caller only needs the outcome.
  const r = (result ?? {}) as Json
  return json({
    received: true,
    status,
    credited: Boolean(r.credited),
    parked_reason: r.parked_reason ?? null,
    replay: Boolean(r.replay),
  })
})
