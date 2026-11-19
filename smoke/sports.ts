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
const auth = read('src/lib/auth.tsx')

// ------------------------------------------------------------- the odds ====
ok('odds are stored as integers x100, never a float',
  sql.includes('odds_x100   integer not null') && sql.includes('odds_x100 >= 101'))
ok('odds format only at the edge', fmtOdds(250) === '2.50' && fmtOdds(101) === '1.01')
ok('a payout is floored to whole PX', potentialPayout(1000, 250) === 2500)
ok('a payout never produces a fraction of a PX',
  potentialPayout(999, 333) === Math.floor((999 * 333) / 100))
ok('stake converts to UGX at the 10:1 peg', stakeUgx(10000) === 1000)

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
ok('every sport has a label',
  (['football', 'basketball', 'athletics', 'motorsport', 'cricket', 'rugby', 'tennis'] as const)
    .every((s) => Boolean(SPORT_LABEL[s])))

// ------------------------------------------------------- logout button =======
// signOut() existed in the provider from the start and NOTHING called it, so a
// signed-in player had no way out of their account on a shared phone.
ok('signOut exists on the context', auth.includes('signOut: () => Promise<void>'))
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
