// POST /api/webhooks/dgateway
//
// DGateway calls this when a payment settles. Rules, in order:
//   1. verify the HMAC signature over the raw body (fails closed)
//   2. match the `reference` we stored against our order
//   3. re-fetch the transaction from DGateway and confirm amount + currency
//   4. fulfil ONLY on "completed"; treat "failed" as final
//   5. be idempotent — a repeated reference must not credit twice
import {
  fetchTransactionStatus, normalizeStatus, transactionMatches, verifyWebhookSignature,
} from '../_lib/dgateway'
import { json, methodNotAllowed, restPatch, restRpc, restSelect } from '../_lib/http'

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

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return methodNotAllowed()

  // The raw body is needed for the HMAC, so read text exactly once.
  const raw = await req.text()
  const signature =
    req.headers.get('X-DGateway-Signature') ||
    req.headers.get('x-dgateway-signature')

  if (!(await verifyWebhookSignature(raw, signature))) {
    // Never trust an unsigned webhook. 401 makes the failure visible in logs.
    return json({ error: 'invalid signature' }, 401)
  }

  let payload: { reference?: string; status?: string }
  try {
    payload = JSON.parse(raw)
  } catch {
    return json({ error: 'invalid JSON body' }, 400)
  }

  const reference = (payload.reference || '').trim()
  if (!reference) return json({ error: 'reference is required' }, 400)

  // ---- 2. match the reference we stored -----------------------------------
  let order: Order | undefined
  try {
    const rows = await restSelect<Order>(
      `payment_orders?reference=eq.${encodeURIComponent(reference)}&select=*&limit=1`,
    )
    order = rows[0]
  } catch (e) {
    console.error('webhook: order lookup failed', (e as Error).message)
    return json({ error: 'storage unavailable' }, 503)
  }

  if (!order) {
    // Unknown reference: never credit. 404 so DGateway stops retrying.
    return json({ error: 'unknown reference' }, 404)
  }

  // ---- 5. idempotency -----------------------------------------------------
  if (order.status === 'completed' || order.status === 'failed') {
    return json({ status: order.status, idempotent: true })
  }

  // ---- 3. re-verify with DGateway ----------------------------------------
  let tx
  try {
    tx = await fetchTransactionStatus(reference)
  } catch (e) {
    // Ask the provider to retry rather than guessing.
    console.error('webhook: status re-fetch failed', (e as Error).message)
    return json({ error: 'could not verify with provider', retryable: true }, 502)
  }

  if (!transactionMatches(tx, { amount: order.amount, currency: order.currency })) {
    // Amount or currency drift => do not fulfil. Record the reason.
    await restPatch(`payment_orders?reference=eq.${encodeURIComponent(reference)}`, {
      status: 'failed',
      failure_reason: 'provider mismatch: amount or currency',
    }).catch(() => {})
    return json({ error: 'transaction does not match the order' }, 409)
  }

  const status = normalizeStatus(tx.status)
  if (status === 'pending') {
    // Still processing; DGateway will call again.
    return json({ status: 'pending' })
  }

  // ---- 4. fulfil ----------------------------------------------------------
  try {
    // The RPC flips the order and credits/refunds the wallet atomically.
    await restRpc('apply_gateway_result', {
      p_reference: reference,
      p_status: status,
      p_provider_ref: tx.provider_ref ?? null,
      p_failure_reason: status === 'failed' ? (tx.failure_reason ?? 'provider reported failure') : null,
    })
  } catch (e) {
    console.error('webhook: apply_gateway_result failed', (e as Error).message)
    return json({ error: 'fulfilment failed', retryable: true }, 500)
  }

  return json({ status })
}

export const config = { runtime: 'nodejs' }
