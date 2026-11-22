// POST /api/admin/actions   { action, ... }
//
// The one endpoint that changes player state, and deliberately the only one.
// Every action passes through requireAdmin() and then through a SQL function
// that re-checks is_admin() against the database, so the flag is verified twice
// and neither check trusts the other.
//
// Actions, and why each exists:
//
//   adjust       Credit or debit a wallet by hand. The escape hatch for a stuck
//                payout or a duplicated charge. Requires a reason.
//   suspend      Stop a player playing. Keeps wallet and history intact.
//   unsuspend    Reverse that.
//   grant_admin  Give someone the admin flag.
//   revoke_admin Take it away. Refused if they are the last admin.
//   settle_cashout
//                Finish a withdrawal. This is the only path that pays money out,
//                and it does so through /api/disburse first, so the database is
//                never told a payout succeeded before the provider said so.
import { requireAdmin } from '../_lib/admin'
import {
  GatewayError, assertLiveSafety, disbursePayment, normalizePhone,
} from '../_lib/dgateway'
import { json, methodNotAllowed, readJson, restRpc, restSelect } from '../_lib/http'

type Body = {
  action?: string
  userId?: string
  deltaPx?: number
  reason?: string
  state?: boolean
  cashoutId?: string
  status?: 'paid' | 'failed' | 'cancelled'
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Cashout = {
  id: string
  user_id: string
  kind: string
  amount_px: number
  ugx: number
  phone: string | null
  status: string
}

export default async function handler(req: Request): Promise<Response> {
  const gate = await requireAdmin(req)
  if ('response' in gate) return gate.response
  if (req.method !== 'POST') return methodNotAllowed()

  const body = await readJson<Body>(req)
  if (!body?.action) return json({ error: 'action is required' }, 400)

  const admin = gate.admin.id
  const target = typeof body.userId === 'string' ? body.userId.trim() : ''

  try {
    switch (body.action) {
      // ------------------------------------------------------- adjust ----
      case 'adjust': {
        if (!UUID.test(target)) return json({ error: 'invalid player id' }, 400)
        const delta = Math.trunc(Number(body.deltaPx))
        if (!Number.isFinite(delta) || delta === 0) {
          return json({ error: 'deltaPx must be a non-zero whole number' }, 400)
        }
        // A typo of one zero is the difference between a courtesy credit and a
        // month's takings. Refuse anything absurd rather than let the database
        // balance guard be the only backstop.
        if (Math.abs(delta) > 5_000_000) {
          return json({ error: 'adjustments are capped at 5,000,000 PX (50,000 UGX)' }, 400)
        }
        const balance = await restRpc<number>('admin_adjust_balance', {
          p_admin: admin,
          p_user: target,
          p_delta: delta,
          p_reason: (body.reason || '').trim(),
        })
        return json({ ok: true, balance })
      }

      // ------------------------------------------------------ suspend ----
      case 'suspend':
      case 'unsuspend': {
        if (!UUID.test(target)) return json({ error: 'invalid player id' }, 400)
        await restRpc('admin_set_suspended', {
          p_admin: admin,
          p_user: target,
          p_state: body.action === 'suspend',
          p_reason: (body.reason || '').trim() || null,
        })
        return json({ ok: true, suspended: body.action === 'suspend' })
      }

      // --------------------------------------------------- admin flag ----
      case 'grant_admin':
      case 'revoke_admin': {
        if (!UUID.test(target)) return json({ error: 'invalid player id' }, 400)
        await restRpc('admin_set_admin_flag', {
          p_admin: admin,
          p_user: target,
          p_state: body.action === 'grant_admin',
        })
        return json({ ok: true })
      }

      // ------------------------------------------------- settle cashout --
      case 'settle_cashout': {
        const id = typeof body.cashoutId === 'string' ? body.cashoutId.trim() : ''
        if (!UUID.test(id)) return json({ error: 'invalid cashout id' }, 400)
        if (!body.status || !['paid', 'failed', 'cancelled'].includes(body.status)) {
          return json({ error: 'status must be paid, failed or cancelled' }, 400)
        }

        const rows = await restSelect<Cashout>(
          `cashouts?id=eq.${id}&select=id,user_id,kind,amount_px,ugx,phone,status&limit=1`,
        )
        const co = rows[0]
        if (!co) return json({ error: 'no such cashout' }, 404)
        if (['paid', 'failed', 'cancelled'].includes(co.status)) {
          return json({ error: `already ${co.status}` }, 409)
        }

        // Paying means actually paying. If the provider call fails we do NOT
        // mark it paid -- we leave it pending and say why. Marking a payout
        // complete because a button was pressed is how a player is told they
        // were paid when they were not.
        if (body.status === 'paid') {
          if (co.kind !== 'momo') {
            return json({ error: 'only mobile-money payouts can be sent from here' }, 400)
          }
          const phone = normalizePhone(co.phone || '')
          if (!phone) return json({ error: 'this cashout has no usable phone number' }, 400)

          try {
            assertLiveSafety()
          } catch (e) {
            const err = e as GatewayError
            return json({ error: err.message, code: err.code }, err.httpStatus)
          }

          try {
            const tx = await disbursePayment({
              amount: co.ugx,
              currency: 'UGX',
              phone_number: phone,
              description: 'FloatBet withdrawal',
            })
            // Record the provider reference before settling, so the audit trail
            // ties our row to theirs even if the settle call then fails.
            await restRpc('record_disburse', {
              p_user: co.user_id,
              p_order: `ADMIN-${co.id.slice(0, 8)}`,
              p_reference: tx.reference,
              p_amount: co.ugx,
              p_currency: 'UGX',
              p_phone: phone,
              p_provider: tx.provider ?? null,
              p_cashout: co.id,
            })
          } catch (e) {
            const err = e as GatewayError
            console.error('admin cashout disbursement failed', err.message)
            return json(
              {
                error: `The provider did not accept the payout: ${err.message}. Nothing was marked paid.`,
                code: err.code,
              },
              err.httpStatus ?? 502,
            )
          }
        }

        await restRpc('admin_settle_cashout', {
          p_admin: admin,
          p_cashout: id,
          p_status: body.status,
          p_reason: (body.reason || '').trim() || null,
        })
        return json({ ok: true, status: body.status })
      }

      default:
        return json({ error: 'unknown action' }, 400)
    }
  } catch (e) {
    const msg = (e as Error).message || 'that action failed'
    // Surface the database's own words: they name the real constraint, which is
    // what an operator needs to correct the request, not a generic apology.
    console.error('admin action failed', body.action, msg)
    return json({ error: msg }, 400)
  }
}

export const config = { runtime: 'nodejs' }
