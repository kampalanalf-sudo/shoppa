// supabase/functions/feed-sports/index.ts
//
// GET ?active=1 — which competitions are actually in season right now.
//
// This exists because of a specific way to waste money: a sport key for a
// competition that is out of season still costs a credit to poll and returns an
// empty array. `SPORTS` in feed-sync is a hand-maintained list, and this route
// is how it gets re-checked — the provider does not charge for /v4/sports, so
// asking is free.
//
// Admin or cron only: the list is not secret, but the endpoint is a tool, not a
// public service, and leaving it open invites someone to use us as a proxy.
import { CORS, json, readEnv } from '../_shared/http.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.45.4'
import { OddsFeedError, fetchSports, isFeedConfigured } from '../_shared/oddsfeed.ts'

/** Env var, trimmed. Missing becomes '' and never the string "undefined". */
const env = (key: string) => readEnv(key)

async function authorized(req: Request): Promise<boolean> {
  const secret = env('CRON_SECRET')
  if (secret && (req.headers.get('Authorization') || '') === `Bearer ${secret}`) return true

  const auth = req.headers.get('Authorization') || ''
  if (!auth.toLowerCase().startsWith('bearer ')) return false

  const url = env('SUPABASE_URL')
  const anon = env('SUPABASE_ANON_KEY')
  if (!url || !anon) return false

  const asUser = createClient(url, anon, {
    auth: { persistSession: false },
    global: { headers: { Authorization: auth } },
  })
  const { data } = await asUser.auth.getUser()
  if (!data?.user) return false

  const admin = createClient(url, env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } })
  const { data: profile } = await admin
    .from('profiles').select('is_admin').eq('id', data.user.id).limit(1).maybeSingle()
  return Boolean(profile?.is_admin)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight()
  if (req.method !== 'GET') return json({ error: 'method not allowed' }, 405)
  if (!(await authorized(req))) return json({ error: 'not authorised' }, 401)
  if (!isFeedConfigured()) return json({ error: 'ODDS_API_KEY is not set.', code: 'ODDS_KEY_MISSING' }, 503)

  try {
    const all = await fetchSports()
    const active = new URL(req.url).searchParams.get('active') === '1'
    const sports = active ? all.filter((s) => s.active) : all

    // The six families this app can actually publish, so the answer to
    // "what should SPORTS be" is readable without scrolling 100 rows.
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
    return json({ error: err.message, code: err.code ?? 'SPORTS_FAILED' }, err.httpStatus ?? 500)
  }
})
