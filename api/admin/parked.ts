// GET  /api/admin/parked?status=pending&limit=50
// POST /api/admin/parked   { reference, action: 'release', userId }
//                          { reference, action: 'dismiss' }
//
// The parked-payment queue: store top-ups that DGateway confirmed as paid but
// we could not safely credit, because the checkout email did not match exactly
// one account.
//
// Nothing here credits automatically. An admin looks at the row, decides who it
// belongs to, and releases it. Every release is attributed.
import { requireAdmin } from '../_lib/admin'
import { json, methodNotAllowed, readJson, restRpc, restSelect } from '../_lib/http'

type Row = {
  id: string
  reference: string
  status: string
  amount: number
  currency: string
  quantity: number
  product_slug: string | null
  buyer_name: string | null
  buyer_email: string | null
  buyer_phone: string | null
  parked_reason: string | null
  matched_by: string | null
  user_id: string | null
  created_at: string
}

export default async function handler(req: Request): Promise<Response> {
  const gate = await requireAdmin(req)
  if ('response' in gate) return gate.response

  if (req.method === 'GET') {
    const url = new URL(req.url)
    const status = url.searchParams.get('status') || 'pending'
    if (!['pending', 'completed', 'failed'].includes(status)) {
      return json({ error: 'invalid status' }, 400)
    }
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 50, 1), 200)

    try {
      // Parked rows first: those are the ones needing action.
      const rows = await restSelect<Row>(
        `store_topups?select=*&status=eq.${status}&order=created_at.desc&limit=${limit}`,
      )
      return json({ rows, count: rows.length })
    } catch (e) {
      console.error('admin parked list failed', (e as Error).message)
      return json({ error: 'could not load the queue' }, 502)
    }
  }

  if (req.method !== 'POST') return methodNotAllowed()

  const body = await readJson<{ reference?: string; action?: string; userId?: string }>(req)
  const reference = typeof body?.reference === 'string' ? body.reference.trim() : ''
  const action = body?.action

  if (!reference) return json({ error: 'reference is required' }, 400)
  if (action !== 'release' && action !== 'dismiss') {
    return json({ error: "action must be 'release' or 'dismiss'" }, 400)
  }

  if (action === 'dismiss') {
    // Marking a parked payment as failed. It must never have been credited, and
    // store_topups.status is the flag the player's claim path checks.
    try {
      await restRpc('dismiss_store_topup', { p_reference: reference, p_admin_id: gate.admin.id })
      return json({ ok: true, action: 'dismiss' })
    } catch (e) {
      console.error('admin dismiss failed', (e as Error).message)
      return json({ error: 'could not dismiss that payment' }, 502)
    }
  }

  const userId = typeof body?.userId === 'string' ? body.userId.trim() : ''
  if (!userId) return json({ error: 'userId is required to release a payment' }, 400)

  try {
    const result = await restRpc<{ ok?: boolean; px?: number; balance?: number; replay?: boolean }>(
      'admin_release_store_topup',
      { p_reference: reference, p_user_id: userId, p_admin_id: gate.admin.id },
    )
    return json({
      ok: true,
      action: 'release',
      credited: true,
      replay: Boolean(result?.replay),
      px: result?.px ?? null,
      balance: result?.balance ?? null,
      admin: gate.admin.username,
    })
  } catch (e) {
    const message = (e as Error).message || ''
    // These are the SQL's own messages for states an admin cannot override.
    if (/already been credited|failed payments cannot|still pending|unknown reference|wallet missing/i.test(message)) {
      return json({ error: message }, 409)
    }
    console.error('admin release failed', message)
    return json({ error: 'could not release that payment' }, 502)
  }
}

export const config = { runtime: 'nodejs' }
