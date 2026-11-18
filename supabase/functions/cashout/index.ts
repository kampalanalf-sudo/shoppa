// POST /functions/v1/cashout
//
// Turns a player's held PX into real money. Two rails:
//   { kind: 'momo',   cashoutId }             -> DGateway disburse to MTN/Airtel
//   { kind: 'crypto', cashoutId, asset }      -> records a ProxiCash crypto payout
//
// The PX was already debited by request_cashout() in the database, so this
// function only moves the fiat/crypto leg. Any failure refunds the hold.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import {
  CORS, GatewayError, cleanPhone, disbursePayment, env, isValidGatewayPhone, json,
} from '../_shared/dgateway.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const authHeader = req.headers.get('Authorization') || ''

  // Identify the caller from their JWT, never from the request body.
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: { user }, error: authErr } = await userClient.auth.getUser()
  if (authErr || !user) return json({ error: 'not authenticated' }, 401)

  const admin = createClient(supabaseUrl, serviceKey)

  let body: { cashoutId?: string; asset?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'invalid JSON body' }, 400)
  }

  const cashoutId = body.cashoutId
  if (!cashoutId) return json({ error: 'cashoutId is required' }, 400)

  // Load the hold and make sure it belongs to this user and is still open.
  const { data: cashout, error: loadErr } = await admin
    .from('cashouts')
    .select('*')
    .eq('id', cashoutId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (loadErr) return json({ error: 'could not load cashout' }, 500)
  if (!cashout) return json({ error: 'cashout not found' }, 404)
  if (cashout.status !== 'requested') {
    return json({ error: `cashout is already ${cashout.status}` }, 409)
  }

  // ------------------------------------------------------------- crypto -----
  if (cashout.kind === 'crypto') {
    // Crypto payouts are fulfilled by the ProxiCash desk, not DGateway. We
    // record the request and leave it pending provider action.
    await admin.from('cashouts')
      .update({ status: 'pending_provider' })
      .eq('id', cashoutId)

    return json({
      status: 'pending_provider',
      kind: 'crypto',
      asset: cashout.asset,
      address: cashout.address,
      message: 'Send the exact amount to the address shown. Payouts are reviewed before release.',
    })
  }

  // --------------------------------------------------------------- momo -----
  const phone = cleanPhone(cashout.phone || '')
  if (!isValidGatewayPhone(phone)) {
    await admin.rpc('settle_cashout', {
      p_cashout: cashoutId,
      p_status: 'failed',
      p_reason: 'invalid mobile money number',
    })
    return json({ error: 'The saved phone number is not a valid Ugandan mobile money number.' }, 400)
  }

  try {
    const tx = await disbursePayment({
      amount: Number(cashout.ugx),
      currency: 'UGX',
      phone_number: phone,
      description: `FloatBet payout ${cashoutId.slice(0, 8)}`,
      callback_url: env.appUrl ? `${env.appUrl}/functions/v1/cashout-webhook` : undefined,
    })

    await admin.from('cashouts')
      .update({ status: 'pending_provider', provider_ref: tx.reference })
      .eq('id', cashoutId)

    return json({
      status: 'pending_provider',
      reference: tx.reference,
      ugx: cashout.ugx,
      message: 'Payout submitted. Mobile money usually settles in under a minute.',
    })
  } catch (err) {
    const e = err as GatewayError
    // A hard rejection releases the hold back to the player.
    if (e.status === 400) {
      await admin.rpc('settle_cashout', {
        p_cashout: cashoutId,
        p_status: 'failed',
        p_reason: e.message,
      })
      return json({ error: e.message, code: e.code }, 400)
    }
    // Anything else is retryable: leave the hold intact.
    return json({ error: e.message, code: e.code, retryable: true }, e.status || 502)
  }
})
