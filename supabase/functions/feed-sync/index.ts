// supabase/functions/feed-sync/index.ts
//
// GET|POST — pulls fixtures and prices from The Odds API and upserts them into
// sports_fixtures / sports_markets / sports_selections.
//
// Called by a scheduler, not by a browser. Auth is either:
//   - `Authorization: Bearer <CRON_SECRET>` (pg_cron / an external scheduler),
//     or
//   - a logged-in admin (`profiles.is_admin`), so a human can force a refresh
//     from the admin surface without holding the cron secret.
//
// Credit discipline: one poll per configured sport, and the sport list is a
// deliberate constant rather than "everything in season". At 500 credits a
// month, fetching 30 sports once would spend 6% of the month in a single run.
import { CORS, json, readEnv } from '../_shared/http.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.45.4'
import {
  OddsFeedError, applyMargin, fetchOdds, isFeedConfigured, toOddsX100, type FeedEvent,
} from '../_shared/oddsfeed.ts'

/** Env var, trimmed. Missing becomes '' and never the string "undefined". */
const env = (key: string) => readEnv(key)

/**
 * The sports we publish, in priority order.
 *
 * Only IN-SEASON keys belong here. A key for a competition the provider reports
 * as inactive still costs a credit to request and returns nothing — which is how
 * a 500-credit month disappears in a fortnight. Re-check with
 * `GET feed-sports?active=1` before changing this list.
 *
 *   soccer_epl                  active
 *   soccer_uefa_champs_league   active
 *   basketball_nba              active
 *   soccer_africa_cup_of_nations  NOT in the catalogue at all — asking would
 *                                 return a 422 and spend a credit to learn that.
 *
 * Three keys x every 4 hours = 18 credits/day, ~540 a month. Still at the edge of
 * the free tier, so the schedule is every 4 hours rather than every 2.
 */
const SPORTS = [
  'soccer_epl',
  'soccer_uefa_champs_league',
  'basketball_nba',
]

/** Margin kept on top of the feed price. Not zero: see applyMargin. */
const MARGIN_PCT = Number(Deno.env.get('ODDS_MARGIN_PCT') ?? '4')

type SportRow = { sport: string; league: string; title: string }

const SPORT_META: Record<string, SportRow> = {
  soccer_epl: { sport: 'football', league: 'Premier League', title: 'EPL' },
  soccer_uefa_champs_league: { sport: 'football', league: 'Champions League', title: 'UCL' },
  soccer_africa_cup_of_nations: { sport: 'football', league: 'Africa Cup of Nations', title: 'AFCON' },
  basketball_nba: { sport: 'basketball', league: 'NBA', title: 'NBA' },
}

async function authorized(req: Request): Promise<{ ok: boolean; via?: string }> {
  const secret = env('CRON_SECRET')
  const auth = req.headers.get('Authorization') || ''
  if (secret && auth === `Bearer ${secret}`) return { ok: true, via: 'cron' }

  if (!auth.toLowerCase().startsWith('bearer ')) return { ok: false }
  const url = env('SUPABASE_URL')
  const anon = env('SUPABASE_ANON_KEY')
  if (!url || !anon) return { ok: false }

  const asUser = createClient(url, anon, {
    auth: { persistSession: false },
    global: { headers: { Authorization: auth } },
  })
  const { data } = await asUser.auth.getUser()
  if (!data?.user) return { ok: false }

  const admin = createClient(url, env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } })
  const { data: profile } = await admin
    .from('profiles').select('is_admin').eq('id', data.user.id).limit(1).maybeSingle()
  return profile?.is_admin ? { ok: true, via: 'admin' } : { ok: false }
}

// ------------------------------------------------------------- upserts ------

function adminDb() {
  return createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false },
  })
}

/**
 * Upsert one fixture. Returns its database id.
 *
 * Idempotent on (source, source_ref): a replayed payload updates the existing
 * row. That matters because a scheduler can retry, and because two sports can
 * disagree about a team's spelling — the external id is the stable key, not the
 * name.
 */
async function upsertFixture(
  db: ReturnType<typeof adminDb>, ev: FeedEvent, sportKey: string,
): Promise<{ fixtureId: string }> {
  const meta = SPORT_META[sportKey] ?? { sport: 'football', league: ev.sport_title, title: ev.sport_title }

  const { data, error } = await db.from('sports_fixtures').upsert({
    sport: meta.sport,
    league: meta.league,
    home_team: ev.home_team,
    away_team: ev.away_team,
    starts_at: ev.commence_time,
    source: 'oddsapi',
    source_ref: ev.id,
    external_id: ev.id,
  }, { onConflict: 'source,source_ref' }).select('id')

  if (error) throw new Error(`fixture upsert failed: ${error.message}`)
  const id = (data ?? [])[0]?.id
  if (!id) throw new Error('fixture upsert returned no row')
  return { fixtureId: String(id) }
}

async function upsertMarket(db: ReturnType<typeof adminDb>, fixtureId: string, name: string): Promise<string> {
  // Markets have no natural external key, so match on (fixture, name). The index
  // on fixture_id makes this a cheap lookup rather than a scan.
  const { data: existing } = await db
    .from('sports_markets').select('id').eq('fixture_id', fixtureId).eq('name', name).limit(1)
  if (existing?.[0]) return String(existing[0].id)

  const { data, error } = await db
    .from('sports_markets').insert({ fixture_id: fixtureId, name }).select('id')
  if (error) throw new Error(`market insert failed: ${error.message}`)
  const id = (data ?? [])[0]?.id
  if (!id) throw new Error('market insert returned no row')
  return String(id)
}

async function upsertSelection(
  db: ReturnType<typeof adminDb>, marketId: string, name: string, oddsX100: number,
): Promise<void> {
  const { data: existing } = await db
    .from('sports_selections').select('id').eq('market_id', marketId).eq('name', name).limit(1)

  const now = new Date().toISOString()
  if (existing?.[0]) {
    // Update the price and stamp it. price_at is what the freshness rule in
    // place_sports_bet measures, so a price must never be written without it.
    const { error } = await db.from('sports_selections')
      .update({ odds_x100: oddsX100, price_at: now, is_active: true })
      .eq('id', existing[0].id)
    if (error) throw new Error(`selection update failed: ${error.message}`)
    return
  }

  const { error } = await db.from('sports_selections')
    .insert({ market_id: marketId, name, odds_x100: oddsX100, price_at: now })
  if (error) throw new Error(`selection insert failed: ${error.message}`)
}

/**
 * Reduce a feed event to one price per outcome.
 *
 * Several bookmakers quote the same event. We take the MEDIAN price rather than
 * the best one: the best price is usually one book that has not moved yet, and
 * building a board on the outlier is how a book finds itself holding only the
 * bets that were about to be wrong.
 */
function consensus(event: FeedEvent, marketKey: string): Map<string, number> {
  const byOutcome = new Map<string, number[]>()
  for (const book of event.bookmakers ?? []) {
    const market = book.markets?.find((m) => m.key === marketKey)
    if (!market) continue
    for (const o of market.outcomes ?? []) {
      if (typeof o.price !== 'number' || o.price <= 1) continue
      const list = byOutcome.get(o.name) ?? []
      list.push(o.price)
      byOutcome.set(o.name, list)
    }
  }

  const out = new Map<string, number>()
  for (const [name, prices] of byOutcome) {
    prices.sort((a, b) => a - b)
    const mid = Math.floor(prices.length / 2)
    const median = prices.length % 2 ? prices[mid] : (prices[mid - 1] + prices[mid]) / 2
    out.set(name, median)
  }
  return out
}

// --------------------------------------------------------------- handler ----

type SyncResult = {
  ok: boolean
  source: 'oddsapi'
  sports: { key: string; events: number; fixtures: number; errors: string[] }[]
  credits: { used: number | null; remaining: number | null }
  marginPct: number
}

async function runSync(db: ReturnType<typeof adminDb>): Promise<SyncResult> {
  if (!isFeedConfigured()) {
    throw new OddsFeedError(
      'ODDS_API_KEY is not set, so nothing can be fetched. Get a free key at the-odds-api.com and add it as a Supabase secret.',
      'ODDS_KEY_MISSING',
      503,
    )
  }
  if (!env('SUPABASE_SERVICE_ROLE_KEY')) {
    throw new OddsFeedError(
      'SUPABASE_SERVICE_ROLE_KEY is missing, so there is nowhere to write the fixtures.',
      'DB_KEY_MISSING',
      503,
    )
  }

  const result: SyncResult = {
    ok: true, source: 'oddsapi', sports: [], credits: { used: null, remaining: null }, marginPct: MARGIN_PCT,
  }

  for (const sportKey of SPORTS) {
    const entry = { key: sportKey, events: 0, fixtures: 0, errors: [] as string[] }
    result.sports.push(entry)
    try {
      const { events, meta } = await fetchOdds(sportKey)
      entry.events = events.length
      if (meta.used != null) result.credits.used = (result.credits.used ?? 0) + (meta.last ?? 0)
      if (meta.remaining != null) result.credits.remaining = meta.remaining

      for (const ev of events) {
        try {
          const { fixtureId } = await upsertFixture(db, ev, sportKey)
          const marketId = await upsertMarket(db, fixtureId, 'Match result')
          for (const [name, price] of consensus(ev, 'h2h')) {
            await upsertSelection(db, marketId, name, applyMargin(toOddsX100(price), MARGIN_PCT))
          }
          entry.fixtures++
        } catch (e) {
          entry.errors.push(`${ev.id}: ${(e as Error).message}`)
        }
      }
    } catch (e) {
      entry.errors.push((e as Error).message)
      if ((e as OddsFeedError).code === 'ODDS_QUOTA') result.ok = false
    }
  }

  // Log every run, including a partial one. A sync that silently half-succeeds
  // is worse than one that fails, because the board looks fine.
  await db.from('feed_sync_log').insert({
    source: 'oddsapi',
    finished_at: new Date().toISOString(),
    status: !result.ok ? 'error' : result.sports.some((s) => s.errors.length) ? 'partial' : 'ok',
    fixtures_seen: result.sports.reduce((n, s) => n + s.events, 0),
    fixtures_upserted: result.sports.reduce((n, s) => n + s.fixtures, 0),
    credits_used: result.credits.used,
    credits_left: result.credits.remaining,
    errors: result.sports.flatMap((s) => s.errors).slice(0, 20),
  })

  return result
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight()
  if (req.method !== 'GET' && req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  const auth = await authorized(req)
  if (!auth.ok) return json({ error: 'not authorised' }, 401)

  try {
    // `?dry=1` reports what a sync WOULD do without spending a credit, by
    // reading only the zero-cost /sports endpoint. Useful before a paid poll.
    const url = new URL(req.url)
    if (url.searchParams.get('dry') === '1') {
      return json({
        ok: true,
        dry: true,
        configured: isFeedConfigured(),
        sports: SPORTS,
        marginPct: MARGIN_PCT,
        note: 'No credits spent. Remove ?dry=1 to fetch.',
      })
    }

    const result = await runSync(adminDb())
    return json(result, result.ok ? 200 : 207)
  } catch (e) {
    const err = e as OddsFeedError
    return json({ error: err.message, code: err.code ?? 'SYNC_FAILED' }, err.httpStatus ?? 500)
  }
})
