// POST /api/collect
//
// Charges a customer and opens a mobile-money prompt on their phone (or a Stripe
// card session for USD). Runs server-side only — the API key never leaves here.
//
// Request  { amount, currency?, phone, description?, orderId? }
// Response { reference, status, provider, orderId, message }
//
//   amount     whole units for mobile money (UGX/KES/TZS), cents for USD
//   currency   defaults to UGX
//   phone      07XXXXXXXX | 2567XXXXXXXX | +2567XXXXXXXX (also 254/255/250)
//
// The caller stores `reference` against the order and waits for the webhook.
import {
  GatewayError, collectPayment, isWholeAmount, normalizeCurrency, normalizePhone,
} from './_lib/dgateway'
import {
  json, methodNotAllowed, newOrderRef, preflight, publicOrigin, readJson, requireUser, restRpc,
} from './_lib/http'

type Body = {
  amount?: number
  currency?: string
  phone?: string
  phone_number?: string
  description?: string
  orderId?: string
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return preflight()
  if (req.method !== 'POST') return methodNotAllowed()

  const body = await readJson<Body>(req)
  if (!body) return json({ error: 'invalid JSON body' }, 400)

  const user = await requireUser(req)
  if (!user) return json({ error: 'not authenticated' }, 401)

  const currency = normalizeCurrency(body.currency || 'UGX')

  // Mobile money is whole units. Stripe USD is cents. Either way: integer.
  if (!isWholeAmount(body.amount)) {
    return json({ error: 'amount must be a whole positive integer in minor units' }, 400)
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
        p_user: user.id,
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

export const config = { runtime: 'nodejs' }
