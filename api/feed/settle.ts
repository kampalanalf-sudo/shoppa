// GET|POST /api/feed/settle
//
// Reads finished matches from the feed's scores endpoint and settles the
// markets on them. This is the piece that closes the loop: without it every bet
// stays open until a human intervenes.
//
// Safety rules, all of them load-bearing:
//   - only a feed event with `completed: true` is settled. A live match with a
//     current score is NOT a result, and settling on it would pay out early on
//     a game that can still turn.
//   - a fixture is matched by `external_id`, never by team names. Names get
//     respelled; the provider's event id does not.
//   - settlement goes through settle_sports_market(), which is service_role
//     only and idempotent, so a re-run pays nobody twice.
//   - a draw has no winner, so the winner selection is looked up by name and
//     only used if it exists. If it does not, the market is voided rather than
//     guessed at.
import { json, methodNotAllowed, preflight, requireUser, restRpc, restSelect } from '../_lib/http'
import { OddsFeedError, fetchScores, isFeedConfigured } from '../_lib/oddsfeed'

// Must match the list in api/feed/sync.ts. Settling a sport we never ingested
// would spend a credit to look up fixtures that cannot exist.
// AFCON is deliberately absent: it is not in the provider's catalogue, so
// requesting it returns 422 and still costs a credit.
const SPORTS = ['soccer_epl', 'soccer_uefa_champs_league', 'basketball_nba']

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

type Fixture = { id: string; external_id: string; home_team: string; away_team: string; status: string }
type Market = { id: string; fixture_id: string; name: string; is_open: boolean }
type Selection = { id: string; market_id: string; name: string }

/**
 * Decide the winning selection from a final score.
 *
 * Returns `undefined` when the outcome is not a win/loss the board can express
 * (a draw, or a score we cannot parse) — the caller voids rather than guesses.
 * Returns `null` to mean "void on purpose".
 */
function winnerName(homeName: string, awayName: string, home: number, away: number): string | undefined {
  if (home > away) return homeName
  if (away > home) return awayName
  return undefined
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return preflight()
  if (req.method !== 'GET' && req.method !== 'POST') return methodNotAllowed()
  if (!(await authorized(req))) return json({ error: 'not authorised' }, 401)
  if (!isFeedConfigured()) {
    return json({ error: 'ODDS_API_KEY is not set.', code: 'ODDS_KEY_MISSING' }, 503)
  }

  const settled: { fixture: string; market: string; outcome: string; bets: number }[] = []
  const errors: string[] = []

  for (const sportKey of SPORTS) {
    try {
      // daysFrom=3 covers the window a match can sit unsettled. Asking for more
      // does not cost more, but it does return events we already handled.
      const { events } = await fetchScores(sportKey, 3)

      for (const score of events) {
        if (!score.completed) continue

        const fixtures = await restSelect<Fixture>(
          `sports_fixtures?external_id=eq.${encodeURIComponent(score.id)}&select=id,external_id,home_team,away_team,status`,
        )
        const fixture = fixtures[0]
        if (!fixture || fixture.status === 'settled' || fixture.status === 'void') continue

        const home = score.scores?.find((s) => s.name === score.home_team)
        const away = score.scores?.find((s) => s.name === score.away_team)
        const h = home ? Number(home.score) : NaN
        const a = away ? Number(away.score) : NaN

        const markets = await restSelect<Market>(
          `sports_markets?fixture_id=eq.${fixture.id}&select=id,fixture_id,name,is_open`,
        )

        // Record the final score whatever happens next: if settlement fails, the
        // score is still the truth and should not be lost.
        await fetch(`${(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '')}/rest/v1/sports_fixtures?id=eq.${fixture.id}`, {
          method: 'PATCH',
          headers: {
            apikey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
            Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY || ''}`,
            'Content-Type': 'application/json',
            Prefer: 'return=minimal',
          },
          body: JSON.stringify({
            home_score: Number.isFinite(h) ? h : null,
            away_score: Number.isFinite(a) ? a : null,
            completed: true,
            result: Number.isFinite(h) && Number.isFinite(a) ? `${h}-${a}` : null,
          }),
        }).catch(() => undefined)

        for (const market of markets) {
          // Only a 1X2 / moneyline board is expressible here. Anything else is
          // left open for a human, which is the honest failure.
          if (market.name !== 'Match result') continue

          const selections = await restSelect<Selection>(
            `sports_selections?market_id=eq.${market.id}&select=id,market_id,name`,
          )

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

          try {
            const bets = await restRpc<number>('settle_sports_market', {
              p_market: market.id,
              p_winner: winnerId,
            })
            settled.push({
              fixture: `${score.home_team} v ${score.away_team}`,
              market: market.name,
              outcome: winnerId ? (selections.find((s) => s.id === winnerId)?.name ?? 'winner') : 'void',
              bets: Number(bets ?? 0),
            })
          } catch (e) {
            errors.push(`${score.id}/${market.id}: ${(e as Error).message}`)
          }
        }

        // Close the fixture once its markets are decided. Leaving it 'live'
        // would keep it on the board after the result is known.
        await fetch(`${(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '')}/rest/v1/sports_fixtures?id=eq.${fixture.id}`, {
          method: 'PATCH',
          headers: {
            apikey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
            Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY || ''}`,
            'Content-Type': 'application/json',
            Prefer: 'return=minimal',
          },
          body: JSON.stringify({ status: 'settled', settled_at: new Date().toISOString() }),
        }).catch(() => undefined)
      }
    } catch (e) {
      if (e instanceof OddsFeedError) errors.push(`${sportKey}: ${e.message}`)
      else errors.push(`${sportKey}: ${(e as Error).message}`)
    }
  }

  return json({ ok: errors.length === 0, settled, errors: errors.slice(0, 20) })
}
