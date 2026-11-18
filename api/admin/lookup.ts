// GET /api/admin/lookup?q=email-or-username
//
// Finds the account an admin means to credit. Returns only what an admin needs
// to make the decision — never a balance history, never a token.
import { requireAdmin } from '../_lib/admin'
import { json, restSelect } from '../_lib/http'

type Profile = { id: string; username: string; display_name: string | null; created_at: string }

export default async function handler(req: Request): Promise<Response> {
  const gate = await requireAdmin(req)
  if ('response' in gate) return gate.response
  if (req.method !== 'GET') return json({ error: 'method not allowed' }, 405)

  const q = (new URL(req.url).searchParams.get('q') || '').trim()
  if (q.length < 3) return json({ rows: [] })

  // Escape PostgREST pattern characters so a stray % cannot enumerate the table.
  const safe = q.replace(/[%,()*\\]/g, '').slice(0, 80)
  if (!safe) return json({ rows: [] })

  try {
    // Username is on profiles; email is on auth.users, so search usernames here
    // and offer the parked row's own email as the second path.
    const rows = await restSelect<Profile>(
      `profiles?or=(username.ilike.*${encodeURIComponent(safe)}*,display_name.ilike.*${encodeURIComponent(safe)}*)&select=id,username,display_name,created_at&limit=10`,
    )
    return json({ rows })
  } catch (e) {
    console.error('admin lookup failed', (e as Error).message)
    return json({ error: 'lookup failed' }, 502)
  }
}

export const config = { runtime: 'nodejs' }
