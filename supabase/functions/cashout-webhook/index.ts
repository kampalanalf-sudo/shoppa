// POST /functions/v1/cashout-webhook
//
// DGateway calls this when a disbursement settles. We never trust the body:
// the HMAC signature is verified, then the transaction is re-fetched from
// DGateway and compared to the stored cashout before any money is finalised.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import {
  fetchTransactionStatus, json, normalizeStatus, transactionMatches, verifyWebhookSignature,
} from '../_shared/dgateway.ts'

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  // The raw body is required for the HMAC, so read it as text exactly once.
  const raw = await req.text()
  const signature = req.headers.get('X-DGateway-Signature')

  const ok = await verifyWebhookSignature(raw, signature)
  if (!ok) {
    // Fail closed. A weak or absent secret must never credit a payout.
    return json({ error: 'invalid signature' }, 401)
  }

  let payload: { reference?: string; status?: string }
  try {
    payload = JSON.parse(raw)
  } catch {
    return json({ error: 'invalid JSON body' }, 400)
  }

  const reference = payload.reference?.trim()
  if (!reference) return json({ error: 'reference is required' }, 400)

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  // Idempotency: a reference we already settled is a no-op.
  const { data: existing } = await admin
    .from('cashouts')
    .select('id, status, amount_px, ugx')
    .eq('provider_ref', reference)
    .maybeSingle()

  if (!existing) return json({ error: 'unknown reference' }, 404)
  if (['paid', 'failed', 'cancelled'].includes(existing.status)) {
    return json({ status: existing.status, idempotent: true })
  }

  // Re-verify with DGateway rather than trusting the webhook payload.
  let tx
  try {
    tx = await fetchTransactionStatus(reference)
  } catch (err) {
    return json({ error: (err as Error).message, retryable: true }, 502)
  }

  const matches = transactionMatches(tx, {
    reference,
    amount: Number(existing.ugx),
    currency: 'UGX',
    direction: 'disburse',
  })
  if (!matches) {
    // Amount or currency drift means we must not pay out. Flag for review.
    await admin.from('cashouts')
      .update({ status: 'failed', failure_reason: 'provider mismatch: amount/currency' })
      .eq('id', existing.id)
    return json({ error: 'transaction does not match the request' }, 409)
  }

  const status = normalizeStatus(tx.status)
  if (status === 'pending') return json({ status: 'pending' })

  await admin.rpc('settle_cashout', {
    p_cashout: existing.id,
    p_status: status === 'completed' ? 'paid' : 'failed',
    p_reason: status === 'failed' ? (tx.failure_reason || 'provider reported failure') : null,
  })

  return json({ status: status === 'completed' ? 'paid' : 'failed' })
})
