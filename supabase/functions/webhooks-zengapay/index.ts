// supabase/functions/webhooks-zengapay/index.ts
//
// ZENGAPAY calls this when a payment settles. Rules, in order:
//   1. verify the HMAC signature over the raw body (fails closed)
//   2. match the `reference` we stored against our order
//   3. re-fetch the transaction from DGateway and confirm amount + currency
//   4. fulfil ONLY on "completed"; treat "failed" as final
//   5. be idempotent — a repeated reference must not credit twice
//
// This route must stay PUBLIC: the caller is ZENGAPAY, not a signed-in player.
// verify_jwt is therefore false on deploy, and the HMAC signature is the only
// thing standing between an anonymous request and a wallet credit. That is why
// every check below fails closed.
import { CORS, json, readEnv } from '../_shared/http.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.45.4'
import {
  fetchTransactionStatus, normalizeStatus, transactionMatches, verifyWebhookSignature,
  webhookDirection, webhookReference,
} from '../_shared/zengapay.ts'

/** Env var, trimmed. Missing becomes '' and never the string "undefined". */
const env = (key: string) => readEnv(key)

type Order = {
  order_id: string
  user_id: string
  direction: 'collect' | 'disburse'
  amount: number
  currency: string
  reference: string
  status: string
  cashout_id: string | null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight()
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  // The raw body is needed for the HMAC, so read text exactly once.
  const raw = await req.text()
  const signature =
    req.headers.get('X-ZENGAPAY-SIGNATURE') || req.headers.get('x-zengapay-signature')

  if (!(await verifyWebhookSignature(raw, signature))) {
    // 401 makes an unsigned or forged attempt visible in the logs.
    return json({ error: 'invalid signature' }, 401)
  }

  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(raw)
  } catch {
    return json({ error: 'invalid JSON body' }, 400)
  }

  // The reference is nested under `data` in a ZENGAPAY webhook, and the event
  // name says whether it describes a collection or a transfer.
  const reference = webhookReference(payload)
  if (!reference) return json({ error: 'reference is required' }, 400)
  const direction = webhookDirection(payload)

  const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false },
  })

  // ---- 2. match the reference we stored ------------------------------------
  const { data: rows, error: lookupError } = await admin
    .from('payment_orders')
    .select('*')
    .eq('reference', reference)
    .limit(1)

  if (lookupError) {
    console.error('webhook: order lookup failed', lookupError.message)
    return json({ error: 'storage unavailable' }, 503)
  }

  const order = (rows ?? [])[0] as Order | undefined
  if (!order) {
    // Unknown reference: never credit. 404 so ZENGAPAY stops retrying.
    return json({ error: 'unknown reference' }, 404)
  }

  // ---- 5. idempotency ------------------------------------------------------
  if (order.status === 'completed' || order.status === 'failed') {
    return json({ status: order.status, idempotent: true })
  }

  // ---- 3. re-verify with ZENGAPAY -----------------------------------------
  // The webhook body is a claim; the API is the truth. Trust only this.
  let tx
  try {
    tx = await fetchTransactionStatus(reference, direction)
  } catch (e) {
    // Ask the provider to retry rather than guessing.
    console.error('webhook: status re-fetch failed', (e as Error).message)
    return json({ error: 'could not verify with provider', retryable: true }, 502)
  }

  // `reference` must be passed: transactionMatches compares it first, so
  // omitting it made the function return false for EVERY payment and 409 every
  // legitimate webhook. The order is the authority on direction, too — a
  // transfer event that resolves to a collect order (or vice versa) is a
  // mismatch worth refusing.
  const expectedDirection = order.direction === 'disburse' ? 'disburse' : 'collect'
  if (!transactionMatches(tx, {
    reference,
    amount: order.amount,
    currency: order.currency,
    direction: expectedDirection,
  })) {
    // Amount or currency drift => do not fulfil. Record why.
    await admin
      .from('payment_orders')
      .update({ status: 'failed', failure_reason: 'provider mismatch: amount or currency' })
      .eq('reference', reference)
    return json({ error: 'transaction does not match the order' }, 409)
  }

  const status = normalizeStatus(tx.status)
  if (status === 'pending') {
    // Still processing; ZENGAPAY will call again.
    return json({ status: 'pending' })
  }

  // ---- 4. fulfil -----------------------------------------------------------
  // The RPC flips the order and credits/refunds the wallet atomically.
  const { error: applyError } = await admin.rpc('apply_gateway_result', {
    p_reference: reference,
    p_status: status,
    p_provider_ref: tx.provider_ref ?? null,
    p_failure_reason: status === 'failed' ? (tx.failure_reason ?? 'provider reported failure') : null,
  })

  if (applyError) {
    console.error('webhook: apply_gateway_result failed', applyError.message)
    return json({ error: 'fulfilment failed', retryable: true }, 500)
  }

  return json({ status })
})
