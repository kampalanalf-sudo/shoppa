// supabase/functions/pay/index.ts
//
// The whole payments surface, as one Supabase Edge Function.
//
//   POST ?op=collect    charge a phone and open the mobile-money prompt
//   POST ?op=disburse   pay a withdrawal out
//   GET  ?op=status     poll a payment, memoised for 10s
//   POST ?op=claim      recover a hosted-store top-up by its reference
//
// WHY THIS EXISTS
//
// The same operations used to live on Vercel (api/pay.ts). Vercel has been
// failing every deploy for the shoppa project, and the hosting it produced is
// unreachable from the tooling that maintains this repo, so the app is served
// from GitHub Pages instead. Pages is static: it has no /api. Moving the
// server side onto Supabase — which already hosts the database and auth —
// removes the dependency on a host nobody can administer, and makes the whole
// stack deployable from this repository.
//
// The money rules are unchanged from api/pay.ts, deliberately, line for line.
// Anything that differs from that file is a bug.
import { CORS, json, readEnv } from '../_shared/http.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import {
  GatewayError, assertLiveSafety, collectPayment, disbursePayment, fetchTransactionStatus,
  isWholeAmount, normalizeCurrency, normalizePhone, normalizeStatus,
} from '../_shared/dgateway.ts'

/** Env var, trimmed. Missing becomes '' and never the string "undefined". */
const env = (key: string) => readEnv(key)

function serviceClient() {
  const url = env('SUPABASE_URL')
  const key = env('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) throw new Error('Supabase service credentials are not configured')
  return createClient(url, key, { auth: { persistSession: false } })
}

/**
 * Resolve the caller from their bearer token.
 *
 * This uses the ANON client carrying the caller's own Authorization header, so
 * `auth.getUser()` verifies the JWT rather than trusting anything in the body.
 * A caller can therefore never act as another user.
 */
async function requireUser(req: Request): Promise<{ id: string } | null> {
  const auth = req.headers.get('Authorization') || ''
  if (!auth.toLowerCase().startsWith('bearer ')) return null
  const url = env('SUPABASE_URL')
  const anon = env('SUPABASE_ANON_KEY')
  if (!url || !anon) return null
  const client = createClient(url, anon, {
    auth: { persistSession: false },
    global: { headers: { Authorization: auth } },
  })
  const { data, error } = await client.auth.getUser()
  if (error || !data?.user) return null
  return { id: data.user.id }
}

const publicOrigin = (req: Request) => {
  const app = env('APP_URL')
  if (app) return app.replace(/\/$/, '')
  const u = new URL(req.url)
  return `${u.protocol}//${u.host}`
}

// --------------------------------------------------------------- collect ---

async function collect(req: Request, userId: string) {
  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return json({ error: 'invalid JSON body' }, 400)

  try { assertLiveSafety() } catch (e) {
    const err = e as GatewayError
    return json({ error: err.message, code: err.code }, err.httpStatus)
  }

  const currency = normalizeCurrency(body.currency || 'UGX')
  const amount = body.amount
  if (!isWholeAmount(amount)) {
    return json({ error: 'amount must be a whole positive integer in minor units' }, 400)
  }

  const MAX_COLLECT = currency === 'UGX' ? 5_000_000 : 500_00
  if (amount > MAX_COLLECT) {
    return json({ error: `Maximum top-up is ${MAX_COLLECT.toLocaleString()} ${currency}.` }, 400)
  }
  const MIN_COLLECT = currency === 'UGX' ? 500 : 100
  if (amount < MIN_COLLECT) {
    return json({ error: `Minimum top-up is ${MIN_COLLECT.toLocaleString()} ${currency}.` }, 400)
  }

  const phone = normalizePhone(String(body.phone || body.phone_number || ''))
  if (!phone) {
    return json({ error: 'Enter a valid mobile money number (07XXXXXXXX, 2567XXXXXXXX or +2567XXXXXXXX).' }, 400)
  }

  const orderId = String(body.orderId || '').trim() || `TOP-${Date.now().toString(36).toUpperCase()}`
  const description = String(body.description || `FloatBet top-up ${orderId}`).slice(0, 120).trim()

  try {
    const tx = await collectPayment({
      amount,
      currency,
      phone_number: phone,
      description,
      callback_url: `${publicOrigin(req)}/functions/v1/webhooks-dgateway`,
    })

    // Best-effort record: a missing row must not fail a charge the provider has
    // already started. The webhook is what actually credits the wallet.
    try {
      await serviceClient().rpc('record_collect', {
        p_user: userId,
        p_order: orderId,
        p_reference: tx.reference,
        p_amount: amount,
        p_currency: currency,
        p_phone: phone,
        p_provider: tx.provider ?? null,
      })
    } catch (e) {
      console.error('record_collect failed', (e as Error).message)
    }

    return json({
      reference: tx.reference,
      status: tx.status || 'pending',
      provider: tx.provider ?? null,
      orderId,
      message: 'Check your phone and approve the prompt.',
    })
  } catch (e) {
    const err = e as GatewayError
    return json({ error: err.message, code: err.code }, err.httpStatus || 502)
  }
}

// -------------------------------------------------------------- disburse ---

async function disburse(req: Request, userId: string) {
  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return json({ error: 'invalid JSON body' }, 400)

  try { assertLiveSafety() } catch (e) {
    const err = e as GatewayError
    return json({ error: err.message, code: err.code }, err.httpStatus)
  }

  const currency = normalizeCurrency(body.currency || 'UGX')
  const amount = body.amount
  if (!isWholeAmount(amount)) {
    return json({ error: 'amount must be a whole positive integer in minor units' }, 400)
  }

  const phone = normalizePhone(String(body.phone || body.phone_number || ''))
  if (!phone) {
    return json({ error: 'Enter a valid mobile money number to pay out to (07, 2567 or +2567).' }, 400)
  }

  if (currency === 'UGX' && amount < 1000) {
    return json({ error: 'Minimum payout is 1,000 UGX.' }, 400)
  }
  const MAX_PAYOUT = currency === 'UGX' ? 2_000_000 : 200_00
  if (amount > MAX_PAYOUT) {
    return json({ error: `Payouts above ${MAX_PAYOUT.toLocaleString()} ${currency} need manual review. Contact support.` }, 400)
  }

  const orderId = String(body.orderId || '').trim() || `PAY-${Date.now().toString(36).toUpperCase()}`
  const description = String(body.description || 'FloatBet payout').slice(0, 120).trim()
  const cashoutId = typeof body.cashoutId === 'string' ? body.cashoutId : null

  try {
    const tx = await disbursePayment({ amount, currency, phone_number: phone, description })

    try {
      await serviceClient().rpc('record_disburse', {
        p_user: userId,
        p_order: orderId,
        p_reference: tx.reference,
        p_amount: amount,
        p_currency: currency,
        p_phone: phone,
        p_provider: tx.provider ?? null,
        // Keeps the payout tied to the cashout hold, so PX only releases when
        // the provider confirms.
        p_cashout: cashoutId,
      })
    } catch (e) {
      console.error('record_disburse failed', (e as Error).message)
    }

    return json({
      reference: tx.reference,
      status: tx.status || 'pending',
      provider: tx.provider ?? null,
      orderId,
      message: 'Payout submitted. It usually lands within a minute.',
    })
  } catch (e) {
    const err = e as GatewayError
    return json({ error: err.message, code: err.code }, err.httpStatus || 502)
  }
}

// ---------------------------------------------------------------- status ---

const MIN_INTERVAL_MS = 10_000

type StatusPayload = {
  reference: string
  status: 'pending' | 'completed' | 'failed'
  rawStatus?: string
  provider?: string | null
  amount?: number | null
  currency?: string | null
  failureReason?: string | null
}

/**
 * A warm isolate keeps these between invocations, which is what makes the
 * 10-second window worth having: ten tabs polling one reference produce one
 * upstream request.
 *
 * Note this is per-isolate, not global — a cold start or a second isolate starts
 * with an empty map. It is a courtesy to the provider, not a security control,
 * and the same was true of the Vercel version.
 */
const cache = new Map<string, { at: number; payload: StatusPayload }>()
const inflight = new Map<string, Promise<StatusPayload>>()

function gc() {
  const cutoff = Date.now() - 5 * 60_000
  for (const [k, v] of cache) if (v.at < cutoff) cache.delete(k)
}

async function status(url: URL) {
  const reference = (url.searchParams.get('reference') || '').trim()
  if (!reference) return json({ error: 'reference is required' }, 400)

  const fresh = url.searchParams.get('fresh') === '1'
  const hit = cache.get(reference)
  if (!fresh && hit && Date.now() - hit.at < MIN_INTERVAL_MS) {
    return json({ ...hit.payload, cached: true, pollAfterMs: MIN_INTERVAL_MS })
  }

  let pending = inflight.get(reference)
  if (!pending) {
    pending = (async (): Promise<StatusPayload> => {
      const tx = await fetchTransactionStatus(reference)
      const payload: StatusPayload = {
        reference,
        status: normalizeStatus(tx.status),
        rawStatus: tx.status,
        provider: tx.provider ?? null,
        amount: tx.amount ?? null,
        currency: tx.currency ?? null,
        failureReason: tx.failure_reason ?? null,
      }
      cache.set(reference, { at: Date.now(), payload })
      gc()
      return payload
    })().finally(() => inflight.delete(reference))
    inflight.set(reference, pending)
  }

  try {
    const payload = await pending
    return json({ ...payload, cached: false, pollAfterMs: MIN_INTERVAL_MS })
  } catch (e) {
    const err = e as GatewayError
    // Keep the last known good state rather than flapping to "unknown".
    if (hit) return json({ ...hit.payload, cached: true, stale: true, pollAfterMs: MIN_INTERVAL_MS })
    return json({ error: err.message, code: err.code }, err.httpStatus || 502)
  }
}

// ----------------------------------------------------------------- claim ---

type RpcResult = { ok?: boolean; credited?: boolean; px?: number; balance?: number; replay?: boolean }

async function claim(req: Request) {
  const body = await req.json().catch(() => ({})) as { reference?: string }
  const reference = typeof body?.reference === 'string' ? body.reference.trim() : ''
  if (!reference || reference.length > 200) return json({ error: 'reference is required' }, 400)

  try {
    // claim_store_topup takes the user from auth.uid(), not from the request, so
    // a caller can never credit somebody else's wallet.
    //
    // It MUST therefore be called with the CALLER's token, not the service key:
    // a service-role call carries no `sub`, so auth.uid() is null and the RPC
    // raises 'not signed in'. The Vercel version of this route used the service
    // key, which meant every claim failed with a 502. This is the fix.
    const url = env('SUPABASE_URL')
    const anon = env('SUPABASE_ANON_KEY')
    const auth = req.headers.get('Authorization') || ''
    if (!url || !anon || !auth) throw new Error('not signed in')

    const asUser = createClient(url, anon, {
      auth: { persistSession: false },
      global: { headers: { Authorization: auth } },
    })
    const { data, error } = await asUser.rpc('claim_store_topup', { p_reference: reference })
    if (error) throw new Error(error.message)

    const result = (data ?? {}) as RpcResult
    return json({
      credited: Boolean(result.credited),
      replay: Boolean(result.replay),
      px: result.px ?? null,
      balance: result.balance ?? null,
    })
  } catch (e) {
    const message = (e as Error).message || ''
    const known = /already been claimed|cannot be claimed|still pending|unknown reference/i.test(message)
    if (known) return json({ error: message }, 409)
    console.error('topup claim failed', message)
    return json({ error: 'could not claim this top-up' }, 502)
  }
}

// ---------------------------------------------------------------- router ---

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight()

  const url = new URL(req.url)
  const op = url.searchParams.get('op') || ''

  // Every operation is authenticated. `status` included: it reveals a payment's
  // state, so an unauthenticated poller would be a reference-enumeration oracle.
  const user = await requireUser(req)
  if (!user) return json({ error: 'not authenticated' }, 401)

  try {
    if (req.method === 'GET') {
      if (op === 'status') return await status(url)
      return json({ error: 'method not allowed' }, 405)
    }
    if (req.method === 'POST') {
      if (op === 'collect') return await collect(req, user.id)
      if (op === 'disburse') return await disburse(req, user.id)
      if (op === 'claim') return await claim(req)
      return json({ error: 'unknown operation' }, 400)
    }
    return json({ error: 'method not allowed' }, 405)
  } catch (e) {
    console.error('pay failed', op, (e as Error).message)
    return json({ error: 'that request failed' }, 502)
  }
})
