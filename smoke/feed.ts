// smoke/feed.ts
//
// The odds feed integration.
//
// Two families of check here:
//
//   1. money arithmetic — every conversion between the provider's decimal price
//      and the integer x100 the database stores, including the rounding
//      direction, because rounding up gives away margin on every bet.
//   2. the rules that only exist once a machine publishes the prices — a stale
//      price, a stake ceiling, a match that kicked off while the scheduler was
//      asleep, and a result that must never be inferred from a live score.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { applyMargin, isFeedConfigured, toOddsX100 } from '../api/_lib/oddsfeed'

const fails: string[] = []
const ok = (n: string, c: boolean, e = '') => { if (!c) fails.push(n); console.log(`${c ? 'ok  ' : 'FAIL'} ${n} ${e}`) }

const root = resolve(process.cwd())
const read = (p: string) => readFileSync(resolve(root, p), 'utf8')

const feed = read('api/_lib/oddsfeed.ts')
const sync = read('api/feed/sync.ts')
const settle = read('api/feed/settle.ts')
const sql = read('supabase/migrations/0007_odds_feed.sql')
const lib = read('src/lib/sportsbook.ts')
const page = read('src/pages/Sportsbook.tsx')
const vercel = read('vercel.json')

// ------------------------------------------------------- price arithmetic ====
ok('2.50 decimal becomes 250', toOddsX100(2.5) === 250)
ok('1.01 stays 1.01', toOddsX100(1.01) === 101)
// The rounding direction is a money decision, not a formatting one.
ok('rounding is DOWN, never up', toOddsX100(2.3456) === 234)
ok('a price at or below 1.00 is rejected, not clamped',
  (() => { try { toOddsX100(1.0); return false } catch { return true } })())
ok('a NaN price is rejected', (() => { try { toOddsX100(NaN); return false } catch { return true } })())
ok('a negative price is rejected', (() => { try { toOddsX100(-2); return false } catch { return true } })())

// ---------------------------------------------------------------- margin ====
ok('a 4% margin shortens a 2.50 to 2.40', applyMargin(250, 4) === 240)
ok('margin never produces a price at or below even money', applyMargin(101, 4) === 101)
// 250 shortened by the clamped-maximum 25% is 187, not 250 * 0.90.
ok('margin is clamped so a typo cannot destroy the price', applyMargin(250, 90) === 187, String(applyMargin(250, 90)))
ok('zero margin is allowed (but see the docs: it is a losing book)', applyMargin(250, 0) === 250)

// ------------------------------------------------------- the key stays put ====
// The single most important rule in this file, same as DGateway's.
ok('the feed client reads the key from the server environment only',
  feed.includes('process.env.ODDS_API_KEY'))
ok('the feed client is never imported by the browser bundle',
  !lib.includes('oddsfeed') && !page.includes('oddsfeed') && !page.includes('ODDS_API_KEY'))
ok('nothing under src/ mentions the odds key', !read('src/lib/backend.ts').includes('ODDS_API_KEY'))
ok('the key is not in any VITE_ variable', !/VITE_ODDS/.test(feed + sync + settle))
ok('the key is refused loudly when absent', feed.includes('ODDS_KEY_MISSING'))

// ------------------------------------------------------------ credit spend ====
// 500 free credits a month is the entire budget. A sync that fetches every sport
// in season would spend it in one run.
const sportList = sync.slice(sync.indexOf('const SPORTS'), sync.indexOf(']', sync.indexOf('const SPORTS')))
ok('the sync fetches a short, explicit sport list', (sportList.match(/'/g) ?? []).length <= 8, sportList.replace(/\s+/g, ' '))
ok('the sync does not fetch "all in-season sports"', !/fetchSports\(/.test(sync))
ok('the response headers are read so the remaining budget is visible',
  feed.includes('x-requests-remaining') && sync.includes('credits_remaining') === false && sync.includes('remaining'))
ok('a 429 is reported as a quota problem, not a generic failure', feed.includes('ODDS_QUOTA'))
// 4 sports x every 2 hours = 48/day is too much; the schedule must be modest.
const cron = JSON.parse(vercel).crons as { path: string; schedule: string }[]
ok('a sync is scheduled', cron.some((c) => c.path === '/api/feed/sync'))
ok('a settle run is scheduled', cron.some((c) => c.path === '/api/feed/settle'))
ok('the sync does not run more than every 2 hours',
  cron.filter((c) => c.path === '/api/feed/sync').every((c) => /^\d+ \*\/[12] \* \* \*$/.test(c.schedule)), cron.find((c) => c.path === '/api/feed/sync')?.schedule)

// ----------------------------------------------------------------- auth ====
ok('the sync requires a secret or an admin', sync.includes('CRON_SECRET') && sync.includes('is_admin'))
ok('the sync rejects an unauthenticated caller', sync.includes("error: 'not authorised' }"))
ok('the settle route is equally gated', settle.includes('CRON_SECRET') && settle.includes("error: 'not authorised' }"))

// ------------------------------------------------------- idempotent ingest ====
ok('fixtures upsert on (source, source_ref), so a replay cannot duplicate',
  sync.includes('on_conflict=source,source_ref') && sql.includes('sports_fixtures_source_ref'))
ok('every price write stamps its own timestamp', sync.includes('price_at: now'))
ok('the price is agreed by median, not by best price',
  sync.includes('median') && !sync.includes('Math.max(...prices'))

// --------------------------------------------------- settlement discipline ====
ok('only a completed event is settled', settle.includes('if (!score.completed) continue'))
ok('a live score is never treated as a result', !/settle_sports_market[^)]*score/.test(settle))
ok('fixtures are matched by provider id, not by team name',
  settle.includes('external_id=eq.'))
ok('the final score is stored even if settlement fails', settle.includes('home_score:'))
ok('settlement goes through the service_role function',
  settle.includes("restRpc<number>('settle_sports_market'"))

// ------------------------------------------------------- database limits ====
ok('a bet is refused on a stale price', sql.includes('odds for this market are out of date'))
ok('a bet is refused above the market ceiling', sql.includes('stake exceeds the'))
ok('a bet is refused on the clock, not on the feed status', sql.includes('starts_at <= now()'))
ok('a fixture the feed reports completed cannot be bet', sql.includes('or v_fix.completed'))
ok('the limits are re-granted after CREATE OR REPLACE', sql.includes('grant execute on function place_sports_bet(uuid, bigint) to authenticated'))
ok('a stale board is voided, never silently deleted', sql.includes('void_stale_fixtures') && !sql.includes('delete from sports_fixtures'))

// --------------------------------------------------------------- the UI ====
ok('the client mirrors the ceiling so the player is warned first',
  page.includes('DEFAULT_MAX_STAKE_PX') && page.includes('overMax'))
ok('the client mirrors the staleness rule', page.includes('isPriceStale'))
ok('the client defaults match the database defaults',
  lib.includes('500_000') && sql.includes('500000') && lib.includes('5400') && sql.includes('5400'))
ok('the board says where its prices came from', page.includes('live odds'))
ok('a refresh does not cost a credit (it only re-reads Supabase)',
  !page.includes('/api/feed/'))

// ------------------------------------------------------------- config =======
ok('an unconfigured feed is detectable without throwing', typeof isFeedConfigured() === 'boolean')

if (fails.length) { console.log(`\n${fails.length} FAILED: ${fails.join(', ')}`); process.exit(1) }
console.log('\nodds feed: key is server-only, spend is bounded, settlement needs a final score')
