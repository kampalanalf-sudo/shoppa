// GET /api/admin/cashouts?status=requested|pending_provider|paid|failed|cancelled
//
// The withdrawal queue.
//
// This is the screen that decides whether the platform can pay anybody. There
// was no list of cashouts anywhere in the app before this: a payout request
// landed in the table and could only be found by writing SQL. That is fine
// while there are zero cashouts and untenable the day there are twenty.
//
// The lifetime totals are computed here rather than in SQL views because the
// numbers are small and the query is already scoped to a status.
import { requireAdmin } from '../_lib/admin'
import { json, methodNotAllowed, restSelect } from '../_lib/http'

type Row = {
  id: string
  user_id: string
  kind: string
  amount_px: number
  ugx: number
  phone: string | null
  rail: string | null
  asset: string | null
  address: string | null
  status: string
  failure_reason: string | null
  provider_ref: string | null
  created_at: string
}

type Profile = { id: string; username: string; suspended: boolean; phone_verified: boolean }

const STATUSES = ['requested', 'pending_provider', 'paid', 'failed', 'cancelled'] as const

export default async function handler(req: Request): Promise<Response> {
  const gate = await requireAdmin(req)
  if ('response' in gate) return gate.response
  if (req.method !== 'GET') return methodNotAllowed()

  const url = new URL(req.url)
  const status = url.searchParams.get('status') || 'requested'
  if (!STATUSES.includes(status as (typeof STATUSES)[number])) {
    return json({ error: 'invalid status' }, 400)
  }
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 100, 1), 200)

  try {
    const rows = await restSelect<Row>(
      `cashouts?status=eq.${status}&select=id,user_id,kind,amount_px,ugx,phone,rail,asset,address,status,failure_reason,provider_ref,created_at&order=created_at.asc&limit=${limit}`,
    )

    if (!rows.length) return json({ rows: [], players: {}, totals: null })

    // One query for the players behind these rows, rather than N.
    const ids = Array.from(new Set(rows.map((r) => r.user_id))).join(',')
    const profiles = await restSelect<Profile>(
      `profiles?id=in.(${ids})&select=id,username,suspended,phone_verified`,
    )
    const players = Object.fromEntries(
      profiles.map((p) => [p.id, { username: p.username, suspended: p.suspended, phone_verified: p.phone_verified }]),
    )

    const totals = {
      count: rows.length,
      px_held: rows.reduce((s, r) => s + Number(r.amount_px), 0),
      ugx_due: rows.reduce((s, r) => s + Number(r.ugx), 0),
      // Anything older than a day is a player wondering where their money is.
      oldest_hours: rows[0]
        ? Math.floor((Date.now() - new Date(rows[0].created_at).getTime()) / 3_600_000)
        : 0,
    }

    return json({ rows, players, totals })
  } catch (e) {
    console.error('admin cashouts failed', (e as Error).message)
    return json({ error: 'could not load the withdrawal queue' }, 502)
  }
}

export const config = { runtime: 'nodejs' }
