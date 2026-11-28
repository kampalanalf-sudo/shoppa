// supabase/functions/feed-settle/index.ts
//
// GET|POST — reads finished matches from the feed's scores endpoint and settles
// the markets on them. This is the piece that closes the loop: without it every
// bet stays open until a human intervenes.
//
// Safety rules, all of them load-bearing:
//   - only a feed event with `completed: true` is settled. A live match with a
//     current score is NOT a result, and settling on it would pay out early on a
//     game that can still turn.
//   - a fixture is matched by `external_id`, never by team names. Names get
//     respelled; the provider's event id does not.
//   - settlement goes through settle_sports_market(), which is service_role
//     only and idempotent, so a re-run pays nobody twice.
//   - a draw has no winner, so the winner selection is looked up by name and
//     only used if it exists. If it does not, the market is voided rather than
//     guessed at.
import { CORS, json, readEnv } from '../_shared/http.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.45.4'
import { OddsFeedError, fetchScores, isFeedConfigured } from '../_shared/oddsfeed.ts'

/** Env var, trimmed. Missing becomes '' and never the string "undefined". */
const env = (key: string) => readEnv(key)

// Must match the list in feed-sync. Settling a sport we never ingested would
// spend a credit to look up fixtures that cannot exist.
// AFCON is deliberately absent: it is not in the provider's catalogue, so
// requesting it returns 422 and still costs a credit.
const SPORTS = ['soccer_epl', 'soccer_uefa_champs_league', 'basketball_nba']

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

type Fixture = { id: string; external_id: string; home_team: string; away_team: string; status: string }
type Market = { id: string; fixture_id: string; name: string; is_open: boolean }
type Selection = { id: string; market_id: string; name: string }

/**
 * Decide the winning selection from a final score.
 *
 * Returns `undefined` when the outcome is not a win/loss the board can express
 * (a draw, or a score we cannot parse) — the caller voids rather than guesses.
 */
function winnerName(homeName: string, awayName: string, home: number, away: number): string | undefined {
  if (home > away) return homeName
  if (away > home) return awayName
  return undefined
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight()
  if (req.method !== 'GET' && req.method !== 'POST') return json({ error: 'method not allowed' }, 405)
  if (!(await authorized(req))) return json({ error: 'not authorised' }, 401)
  if (!isFeedConfigured()) {
    return json({ error: 'ODDS_API_KEY is not set.', code: 'ODDS_KEY_MISSING' }, 503)
  }

  const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false },
  })

  const settled: { fixture: string; market: string; outcome: string; bets: number }[] = []
  const errors: string[] = []

  for (const sportKey of SPORTS) {
    try {
      // daysFrom=3 covers the window a match can sit unsettled. Asking for more
      // does not cost more, but it does return events we already handled.
      const { events } = await fetchScores(sportKey, 3)

      for (const score of events) {
        if (!score.completed) continue

        const { data: fixtureRows } = await db
          .from('sports_fixtures')
          .select('id,external_id,home_team,away_team,status')
          .eq('external_id', score.id)

        const fixture = ((fixtureRows ?? []) as Fixture[])[0]
        if (!fixture || fixture.status === 'settled' || fixture.status === 'void') continue

        const home = score.scores?.find((s) => s.name === score.home_team)
        const away = score.scores?.find((s) => s.name === score.away_team)
        const h = home ? Number(home.score) : NaN
        const a = away ? Number(away.score) : NaN

        const { data: marketRows } = await db
          .from('sports_markets')
          .select('id,fixture_id,name,is_open')
          .eq('fixture_id', fixture.id)

        // Record the final score whatever happens next: if settlement fails, the
        // score is still the truth and should not be lost.
        await db.from('sports_fixtures').update({
          home_score: Number.isFinite(h) ? h : null,
          away_score: Number.isFinite(a) ? a : null,
          completed: true,
          result: Number.isFinite(h) && Number.isFinite(a) ? `${h}-${a}` : null,
        }).eq('id', fixture.id)

        for (const market of (marketRows ?? []) as Market[]) {
          // Only a 1X2 / moneyline board is expressible here. Anything else is
          // left open for a human, which is the honest failure.
          if (market.name !== 'Match result') continue

          const { data: selectionRows } = await db
            .from('sports_selections')
            .select('id,market_id,name')
            .eq('market_id', market.id)
          const selections = (selectionRows ?? []) as Selection[]

          let winnerId: string | null = null
          if (Number.isFinite(h) && Number.isFinite(a)) {
            const name = winnerName(score.home_team, score.away_team, h, a)
            if (name) {
              // On a draw, `Draw` is the winning selection if the feed quoted
              // one. If it did not, the market is void.
              winnerId = selections.find((s) => s.name === name)?.id ?? null
            } else {
              winnerId = selections.find((s) => s.name.toLowerCase() === 'draw')?.id ?? null
            }
          }

          const { data: bets, error } = await db.rpc('settle_sports_market', {
            p_market: market.id,
            p_winner: winnerId,
          })
          if (error) {
            errors.push(`${score.id}/${market.id}: ${error.message}`)
          } else {
            settled.push({
              fixture: `${score.home_team} v ${score.away_team}`,
              market: market.name,
              outcome: winnerId ? (selections.find((s) => s.id === winnerId)?.name ?? 'winner') : 'void',
              bets: Number(bets ?? 0),
            })
          }
        }

        // Close the fixture once its markets are decided. Leaving it 'live'
        // would keep it on the board after the result is known.
        await db.from('sports_fixtures')
          .update({ status: 'settled', settled_at: new Date().toISOString() })
          .eq('id', fixture.id)
      }
    } catch (e) {
      if (e instanceof OddsFeedError) errors.push(`${sportKey}: ${e.message}`)
      else errors.push(`${sportKey}: ${(e as Error).message}`)
    }
  }

  return json({ ok: errors.length === 0, settled, errors: errors.slice(0, 20) })
})
