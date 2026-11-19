// GET /api/feed/sports?active=1
//
// Which competitions are actually in season right now.
//
// This exists because of a specific way to waste money: a sport key for a
// competition that is out of season still costs a credit to poll and returns an
// empty array. `SPORTS` in sync.ts is a hand-maintained list, and this route is
// how it gets re-checked — the provider does not charge for /v4/sports, so
// asking is free.
//
// Admin or cron only: the list is not secret, but the endpoint is a tool, not a
// public service, and leaving it open invites someone to use us as a proxy.
import { json, methodNotAllowed, preflight, requireUser, restSelect } from '../_lib/http'
import { OddsFeedError, fetchSports, isFeedConfigured } from '../_lib/oddsfeed'

async function isAdmin(userId: string): Promise<boolean> {
  try {
    const rows = await restSelect<{ is_admin: boolean }>(`profiles?id=eq.${userId}&select=is_admin`)
    return Boolean(rows[0]?.is_admin)
  } catch {
    return false
  }
}

async function authorized(req: Request): Promise<boolean> {
  const secret = (process.env.CRON_SECRET || '').trim()
  if (secret && (req.headers.get('Authorization') || '') === `Bearer ${secret}`) return true
  const user = await requireUser(req)
  return Boolean(user && (await isAdmin(user.id)))
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return preflight()
  if (req.method !== 'GET') return methodNotAllowed()
  if (!(await authorized(req))) return json({ error: 'not authorised' }, 401)
  if (!isFeedConfigured()) return json({ error: 'ODDS_API_KEY is not set.', code: 'ODDS_KEY_MISSING' }, 503)

  try {
    const all = await fetchSports()
    const active = req.url.includes('active=1')
    const sports = active ? all.filter((s) => s.active) : all

    // The six families this app can actually publish, so the answer to "what
    // should SPORTS be" is readable without scrolling 100 rows.
    const relevant = sports
      .filter((s) => /^(soccer|basketball|cricket|rugbyleague|tennis|mma)_/.test(s.key))
      .map((s) => s.key)
      .sort()

    return json({
      ok: true,
      creditsSpent: 0,
      count: sports.length,
      activeOnly: active,
      recommendedForSync: relevant.filter((k) => !k.includes('winner')),
    })
  } catch (e) {
    const err = e as OddsFeedError
    return json({ error: err.message, code: err.code ?? 'SPORTS_FAILED' }, err.status ?? 500)
  }
}
