// GET /api/admin/audit?limit=100
//
// Everything an admin has done, newest first.
//
// This is the read side of admin_actions. It exists because a log that nobody
// can read is not accountability, it is decoration. If two operators disagree
// about who refunded an account, this is the answer.
import { requireAdmin } from '../_lib/admin'
import { json, methodNotAllowed, restSelect } from '../_lib/http'

type Action = {
  id: number
  admin_id: string
  action: string
  target_id: string | null
  detail: Record<string, unknown> | null
  created_at: string
}

export default async function handler(req: Request): Promise<Response> {
  const gate = await requireAdmin(req)
  if ('response' in gate) return gate.response
  if (req.method !== 'GET') return methodNotAllowed()

  const limit = Math.min(Math.max(Number(new URL(req.url).searchParams.get('limit')) || 100, 1), 500)

  try {
    const actions = await restSelect<Action>(
      `admin_actions?select=id,admin_id,action,target_id,detail,created_at&order=created_at.desc&limit=${limit}`,
    )
    if (!actions.length) return json({ rows: [] })

    // Resolve both sides to usernames so the log reads as people, not uuids.
    const ids = Array.from(
      new Set(
        actions.flatMap((a) => [a.admin_id, a.target_id].filter((x): x is string => Boolean(x))),
      ),
    ).join(',')
    const profiles = await restSelect<{ id: string; username: string }>(
      `profiles?id=in.(${ids})&select=id,username`,
    )
    const names = Object.fromEntries(profiles.map((p) => [p.id, p.username]))

    return json({
      rows: actions.map((a) => ({
        ...a,
        admin_name: names[a.admin_id] ?? a.admin_id.slice(0, 8),
        target_name: a.target_id ? names[a.target_id] ?? a.target_id.slice(0, 8) : null,
      })),
    })
  } catch (e) {
    console.error('admin audit failed', (e as Error).message)
    return json({ error: 'could not load the audit trail' }, 502)
  }
}

export const config = { runtime: 'nodejs' }
