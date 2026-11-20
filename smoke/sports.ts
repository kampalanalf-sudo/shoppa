// smoke/sports.ts
//
// The sportsbook's non-negotiables.
//
// A sportsbook is the one place in this app where a client that can set its own
// number can ruin the house: odds are the payout multiplier. These checks pin
// the two invariants that make that impossible, plus the money arithmetic that
// everything else depends on.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fmtOdds, potentialPayout, startsIn, stakeUgx, SPORT_LABEL } from '../src/lib/sportsbook'

const fails: string[] = []
const ok = (n: string, c: boolean, e = '') => { if (!c) fails.push(n); console.log(`${c ? 'ok  ' : 'FAIL'} ${n} ${e}`) }

const root = resolve(process.cwd())
const read = (p: string) => readFileSync(resolve(root, p), 'utf8')

const lib = read('src/lib/sportsbook.ts')
const page = read('src/pages/Sportsbook.tsx')
const sql = read('supabase/migrations/0006_sportsbook.sql')
const chrome = read('src/components/Chrome.tsx')
const app = read('src/App.tsx')
const authSrc = read('src/lib/auth.tsx')

// ------------------------------------------------------------- the odds ====
ok('odds are stored as integers x100, never a float',
  sql.includes('odds_x100   integer not null') && sql.includes('odds_x100 >= 101'))
ok('odds format only at the edge', fmtOdds(250) === '2.50' && fmtOdds(101) === '1.01')
ok('a payout is floored to whole PX', potentialPayout(1000, 250) === 2500)
ok('a payout never produces a fraction of a PX',
  potentialPayout(999, 333) === Math.floor((999 * 333) / 100))
ok('stake converts to UGX at the 100:1 peg', stakeUgx(100000) === 1000)

// --------------------------------------------------- the client cannot cheat ====
// The whole design rests on these two. If either regresses, a player can name
// their own price or settle their own slip.
ok('the player-facing function takes a selection and a stake, never a price',
  /create or replace function place_sports_bet\(p_selection uuid, p_stake_px bigint\)/.test(sql))
ok('the price is read from the market row, not from the caller',
  sql.includes('select * into v_sel from sports_selections where id = p_selection'))
ok('settlement is service_role only',
  /grant execute on function settle_sports_bet\(uuid, sports_bet_status, text\) to service_role;/.test(sql))
// Settlement grants must name service_role and nothing wider. Checking for a
// grant to anon/authenticated is the precise claim; the earlier version of this
// check matched the service_role grant itself.
ok('no settlement function is granted to a client role',
  !/grant execute on function settle_sports\w*\([^)]*\) to (anon|authenticated|public)/.test(sql))
ok('settlement is granted to exactly one role',
  (sql.match(/grant execute on function settle_sports/g) ?? []).length === 2 &&
  !sql.includes('grant execute on function settle_sports_market(uuid, uuid) to authenticated'))
ok('the migration revokes before it grants, so a re-run cannot open a hole',
  sql.includes('revoke all on function place_sports_bet(uuid, bigint) from public, anon, authenticated, service_role'))
ok('a player cannot insert a slip directly',
  sql.includes('create policy sports_bets_read_own') && !/sports_bets for insert/.test(sql))
ok('only the owning player can read their slips',
  sql.includes('auth.uid() = user_id'))
ok('bets close at kick-off', sql.includes('betting has closed for this event'))
ok('a closed market rejects bets', sql.includes('market is closed'))
ok('settling twice cannot pay twice', sql.includes('already settled: no-op, never pay twice'))
ok('a void returns the stake', sql.includes('when p_status = \'void\' then v_bet.stake_px'))
ok('the stake debit and the ledger row are in one function',
  sql.includes("insert into ledger (user_id, kind, delta_px, balance_after, ref, meta)") &&
  sql.includes("jsonb_build_object(\n            'bet_id', v_bet_id"))

// ---------------------------------------------------------------- the app ====
// The RPC payload is the claim. `placeBet` may not contain any odds field.
const rpcBody = lib.slice(lib.indexOf('export async function placeBet'), lib.indexOf('export async function placeBet') + 600)
ok('the client only ever sends a selection id and a stake',
  rpcBody.includes('p_selection: selectionId') && rpcBody.includes('p_stake_px: stakePx') &&
  !rpcBody.includes('odds'))
ok('the bet sheet blocks a stake above the balance', page.includes('stakeNum > balance'))
ok('the UI says plainly that it will not let you overdraw',
  page.includes('more than your balance'))
ok('the page never calls a settle function',
  !page.includes('settle_sports') && !lib.includes('settle_sports'))
ok('stakes are whole PX in the UI', page.includes("replace(/[^0-9]/g, '')"))
ok('the price shown is the price snapshotted on the slip',
  page.includes('fmtOdds(picked.selection.odds_x100)'))

// ---------------------------------------------------------------- routing ====
ok('sports has a route', app.includes("h === 'sports' || h === 'sportsbook'") &&
  app.includes("<Sportsbook onBack={home} />"))
ok('sports is in the desktop nav', chrome.includes("onNavigate('sportsbook')"))
ok('sports is in the mobile bottom bar', /label: 'Sports'/.test(chrome))

// Checking that the nav emits 'sportsbook' is not the same as checking that
// anything listens. It did emit, and every handler fell through to home(), so
// "Sports" was a dead button that bounced the player back to the homepage --
// and every test above still passed. Assert the wiring, not just the label.
ok('the header and bottom bar both handle the sportsbook destination',
  (app.match(/v === 'sportsbook'[\s\S]{0,400}?\? openSportsbook\(\)/g) ?? []).length === 2)
ok('the sports opener sets the view', /openSportsbook = useCallback\(\(\) => \{\s*setView\(\{ name: 'sportsbook' \}\)/.test(app))
ok('the sports opener sets a reloadable hash', app.includes("replaceState(null, '', '#sports')"))
// Without this the nav highlights Home while you are reading the board.
ok('the header is told it is on the sportsbook view',
  app.includes("view.name === 'sportsbook' ? 'sportsbook' : 'home'"))
// Every destination a nav item can emit must have a branch that is not home().
ok('no nav destination silently falls back to home',
  !/v === 'sportsbook'[\s\S]{0,80}?: home\(\)/.test(app))
ok('every sport has a label',
  (['football', 'basketball', 'athletics', 'motorsport', 'cricket', 'rugby', 'tennis'] as const)
    .every((s) => Boolean(SPORT_LABEL[s])))

// ------------------------------------------------- in-house currency ========
// PX is now earned rather than bought: a daily login award, gated conversion.
// These are the rules the whole economy rests on, so they are asserted here.
const px = read('supabase/migrations/0009_px_daily_grant_and_peg.sql')
const pxCode = px.replace(/^\s*--.*$/gm, '')

// The peg is quoted in three places. If any two disagree the UI promises a
// withdrawal the server will refuse.
ok('the database converts at 100 PX per UGX', pxCode.includes('p_amount_px / 100.0'))
ok('the client peg is 100', read('src/lib/proxicash.ts').includes('PX_PER_UGX = 100'))
ok('the API peg is 100', read('api/_lib/dgateway.ts').includes('PX_PER_UGX = 100'))
ok('no surface still advertises the old 10:1 peg',
  !/(^|[^0-9])10 PX = 1 UGX/.test(read('src/components/Chrome.tsx') + read('src/pages/Sportsbook.tsx')))

// The gate: an account must have spent 7 days on the platform.
ok('conversion is refused before the account is 7 days old',
  pxCode.includes("v_age_days < 7") && /7 days old before converting/.test(pxCode))
ok('account age is taken from the profile, not from the client',
  pxCode.includes('v_profile.created_at'))
ok('the age check happens before the balance is touched',
  pxCode.indexOf('v_age_days < 7') < pxCode.indexOf('select balance_px into v_balance'))
ok('the refusal tells the player which day they are on',
  pxCode.includes("you are on day %"))

// The daily award.
ok('the daily award is 15,000 PX', pxCode.includes('p_amount bigint default 15000'))
ok('a caller cannot name their own reward', pxCode.includes("v_amount <> 15000"))
ok('the claim is once per calendar day, enforced by the primary key',
  /primary key \(user_id, claim_date\)/.test(pxCode))
ok('a second claim the same day awards nothing',
  /on conflict \(user_id, claim_date\) do nothing/.test(pxCode) && pxCode.includes('already claimed today'))
ok("the day boundary is Kampala's, not the server's",
  pxCode.includes("at time zone 'Africa/Kampala'"))
ok('the award writes a ledger row', pxCode.includes("'grant', v_amount"))
ok('a suspended account cannot claim', pxCode.includes('account suspended'))
// The client must not decide the amount, and a failed claim is not an error
// banner -- "already claimed" is the normal outcome on 364 days in 365.
ok('the browser never sends the reward amount',
  /rpc\('claim_daily_px'\)/.test(authSrc) && !/claim_daily_px'.*amount/.test(authSrc))
ok('an already-claimed day is silent, not an error',
  /error \|\| typeof data !== 'number'/.test(authSrc))

// ------------------------------------------------------- logout button =======
// signOut() existed in the provider from the start and NOTHING called it, so a
// signed-in player had no way out of their account on a shared phone.
ok('signOut exists on the context', authSrc.includes('signOut: () => Promise<void>'))
ok('the account menu calls signOut', chrome.includes('await signOut()'))
ok('the sign-out control is reachable without guessing', /Sign out/.test(chrome))
ok('sign-out reports failure instead of a dead click', chrome.includes("title: 'Signed out'"))
// The old menu printed "Level 24 - VIP Platinum" for everyone, new account or
// not. It is gone from the rendered markup; the words survive only in a comment
// explaining why.
// Strip comments first: the explanation of the old hard-coded rank lives in a
// JSX comment, and matching that would fail the check it describes.
const withoutComments = (src: string) => src.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
const menuMarkup = withoutComments(
  chrome.slice(chrome.indexOf('Account menu'), chrome.indexOf('Account menu') + 6000),
)
ok('the account menu shows the real handle and address',
  chrome.includes('profile?.username ?? username') && chrome.includes('{email &&'))
ok('no invented rank is rendered in the account menu',
  !/>[^<]*Level 24[^<]*</.test(menuMarkup) && !/>\s*VIP Platinum/.test(menuMarkup))

// ------------------------------------------------------------- countdown ====
const in90m = startsIn(new Date(Date.now() + 90 * 60_000).toISOString())
ok('a countdown reads naturally', /in 1h 2[0-9]m|in 1h 3[0-1]m/.test(in90m), in90m)
ok('a started match reads as started', startsIn(new Date(Date.now() - 60_000).toISOString()) === '')

if (fails.length) { console.log(`\n${fails.length} FAILED: ${fails.join(', ')}`); process.exit(1) }
console.log('\nsportsbook: prices are server-side, settlement is service_role, logout is reachable')
