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
// 0008 moved the feed into the database and re-tuned the staleness guard to the
// 4-hourly cadence, so the "client matches the database" check must read both.
const sqlDb = read('supabase/migrations/0008_feed_in_database.sql')
// Comments describe intent; only the executable statements are asserted on.
const sqlDbCode = sqlDb.replace(/^\s*--.*$/gm, '')
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
// Verified against the live catalogue on 20 Nov 2026: AFCON is not listed there
// at all. Requesting it returns 422 and still bills a credit.
ok('the sync does not request AFCON, which is not in the catalogue',
  !/^\s*'soccer_africa_cup_of_nations',?\s*$/m.test(sync))
ok('sync and settle agree on the sport list',
  (settle.match(/'soccer_epl'/g) ?? []).length === 1 && (sync.match(/'soccer_epl'/g) ?? []).length === 1)
ok('the sync does not fetch "all in-season sports"', !/fetchSports\(/.test(sync))
ok('the response headers are read so the remaining budget is visible',
  feed.includes('x-requests-remaining') && sync.includes('credits_remaining') === false && sync.includes('remaining'))
ok('a 429 is reported as a quota problem, not a generic failure', feed.includes('ODDS_QUOTA'))
// 4 sports x every 2 hours = 48/day is too much; the schedule must be modest.
const cron = JSON.parse(vercel).crons as { path: string; schedule: string }[]
ok('a sync is scheduled', cron.some((c) => c.path === '/api/feed/sync'))
ok('a settle run is scheduled', cron.some((c) => c.path === '/api/feed/settle'))
// 3 sports x every 4 hours = 18 credits/day, ~540 a month. That is already at
// the edge of the 500-credit free plan, so a tighter schedule would not fit.
ok('the sync does not run more often than every 4 hours',
  cron.filter((c) => c.path === '/api/feed/sync').every((c) => /^\d+ \*\/[4-9]\d*|^\d+ \*\/[4-9] \* \* \*$/.test(c.schedule)),
  cron.find((c) => c.path === '/api/feed/sync')?.schedule)

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
// The client mirrors the server so the player is warned before the server says
// no. If these drift, the UI promises something the database will refuse.
ok('the stake ceiling matches in client and database',
  lib.includes('500_000') && (sql.includes('500000') || sqlDb.includes('500000')))
// The staleness guard is now tied to the 4-hourly refresh: 15,000s, not 5,400.
// A 90-minute guard against a 4-hourly feed would refuse every bet for 2.5h of
// every 4 — the test used to lock in that bug, so it now asserts the pairing.
ok('the client staleness window matches the database default',
  lib.includes('15_000') && sqlDb.includes('set default 15000'))
ok('a 90-minute guard is gone from the client', !lib.includes('5400'))
ok('the board says where its prices came from', page.includes('live odds'))
ok('a refresh does not cost a credit (it only re-reads Supabase)',
  !page.includes('/api/feed/'))

// ------------------------------------------------ in-database feed (0008) ====
// The feed now runs on pg_cron + pg_net with the key in Vault, so the rules
// below are what keep it safe without a serverless host mediating anything.
ok('the key lives in Vault, not in a build environment',
  sqlDb.includes("vault.decrypted_secrets") && sqlDb.includes("'odds_api_key'"))
ok('the feed functions are revoked from every client role',
  sqlDb.includes('revoke all on function feed_fire_sync()'))
ok('the site may read odds but never write them',
  sqlDb.includes('revoke insert, update, delete, truncate, references, trigger'))
// pg_net names its response columns status_code/content. Reading status/body
// returns NULL rather than raising, which looks identical to an empty payload.
ok('the parser reads pg_net\'s real column names',
  sqlDb.includes('r.status_code') && sqlDb.includes('r.content') &&
  !sqlDb.includes('r.status,') && !sqlDb.includes('r.body'))
// A failure that stamps processed_at consumes the request, so the retry
// silently ingests nothing. That is how the first live run lost a cycle.
ok('a failed request is left pending so it can be retried',
  /exception when others then[\s\S]{0,300}?update feed_requests set error/.test(sqlDbCode) &&
  !/exception when others then[\s\S]{0,300}?processed_at/.test(sqlDbCode))
// Taking each outcome's median independently stacks our margin on the
// bookmakers' own overround: measured 1.103 while the config said 4%.
// `on conflict do nothing` with no constraint to conflict with does nothing at
// all. That is how markets doubled from 114 to 228 selections in two runs, and
// it would have doubled the board every four hours from then on.
ok('a market upserts against a real unique constraint',
  sqlDb.includes('sports_markets_fixture_name') &&
  /create unique index[\s\S]{0,120}sports_markets \(fixture_id, name\)/.test(sqlDbCode))
ok('the bookmakers\' overround is stripped before our margin is applied',
  sqlDb.includes('v_overround') && sqlDb.includes('sum(1.0 / price)'))
ok('markets close at kick-off on a five-minute job',
  sqlDb.includes("cron.schedule('feed_close_started'") && sqlDb.includes('*/5 * * * *'))
ok('the parser ignores events that have already started',
  sqlDb.includes("if (v_ev->>'commence_time')::timestamptz <= now() then continue; end if;"))
ok('the board asks only for fixtures that have not started',
  lib.includes(".gt('starts_at', new Date().toISOString())"))
// 2 sports x 6 runs/day is ~360 of the 500 free credits. NBA would be ~540.
ok('the default sport list fits the free credit tier',
  sqlDb.includes("array['soccer_epl', 'soccer_uefa_champs_league']"))

// ------------------------------------------------------------- config =======
ok('an unconfigured feed is detectable without throwing', typeof isFeedConfigured() === 'boolean')

if (fails.length) { console.log(`\n${fails.length} FAILED: ${fails.join(', ')}`); process.exit(1) }
console.log('\nodds feed: key is server-only, spend is bounded, settlement needs a final score')
