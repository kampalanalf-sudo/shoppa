// api/_lib/admin.ts
//
// Admin gate for the parked-payment queue.
//
// Three separate checks, in this order, because this is the endpoint that can
// move money:
//   1. a bearer token that resolves to a real user
//   2. that user's profile must have is_admin = true
//   3. every action is recorded, so a credit is never anonymous
//
// The profile lookup uses the service role, so `is_admin` cannot be spoofed by
// a client-supplied field — it is read from the database on every request.
import { json, requireUser, supabaseAdminConfig } from './http'

export type Admin = { id: string; username: string }

export async function requireAdmin(req: Request): Promise<{ admin: Admin } | { response: Response }> {
  const user = await requireUser(req)
  if (!user) return { response: json({ error: 'not signed in' }, 401) }

  const { url, key, ready } = supabaseAdminConfig()
  if (!ready) return { response: json({ error: 'admin is not configured on the server' }, 503) }

  const res = await fetch(
    `${url}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=id,username,is_admin&limit=1`,
    { headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' } },
  )
  if (!res.ok) return { response: json({ error: 'could not verify admin access' }, 502) }

  const rows = (await res.json().catch(() => [])) as { id: string; username: string; is_admin: boolean }[]
  const profile = rows[0]

  // 403 rather than 404: the caller is authenticated, just not an admin.
  if (!profile?.is_admin) return { response: json({ error: 'admin access required' }, 403) }

  return { admin: { id: profile.id, username: profile.username } }
}
