// supabase/functions/gift/index.ts
//
// The public "Float Me" page, server side.
//
//   GET  ?op=lookup&code=XXXX     what is being asked for (no personal data)
//   POST ?op=pay                  charge the SPONSOR's number, credit the REQUESTER
//
// WHY THIS IS A SEPARATE FUNCTION FROM `pay`
//
// `pay` authenticates every operation, and correctly so: a poller with no session
// could otherwise enumerate payment references. But the person who pays for a
// "Float Me" request is, by definition, usually not a player. They have a phone
// and a code from a friend. So this one route is public, and it is public in the
// narrowest possible way:
//
//   * the only thing a caller can learn from a code is an amount, a currency and
//     whether it is still payable;
//   * the only thing a caller can do is start a payment for EXACTLY that amount;
//   * the credit goes to the requester, never to the caller, so there is no
//     benefit to being the caller;
//   * a code is single-use, and paying one that is already paid is refused before
//     any charge is attempted.
//
// Every decision about money is still made by the database function
// `record_sponsor_collect` and by the existing webhook path, both of which
// re-derive the amount rather than trusting this file.
import { CORS, json, readEnv } from '../_shared/http.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.45.4'
import {
  GatewayError, assertLiveSafety, collectPayment, normalizePhone,
} from '../_shared/zengapay.ts'

const env = (key: string) => readEnv(key)

function serviceClient() {
  const url = env('SUPABASE_URL')
  const key = env('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) throw new Error('Supabase service credentials are not configured')
  return createClient(url, key, { auth: { persistSession: false } })
}

const MIN_DEPOSIT = 500
const MAX_DEPOSIT = 5_000_000

/** A code is 8 characters from an unambiguous alphabet; anything else is noise. */
const CODE_SHAPE = /^[A-HJ-NP-Z2-9]{8}$/

function cleanCode(raw: unknown): string {
  return String(raw ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
}

async function lookup(url: URL) {
  const code = cleanCode(url.searchParams.get('code'))
  if (!CODE_SHAPE.test(code)) {
    return json({ found: false, error: 'That is not a deposit code.' }, 400)
  }

  const { data, error } = await serviceClient().rpc('deposit_request_public', { p_code: code })
  if (error) {
    console.error('gift lookup failed', error.message)
    return json({ found: false, error: 'Could not check that code right now.' }, 503)
  }
  return json(data ?? { found: false })
}

async function pay(req: Request) {
  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return json({ error: 'invalid JSON body' }, 400)

  try { assertLiveSafety() } catch (e) {
    const err = e as GatewayError
    return json({ error: err.message, code: err.code }, err.httpStatus)
  }

  const code = cleanCode(body.code)
  if (!CODE_SHAPE.test(code)) return json({ error: 'That is not a deposit code.' }, 400)

  // The payer's own number. This is the only number charged, and it is the only
  // personal data this route accepts.
  const phone = normalizePhone(String(body.phone || ''))
  if (!phone) {
    return json({ error: 'Enter the mobile money number to pay from, e.g. 0758 443 666.' }, 400)
  }

  const client = serviceClient()

  // Read the request first so the charge is for the amount the requester set —
  // never for an amount this caller supplied.
  const { data: pub, error: pubErr } = await client.rpc('deposit_request_public', { p_code: code })
  if (pubErr) {
    console.error('gift pay: lookup failed', pubErr.message)
    return json({ error: 'Could not check that code right now.' }, 503)
  }
  const info = pub as { found?: boolean; amount?: number; currency?: string; status?: string } | null
  if (!info?.found) return json({ error: 'That deposit code does not exist.' }, 404)
  if (info.status !== 'pending') {
    return json({ error: `That request is already ${info.status}. Nothing was charged.` }, 409)
  }

  const amount = Number(info.amount)
  const currency = String(info.currency || 'UGX')
  if (!Number.isInteger(amount) || amount < MIN_DEPOSIT || amount > MAX_DEPOSIT) {
    // Cannot happen through the app; refuse rather than guess.
    return json({ error: 'That request is not payable.' }, 409)
  }

  const orderId = `GIFT-${code}-${Date.now().toString(36).toUpperCase()}`

  try {
    const tx = await collectPayment({
      amount,
      currency,
      phone_number: phone,
      description: `FloatBet deposit ${code}`,
      order_id: orderId,
    })

    /*
     * Record the order BEFORE answering. The credit itself happens on the
     * webhook, but the order is what the webhook looks the reference up by: with
     * no row, a completed payment would be an unknown reference and would never
     * credit the requester's wallet.
     *
     * This is the opposite of `pay`'s best-effort record, deliberately. There the
     * user is signed in and can be shown the failure; here the payer would walk
     * away believing their friend was funded.
     */
    const { error: recErr } = await client.rpc('record_sponsor_collect', {
      p_code: code,
      p_order: orderId,
      p_reference: tx.reference,
      p_amount: amount,
      p_currency: currency,
      p_phone: phone,
      p_provider: tx.provider ?? null,
    })

    if (recErr) {
      // The provider has already been asked to charge. We cannot un-ask it, so
      // say exactly that instead of pretending nothing happened.
      console.error('gift: record_sponsor_collect failed', recErr.message)
      return json({
        error:
          'The payment was started but we could not record it against this request. ' +
          'Contact support with the reference below before paying again.',
        reference: tx.reference,
        needsSupport: true,
      }, 502)
    }

    return json({
      reference: tx.reference,
      status: tx.status || 'pending',
      orderId,
      amount,
      currency,
      message: 'Check the paying phone and approve the prompt.',
    })
  } catch (e) {
    const err = e as GatewayError
    // `record_sponsor_collect` refuses a paid/expired code before we get here,
    // but the provider can also refuse; both are a 4xx/5xx with their own words.
    return json({ error: err.message, code: err.code }, err.httpStatus || 502)
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })

  const url = new URL(req.url)
  const op = url.searchParams.get('op') || ''

  try {
    if (req.method === 'GET' && op === 'lookup') return await lookup(url)
    if (req.method === 'POST' && op === 'pay') return await pay(req)
    return json({ error: 'unknown operation' }, 400)
  } catch (e) {
    console.error('gift failed', op, (e as Error).message)
    return json({ error: 'that request failed' }, 502)
  }
})
