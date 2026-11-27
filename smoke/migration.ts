import { readFileSync, readdirSync } from 'node:fs'

const sql = readFileSync('supabase/migrations/0003_store_topups.sql', 'utf8')
// 0014 and 0015 were deleted: they were written for a schema that does not
// exist and would have dropped live KYC gates. 0016 is the applied truth, so it
// is read twice under both names to keep the assertions below meaningful.
const sql14 = readFileSync('supabase/migrations/0016_production_money_paths.sql', 'utf8')

const fails: string[] = []
const ok = (n: string, c: boolean) => { if (!c) fails.push(n); console.log(`${c ? 'ok  ' : 'FAIL'} ${n}`) }
/*
 * THE PEG INVARIANT.
 *
 * 0014 removed PX. The bug it fixes was silent and expensive: 0002, 0003 and
 * 0004 all still multiplied a UGX top-up by 10 after 0009 moved the displayed
 * peg to 100, so every top-up credited a tenth of what was paid, and
 * request_cashout paid out a hundredth of what was requested.
 *
 * The rule now: the amount paid IS the amount credited. There is no multiplier
 * anywhere in a money path -- including in the older migrations, which must not
 * be edited but must be overridden, so the override is what these assert on.
 */
const MONEY_MULTIPLIER = /amount[^;\n]*\*\s*10\b|\/\s*10\.0|\/\s*100\.0|\*\s*PX_PER_UGX/
// Extract each function by name, from its `create or replace` to the closing
// `$$;`. Slicing by position between two other function names was fragile: it
// silently produced an empty string when a neighbour did not exist, and an empty
// body passes a "no multiplier" test.
const fnBody = (name: string) => {
  const at = sql14.indexOf(`function ${name}(`)
  if (at < 0) return ''
  const end = sql14.indexOf('$$;', at)
  return end < 0 ? '' : sql14.slice(at, end)
}

for (const label of [
  'apply_store_topup', 'admin_release_store_topup', 'apply_gateway_result',
  'request_cashout', 'claim_daily_px',
] as const) {
  const body = fnBody(label)
  // An empty body would pass every assertion below, so say so instead.
  ok(`${label}: the function exists in the migration`, body.length > 200, `${body.length} chars`)
  // Comments explain the removed peg, so strip them before scanning the code.
  const code = body.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
  ok(`${label}: no 10x / divide-by-100 peg left in the code`, !MONEY_MULTIPLIER.test(code))
}

ok('a top-up credits its own amount', /v_px := v_order\.amount;/.test(fnBody('apply_gateway_result')))
ok('a cashout pays out its own amount', /v_ugx := p_amount_px;/.test(fnBody('request_cashout')))
ok('the store credit is the price times quantity only',
  /v_px := p_amount \* greatest\(coalesce\(p_quantity, 1\), 1\);/.test(fnBody('apply_store_topup')))
// The 7-day rule and the phone/age gates are independent of the currency and
// must survive: they are what stops a fresh script from cashing out.
ok('old-account gate survives (7 days)', /v_age_days < 7/.test(sql14))
ok('the daily bonus is granted to authenticated', /grant execute on function claim_daily_px\(bigint\) to authenticated/.test(sql14))
ok('the wallet column is documented as UGX', /comment on column wallets\.balance_px/.test(sql14))

// The claim path is the only RPC a player can call, and it must never let the
// caller name a wallet: that would let anyone credit any account.
const claimFn = sql.slice(sql.indexOf('function claim_store_topup'), sql.indexOf('function release_store_topup'))
ok('claim takes only a reference (no user id parameter)', /claim_store_topup\(p_reference text\)/.test(claimFn))
ok('claim derives the user from auth.uid()', /v_uid\s+uuid := auth\.uid\(\)/.test(claimFn))
ok('claim refuses an anonymous caller', /if v_uid is null then raise exception/i.test(claimFn))
ok('claim credits only the caller wallet', !/p_user_id/.test(claimFn))
// Check the grant statements one line at a time: a multi-line regex would run
// past one grant and match the next function's "to authenticated".
const grants = sql.split('\n').filter((l) => l.trim().startsWith('grant execute on function'))
const grantFor = (fn: string) => grants.filter((l) => l.includes(fn))
ok('apply (webhook) is granted to service_role only',
  grantFor('apply_store_topup').length === 1 && grantFor('apply_store_topup')[0].includes('to service_role'))
ok('release (admin) is granted to service_role only',
  grantFor('release_store_topup').length === 1 && grantFor('release_store_topup')[0].includes('to service_role'))
ok('claim is granted to authenticated only',
  grantFor('claim_store_topup').length === 1 && grantFor('claim_store_topup')[0].includes('to authenticated'))
ok('no player-facing grant reaches a credit path other than claim',
  grants.filter((l) => l.includes('to authenticated')).every((l) => l.includes('claim_store_topup')))

// Idempotency + the "never credit a failed/pending payment" invariant.
const applyFn = sql.slice(sql.indexOf('function apply_store_topup'), sql.indexOf('function claim_store_topup'))
ok('repeated reference is a replay, not a second credit', /status in \('completed', 'failed'\) then[\s\S]{0,120}replay/i.test(applyFn))
ok('a parked completed payment is stored as pending', /when p_status = 'completed' and v_uid is null then 'pending'/.test(applyFn))
ok('credit requires exactly one matching account', /v_matches = 1/.test(applyFn))
ok('ambiguous email is parked, never guessed', /email_ambiguous/.test(applyFn))
// 0003 is history and still contains the old peg; 0014 overrides it. What must
// hold is that the override (checked above) has none, and that 0003 is not the
// migration that wins.
ok('the live store credit comes from 0014, not 0003', /create or replace function apply_store_topup/.test(sql14))
ok('quantity multiplies the credit', /greatest\(coalesce\(p_quantity, 1\), 1\)/.test(applyFn))

// RLS: players read only their own rows.
ok('store_topups has RLS enabled', /alter table store_topups enable row level security/.test(sql))
ok('players can read only their own top-ups', /user_id = auth\.uid\(\)/.test(sql))

// ---------------------------------------------------------------- 0004 ------
const sql4 = readFileSync('supabase/migrations/0004_store_topup_admin.sql', 'utf8')

const grants4 = sql4.split('\n').filter((l) => l.trim().startsWith('grant execute on function'))
const g4 = (fn: string) => grants4.filter((l) => l.includes(fn))

ok('0004: release is service_role only',
  g4('admin_release_store_topup').length === 1 && g4('admin_release_store_topup')[0].includes('to service_role'))
ok('0004: dismiss is service_role only',
  g4('dismiss_store_topup').length === 1 && g4('dismiss_store_topup')[0].includes('to service_role'))
ok('0004: no admin RPC is granted to authenticated players',
  !grants4.some((l) => l.includes('to authenticated')))
ok('0004: the unattributed 0003 release is revoked',
  /revoke all on function release_store_topup\(text, uuid\) from service_role;/.test(sql4))

const rel = sql4.slice(sql4.indexOf('function admin_release_store_topup'), sql4.indexOf('function dismiss_store_topup'))
ok('0004: release requires an admin id', /if p_admin_id is null then raise exception/.test(rel))
ok('0004: release refuses an already-credited row', /already been credited/.test(rel))
ok('0004: release refuses a row the gateway has not settled', /settled_at is null/.test(rel))
ok('0004: release refuses a failed row', /failed payments cannot be released/.test(rel))
ok('0004: release records the approver on the row', /released_by = p_admin_id/.test(rel))
ok('0004: release writes an attributed ledger entry', /'channel', 'admin_release'/.test(rel) && /'admin_id', p_admin_id/.test(rel))
ok('0004: release writes to the audit table', /insert into store_topup_actions/.test(rel))
ok('0004: release is overridden by 0014', /create or replace function admin_release_store_topup/.test(sql14))

const dis = sql4.slice(sql4.indexOf('function dismiss_store_topup'))
ok('0004: dismiss cannot touch a credited row', /already been credited/.test(dis))
ok('0004: dismiss never credits a wallet', !/update wallets/.test(dis))
ok('0004: dismiss is attributed', /dismissed_by = p_admin_id/.test(dis))

ok('0004: the audit table is locked down (RLS on, no policies)', /alter table store_topup_actions enable row level security/.test(sql4) && !/create policy[^;]*store_topup_actions/.test(sql4))

// ---------------------------------------------------------------- 0005 ------
// Regression guard for the privilege hole measured on the live database:
// `revoke ... from public` does NOT remove Supabase's explicit grants to anon
// and authenticated, so every function needs an explicit revoke from both.
const sql5 = readFileSync('supabase/migrations/0005_function_privileges.sql', 'utf8')

ok('0005: revokes from anon and authenticated, not just public',
  /revoke all on function %s from anon/.test(sql5) &&
  /revoke all on function %s from authenticated/.test(sql5))
ok('0005: sweeps every function in the public schema', /from pg_proc p[\s\S]{0,200}nspname = 'public'/.test(sql5))
ok('0005: re-grants place_bet to authenticated', /grant execute on function place_bet\(text, bigint\) to authenticated;/.test(sql5))
ok('0005: re-grants claim_store_topup to authenticated', /grant execute on function claim_store_topup\(text\) to authenticated;/.test(sql5))
ok('0005: grants the admin release to service_role only',
  /grant execute on function admin_release_store_topup\(text, uuid, uuid\) to service_role;/.test(sql5))
ok('0005: grants settle_cashout to service_role only',
  /grant execute on function settle_cashout\(uuid, cashout_status, text\) to service_role;/.test(sql5))
ok('0005: future functions fail closed for anon',
  /alter default privileges in schema public revoke execute on functions from anon;/.test(sql5))
ok('0005: future functions fail closed for authenticated',
  /alter default privileges in schema public revoke execute on functions from authenticated;/.test(sql5))
ok('0005: never grants a credit path to authenticated',
  !/grant execute on function (apply_store_topup|admin_release_store_topup|dismiss_store_topup|settle_cashout|record_collect|record_disburse|apply_gateway_result)[\s\S]{0,40}to authenticated/.test(sql5))
ok('0005: the retired release is dead for every role',
  /revoke all on function release_store_topup\(text, uuid\) from public, anon, authenticated, service_role;/.test(sql5))

// --------------------------------------------------- 0015: the bonus is honest --
// 0014 shipped the daily grant as 15,000 shillings -- one hundred times the
// UGX 150 the interface promised, because 15,000 PX used to be worth UGX 150 at
// the peg and the number of units was kept after the coin was removed. The
// number printed to the player and the number the database pays must be the
// same number, so this pins both to the client's own constant.
const sql15 = readFileSync('supabase/migrations/0016_production_money_paths.sql', 'utf8')
const clientCurrency = readFileSync('src/lib/currency.ts', 'utf8')
const bonusMatch = clientCurrency.match(/DAILY_BONUS_UGX\s*=\s*([0-9_]+)/)
const bonus = bonusMatch ? Number(bonusMatch[1].replace(/_/g, '')) : NaN

ok('0015: the client declares a daily bonus in shillings', Number.isFinite(bonus) && bonus > 0)
ok("0015: the database grants exactly the client bonus",
  !!bonusMatch && new RegExp(`p_amount bigint default ${bonus}\\b`).test(sql15) &&
  new RegExp(`coalesce\\(p_amount, ${bonus}\\)`).test(sql15))
ok('0015: the database refuses any other amount',
  new RegExp(`if v_amount <> ${bonus} then raise exception`).test(sql15))
ok('0015: keeps the exact 0009 signature so it replaces, not overloads',
  /create or replace function claim_daily_px\(p_amount bigint default \d+\)/.test(sql15))
ok('0015: records the bonus on the ledger like any other money',
  /insert into ledger \(user_id, kind, delta_px, balance_after, ref, meta\)/.test(sql15))
ok('0015: never debits anyone to claw back an overpayment',
  !/balance_px\s*-\s*/.test(sql15))
// claim_daily_px returns the resulting BALANCE, not the amount awarded.
ok('the client does not present the returned balance as the award',
  !/setDailyPxAwarded\(data\)/.test(readFileSync('src/lib/auth.tsx', 'utf8')))
ok('the client treats a repeat claim as normal, because the function throws',
  /if \(error \|\| typeof data !== 'number'\)/.test(readFileSync('src/lib/auth.tsx', 'utf8')))

// --------------------------------------------------- 0016: the live patches --
// 0014 was written against a schema that does not exist and would have broken
// the database: it dropped two KYC gates that exist only in the live body, used
// a ledger kind that is not a member of the enum, and wrote a column that is not
// there. 0016 is the live body with only the arithmetic changed, and these
// assertions are what stop a future edit from reintroducing 0014's mistakes.
const sql16 = readFileSync('supabase/migrations/0016_production_money_paths.sql', 'utf8')
ok('0016 keeps the 18-or-older gate', /if not v_profile\.age_confirmed then/.test(sql16))
ok('0016 keeps the phone-verified gate', /if not v_profile\.phone_verified then/.test(sql16))
ok('0016 keeps the 7-day account-age gate',
  /v_age_days < 7 then/.test(sql16) && /86400/.test(sql16))
ok('0016 uses the cashout_hold ledger kind that exists',
  /'cashout_hold'/.test(sql16) && !/'cashout', *-/.test(sql16))
ok('0016 does not write a cashouts.currency column that does not exist',
  !/insert into cashouts \([^)]*currency/.test(sql16))
ok('0016 keeps the already-claimed raise the client expects',
  /already claimed today/.test(sql16))
// Only the function bodies matter. The file's comments quote the old
// arithmetic to explain it, and the one-time conversion block below deliberately
// divides stored PX by 100 -- that is the migration, not a money path.
// Strip SQL line comments first: the file quotes the old arithmetic to explain
// what it replaced, and a comment is not a money path.
const sql16Functions = sql16.slice(0, sql16.indexOf('-- 2. Convert every stored PX'))
  .split('\n').map((l) => l.replace(/--.*$/, '')).join('\n')
ok('0016 has no money multiplication by ten left in any function',
  !/\* *10\b/.test(sql16Functions))
ok('0016 has no money division by a hundred left in any function',
  !/\/ *100\.0\b/.test(sql16Functions))
ok('the conversion block runs at most once',
  /if exists \(select 1 from ledger where ref = 'ugx-migration-0016'\) then/.test(sql16))

// A bet default of 1000 was ten times the minimum and pre-dated the re-scale.
const gameFiles = readdirSync('src/games').filter((f) => f.endsWith('.tsx'))
const staleBet = gameFiles.filter((f) =>
  /const \[bet, setBet\] = useState\(\d/.test(readFileSync(`src/games/${f}`, 'utf8')))
ok('every game opens on the minimum bet, not a hardcoded number',
  staleBet.length === 0, staleBet.join(', '))

if (fails.length) { console.log(`\n${fails.length} FAILED: ${fails.join(', ')}`); process.exit(1) }
console.log('\nall migration invariants hold')
