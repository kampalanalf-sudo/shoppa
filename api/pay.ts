// api/pay.ts
//
// Every payment endpoint, behind one router.
//
// WHY
//
// The Vercel Hobby plan allows 12 Serverless Functions per deployment. This
// project reached 16, and every deploy since has failed with
// `exceeded_serverless_functions_per_deployment` -- the merge succeeds, CI is
// green, and production silently keeps serving the previous commit. That has
// happened three times now.
//
// /api/collect, /api/disburse, /api/status and /api/topup/claim were four small
// functions over one shared DGateway client. They are now four operations here,
// and vercel.json rewrites the original paths so every caller is unchanged.
//
// NOTHING ABOUT THE MONEY RULES CHANGED. Each operation's body is the original
// handler's, moved rather than rewritten:
//
//   ?op=collect    POST  charge a phone and open the prompt
//   ?op=disburse   POST  pay a withdrawal out
//   ?op=status     GET   poll a payment, memoised for 10s
//   ?op=claim      POST  recover a store top-up by its reference
//
// The one thing shared rather than repeated is `requireUser()`. All four
// operations already called it first; the router calls it once, so there is no
// path into any of them that skips authentication.
import {
  GatewayError, assertLiveSafety, collectPayment, disbursePayment, fetchTransactionStatus,
  isWholeAmount, normalizeCurrency, normalizePhone, normalizeStatus,
} from './_lib/dgateway'
import {
  json, methodNotAllowed, newOrderRef, preflight, publicOrigin, readJson, requireUser, restRpc,
} from './_lib/http'

// ------------------------------------------------------------- collect -----

type CollectBody = {
  amount?: number
  currency?: string
  phone?: string
  phone_number?: string
  description?: string
  orderId?: string
}

async function collect(req: Request, userId: string): Promise<Response> {
  const body = await readJson<CollectBody>(req)
  if (!body) return json({ error: 'invalid JSON body' }, 400)

  // Live money: refuse to charge unless the webhook can be verified.
  try {
    assertLiveSafety()
  } catch (e) {
    const err = e as GatewayError
    return json({ error: err.message, code: err.code }, err.httpStatus)
  }

  const currency = normalizeCurrency(body.currency || 'UGX')

  // Mobile money is whole units. Stripe USD is cents. Either way: integer.
  if (!isWholeAmount(body.amount)) {
    return json({ error: 'amount must be a whole positive integer in minor units' }, 400)
  }

  // Ceilings keep a fat-fingered or malicious request from moving a huge sum.
  const MAX_COLLECT = currency === 'UGX' ? 5_000_000 : 500_00
  if (body.amount > MAX_COLLECT) {
    return json({ error: `Maximum top-up is ${MAX_COLLECT.toLocaleString()} ${currency}.` }, 400)
  }
  const MIN_COLLECT = currency === 'UGX' ? 500 : 100
  if (body.amount < MIN_COLLECT) {
    return json({ error: `Minimum top-up is ${MIN_COLLECT.toLocaleString()} ${currency}.` }, 400)
  }

  const phone = normalizePhone(body.phone || body.phone_number || '')
  if (!phone) {
    return json(
      { error: 'Enter a valid mobile money number (07XXXXXXXX, 2567XXXXXXXX or +2567XXXXXXXX).' },
      400,
    )
  }

  const description = (body.description || `FloatBet top-up ${body.orderId || ''}`).slice(0, 120).trim()
  const orderId = body.orderId || newOrderRef('TOP')

  try {
    const tx = await collectPayment({
      amount: body.amount,
      currency,
      // keep the leading 0 / country code exactly as supplied
      phone_number: phone,
      description,
      callback_url: `${publicOrigin(req)}/api/webhooks/dgateway`,
    })

    // Record the reference against the order so the webhook can find it.
    // Best-effort: a missing DB must not fail the charge that already started.
    try {
      await restRpc('record_collect', {
        p_user: userId,
        p_order: orderId,
        p_reference: tx.reference,
        p_amount: body.amount,
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

// ------------------------------------------------------------ disburse -----

type DisburseBody = {
  amount?: number
  currency?: string
  phone?: string
  phone_number?: string
  description?: string
  orderId?: string
  cashoutId?: string
}

async function disburse(req: Request, userId: string): Promise<Response> {
  const body = await readJson<DisburseBody>(req)
  if (!body) return json({ error: 'invalid JSON body' }, 400)

  try {
    assertLiveSafety()
  } catch (e) {
    const err = e as GatewayError
    return json({ error: err.message, code: err.code }, err.httpStatus)
  }

  const currency = normalizeCurrency(body.currency || 'UGX')

  if (!isWholeAmount(body.amount)) {
    return json({ error: 'amount must be a whole positive integer in minor units' }, 400)
  }

  const phone = normalizePhone(body.phone || body.phone_number || '')
  if (!phone) {
    return json(
      { error: 'Enter a valid mobile money number to pay out to (07, 2567 or +2567).' },
      400,
    )
  }

  // Smallest sane guard so a malformed request cannot drain a wallet.
  if (currency === 'UGX' && body.amount < 1000) {
    return json({ error: 'Minimum payout is 1,000 UGX.' }, 400)
  }
  // Hard per-payout cap. Anything larger needs a manual, human review.
  const MAX_PAYOUT = currency === 'UGX' ? 2_000_000 : 200_00
  if (body.amount > MAX_PAYOUT) {
    return json(
      { error: `Payouts above ${MAX_PAYOUT.toLocaleString()} ${currency} need manual review. Contact support.` },
      400,
    )
  }

  const description = (body.description || 'FloatBet payout').slice(0, 120).trim()
  const orderId = body.orderId || newOrderRef('PAY')

  try {
    const tx = await disbursePayment({
      amount: body.amount,
      currency,
      phone_number: phone,
      description,
    })

    try {
      await restRpc('record_disburse', {
        p_user: userId,
        p_order: orderId,
        p_reference: tx.reference,
        p_amount: body.amount,
        p_currency: currency,
        p_phone: phone,
        p_provider: tx.provider ?? null,
        p_cashout: body.cashoutId ?? null,
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

// -------------------------------------------------------------- status -----

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

// Module scope survives between invocations on a warm lambda, which is what
// makes the 10-second window worth having: ten tabs polling one reference
// produce one upstream request.
const cache = new Map<string, { at: number; payload: StatusPayload }>()
const inflight = new Map<string, Promise<StatusPayload>>()

function gc() {
  const cutoff = Date.now() - 5 * 60_000
  for (const [k, v] of cache) if (v.at < cutoff) cache.delete(k)
}

async function status(url: URL): Promise<Response> {
  const reference = (url.searchParams.get('reference') || '').trim()
  if (!reference) return json({ error: 'reference is required' }, 400)

  // Serve from the 10-second window unless the caller demands freshness.
  const fresh = url.searchParams.get('fresh') === '1'
  const hit = cache.get(reference)
  if (!fresh && hit && Date.now() - hit.at < MIN_INTERVAL_MS) {
    return json({ ...hit.payload, cached: true, pollAfterMs: MIN_INTERVAL_MS })
  }

  // Collapse concurrent polls for the same reference into one upstream call.
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
    // Keep the last known good state on a transient upstream failure so the UI
    // does not flap back to "unknown".
    if (hit) return json({ ...hit.payload, cached: true, stale: true, pollAfterMs: MIN_INTERVAL_MS })
    return json({ error: err.message, code: err.code }, err.httpStatus || 502)
  }
}

// --------------------------------------------------------------- claim -----

type RpcResult = { ok?: boolean; credited?: boolean; px?: number; balance?: number; replay?: boolean }

async function claim(req: Request): Promise<Response> {
  const body = await readJson<{ reference?: string }>(req)
  const reference = typeof body?.reference === 'string' ? body.reference.trim() : ''
  if (!reference || reference.length > 200) return json({ error: 'reference is required' }, 400)

  try {
    // claim_store_topup takes the user from auth.uid() and is granted to
    // `authenticated` only, so a caller can never credit another wallet.
    const result = await restRpc<RpcResult>('claim_store_topup', { p_reference: reference })
    return json({
      credited: Boolean(result?.credited),
      replay: Boolean(result?.replay),
      px: result?.px ?? null,
      balance: result?.balance ?? null,
    })
  } catch (e) {
    // The RPC raises a readable message for already-claimed / failed / pending.
    const message = (e as Error).message || ''
    const known =
      /already been claimed|cannot be claimed|still pending|unknown reference/i.test(message)
    if (known) return json({ error: message }, 409)
    console.error('topup claim failed', message)
    return json({ error: 'could not claim this top-up' }, 502)
  }
}

// -------------------------------------------------------------- router -----

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return preflight()

  const url = new URL(req.url)
  const op = url.searchParams.get('op') || ''

  // Every operation is authenticated. status included: it exposes a payment's
  // state, and an unauthenticated poller would be an enumeration oracle for
  // references.
  const user = await requireUser(req)
  if (!user) return json({ error: 'not authenticated' }, 401)

  try {
    if (req.method === 'GET') {
      if (op === 'status') return await status(url)
      return methodNotAllowed()
    }

    if (req.method === 'POST') {
      if (op === 'collect') return await collect(req, user.id)
      if (op === 'disburse') return await disburse(req, user.id)
      if (op === 'claim') return await claim(req)
      return json({ error: 'unknown operation' }, 400)
    }

    return methodNotAllowed()
  } catch (e) {
    console.error('pay router failed', op, (e as Error).message)
    return json({ error: 'that request failed' }, 502)
  }
}

export const config = { runtime: 'nodejs' }
