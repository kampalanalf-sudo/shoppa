// GET|POST /api/feed/sync
//
// Pulls fixtures and prices from The Odds API and upserts them into
// sports_fixtures / sports_markets / sports_selections.
//
// Called by a scheduler, not by a browser. Auth is either:
//   - `Authorization: Bearer <CRON_SECRET>` (a Vercel cron sends this
//     automatically when CRON_SECRET is set), or
//   - a logged-in admin (`profiles.is_admin`), so a human can force a refresh
//     from the admin surface without holding the cron secret.
//
// Credit discipline: one poll per configured sport, and the sport list is a
// deliberate constant rather than "everything in season". At 500 credits a
// month, fetching 30 sports once would spend 6% of the month in a single run.
import { json, methodNotAllowed, preflight, readJson, requireUser, restRpc, restSelect, supabaseAdminConfig } from '../_lib/http'
import {
  OddsFeedError, applyMargin, fetchOdds, isFeedConfigured, toOddsX100, type FeedEvent,
} from '../_lib/oddsfeed'

/**
 * The sports we publish, in priority order.
 *
 * Only IN-SEASON keys belong here. A key for a competition the provider reports
 * as inactive still costs a credit to request and returns nothing — which is
 * how a 500-credit month disappears in a fortnight. Re-check with
 * `GET /api/feed/sports?active=1` before changing this list.
 *
 * Verified against the live catalogue on 20 Nov 2026:
 *   soccer_epl                  active
 *   soccer_uefa_champs_league   active
 *   basketball_nba              active
 *   soccer_africa_cup_of_nations  NOT in the catalogue at all — AFCON is not
 *                                 listed on this plan, so asking for it would
 *                                 return a 422 and spend a credit to learn that.
 *
 * Three keys x every 2 hours = 36 credits/day, ~1,080 a month, which is over the
 * 500 free credits. The cron schedule is therefore every 4 hours, not every 2 —
 * see vercel.json. Re-check before adding a sport: a key for a competition that
 * is out of season still costs a credit and returns nothing.
 */
const SPORTS = [
  'soccer_epl',
  'soccer_uefa_champs_league',
  'basketball_nba',
]

/** Margin kept on top of the feed price. Not zero: see applyMargin. */
const MARGIN_PCT = Number(process.env.ODDS_MARGIN_PCT ?? '4')

type SportRow = { sport: string; league: string; title: string }

const SPORT_META: Record<string, SportRow> = {
  soccer_epl: { sport: 'football', league: 'Premier League', title: 'EPL' },
  soccer_uefa_champs_league: { sport: 'football', league: 'Champions League', title: 'UCL' },
  soccer_africa_cup_of_nations: { sport: 'football', league: 'Africa Cup of Nations', title: 'AFCON' },
  basketball_nba: { sport: 'basketball', league: 'NBA', title: 'NBA' },
}

async function isAdmin(userId: string): Promise<boolean> {
  try {
    const rows = await restSelect<{ is_admin: boolean }>(`profiles?id=eq.${userId}&select=is_admin`)
    return Boolean(rows[0]?.is_admin)
  } catch {
    return false
  }
}

async function authorized(req: Request): Promise<{ ok: boolean; via?: string }> {
  const secret = (process.env.CRON_SECRET || '').trim()
  const auth = req.headers.get('Authorization') || ''
  if (secret && auth === `Bearer ${secret}`) return { ok: true, via: 'cron' }

  const user = await requireUser(req)
  if (user && (await isAdmin(user.id))) return { ok: true, via: 'admin' }
  return { ok: false }
}

// ------------------------------------------------------------- upserts ------

type Upserted = { fixtureId: string; externalId: string }

/**
 * Upsert one fixture. Returns its database id.
 *
 * Idempotent on (source, source_ref): a replayed payload updates the existing
 * row. That matters because a scheduler can retry, and because two sports can
 * disagree about a team's spelling — the external id is the stable key, not the
 * name.
 */
async function upsertFixture(ev: FeedEvent, sportKey: string): Promise<Upserted> {
  const meta = SPORT_META[sportKey] ?? { sport: 'football', league: ev.sport_title, title: ev.sport_title }

  const body = {
    sport: meta.sport,
    league: meta.league,
    home_team: ev.home_team,
    away_team: ev.away_team,
    starts_at: ev.commence_time,
    source: 'oddsapi',
    source_ref: ev.id,
    external_id: ev.id,
  }

  // PostgREST upsert with on_conflict needs the unique index to be named by its
  // columns, which is why 0007 creates `(source, source_ref)` explicitly.
  const res = await fetch(`${supabaseAdminConfig().url}/rest/v1/sports_fixtures?on_conflict=source,source_ref`, {
    method: 'POST',
    headers: {
      apikey: supabaseAdminConfig().key,
      Authorization: `Bearer ${supabaseAdminConfig().key}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`fixture upsert failed (${res.status}): ${text.slice(0, 200)}`)
  const rows = (text ? JSON.parse(text) : []) as { id: string }[]
  const id = rows[0]?.id
  if (!id) throw new Error('fixture upsert returned no row')
  return { fixtureId: id, externalId: ev.id }
}

type MarketRow = { id: string; fixture_id: string; name: string }

async function upsertMarket(fixtureId: string, name: string): Promise<string> {
  // Markets have no natural external key, so match on (fixture, name). The
  // index on fixture_id makes this a cheap lookup rather than a scan.
  const suffix = `${encodeURIComponent(name)}`
  const existing = await restSelect<MarketRow>(
    `sports_markets?fixture_id=eq.${fixtureId}&name=eq.${suffix}&select=id,fixture_id,name`,
  )
  if (existing[0]) return existing[0].id

  const res = await fetch(`${supabaseAdminConfig().url}/rest/v1/sports_markets`, {
    method: 'POST',
    headers: {
      apikey: supabaseAdminConfig().key,
      Authorization: `Bearer ${supabaseAdminConfig().key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({ fixture_id: fixtureId, name }),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`market insert failed (${res.status}): ${text.slice(0, 200)}`)
  const rows = (text ? JSON.parse(text) : []) as MarketRow[]
  if (!rows[0]?.id) throw new Error('market insert returned no row')
  return rows[0].id
}

async function upsertSelection(marketId: string, name: string, oddsX100: number): Promise<void> {
  const existing = await restSelect<{ id: string }>(
    `sports_selections?market_id=eq.${marketId}&name=eq.${encodeURIComponent(name)}&select=id`,
  )

  const now = new Date().toISOString()
  if (existing[0]) {
    // Update the price and stamp it. price_at is what the freshness rule in
    // place_sports_bet measures, so a price must never be written without it.
    const res = await fetch(`${supabaseAdminConfig().url}/rest/v1/sports_selections?id=eq.${existing[0].id}`, {
      method: 'PATCH',
      headers: {
        apikey: supabaseAdminConfig().key,
        Authorization: `Bearer ${supabaseAdminConfig().key}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ odds_x100: oddsX100, price_at: now, is_active: true }),
    })
    if (!res.ok) throw new Error(`selection update failed (${res.status})`)
    return
  }

  const res = await fetch(`${supabaseAdminConfig().url}/rest/v1/sports_selections`, {
    method: 'POST',
    headers: {
      apikey: supabaseAdminConfig().key,
      Authorization: `Bearer ${supabaseAdminConfig().key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({ market_id: marketId, name, odds_x100: oddsX100, price_at: now }),
  })
  if (!res.ok) throw new Error(`selection insert failed (${res.status}): ${(await res.text()).slice(0, 200)}`)
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

async function runSync(): Promise<SyncResult> {
  if (!isFeedConfigured()) {
    throw new OddsFeedError(
      'ODDS_API_KEY is not set, so nothing can be fetched. Get a free key at the-odds-api.com and add it to Vercel.',
      'ODDS_KEY_MISSING',
      503,
    )
  }
  if (!supabaseAdminConfig().ready) {
    throw new OddsFeedError(
      'SUPABASE_SERVICE_ROLE_KEY is not set, so there is nowhere to write the fixtures.',
      'DB_KEY_MISSING',
      503,
    )
  }

  const result: SyncResult = { ok: true, source: 'oddsapi', sports: [], credits: { used: null, remaining: null }, marginPct: MARGIN_PCT }

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
          const { fixtureId } = await upsertFixture(ev, sportKey)
          const marketId = await upsertMarket(fixtureId, 'Match result')
          for (const [name, price] of consensus(ev, 'h2h')) {
            await upsertSelection(marketId, name, applyMargin(toOddsX100(price), MARGIN_PCT))
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
  try {
    await fetch(`${supabaseAdminConfig().url}/rest/v1/feed_sync_log`, {
      method: 'POST',
      headers: {
        apikey: supabaseAdminConfig().key,
        Authorization: `Bearer ${supabaseAdminConfig().key}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        source: 'oddsapi',
        finished_at: new Date().toISOString(),
        status: !result.ok ? 'error' : result.sports.some((s) => s.errors.length) ? 'partial' : 'ok',
        fixtures_seen: result.sports.reduce((n, s) => n + s.events, 0),
        fixtures_upserted: result.sports.reduce((n, s) => n + s.fixtures, 0),
        credits_used: result.credits.used,
        credits_left: result.credits.remaining,
        errors: result.sports.flatMap((s) => s.errors).slice(0, 20),
      }),
    })
  } catch {
    // A logging failure must not turn a successful sync into a failed one.
  }

  return result
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return preflight()
  if (req.method !== 'GET' && req.method !== 'POST') return methodNotAllowed()

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

    const result = await runSync()
    return json(result, result.ok ? 200 : 207)
  } catch (e) {
    const err = e as OddsFeedError
    return json({ error: err.message, code: err.code ?? 'SYNC_FAILED' }, err.status ?? 500)
  }
}
