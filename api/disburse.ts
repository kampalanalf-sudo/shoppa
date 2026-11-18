// POST /api/disburse
//
// Pays a customer out to mobile money (withdrawals). Server-only.
// You can disburse to ANY MTN/Airtel number the user supplies — it is not
// limited to one number.
//
// Request  { amount, currency?, phone, description?, orderId?, cashoutId? }
// Response { reference, status, provider }
//
// When `cashoutId` is supplied the payout is tied to the cashout hold created by
// request_cashout(), so the PX is only released once the provider confirms.
import {
  GatewayError, disbursePayment, isWholeAmount, normalizeCurrency, normalizePhone,
} from './_lib/dgateway'
import { json, methodNotAllowed, newOrderRef, preflight, readJson, requireUser, restRpc } from './_lib/http'

type Body = {
  amount?: number
  currency?: string
  phone?: string
  phone_number?: string
  description?: string
  orderId?: string
  cashoutId?: string
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return preflight()
  if (req.method !== 'POST') return methodNotAllowed()

  const body = await readJson<Body>(req)
  if (!body) return json({ error: 'invalid JSON body' }, 400)

  const user = await requireUser(req)
  if (!user) return json({ error: 'not authenticated' }, 401)

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
        p_user: user.id,
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

export const config = { runtime: 'nodejs' }
