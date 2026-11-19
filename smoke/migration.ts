import { readFileSync } from 'node:fs'

const sql = readFileSync('supabase/migrations/0003_store_topups.sql', 'utf8')
const fails: string[] = []
const ok = (n: string, c: boolean) => { if (!c) fails.push(n); console.log(`${c ? 'ok  ' : 'FAIL'} ${n}`) }

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
ok('credits at the 10 PX per UGX peg', /amount \* 10 \* greatest/.test(applyFn) || /then p_amount \* 10 \* greatest/.test(applyFn))
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
ok('0004: release credits at the same 10 PX / UGX peg', /amount \* 10 \* v_row.quantity/.test(rel))

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

if (fails.length) { console.log(`\n${fails.length} FAILED: ${fails.join(', ')}`); process.exit(1) }
console.log('\nall migration invariants hold')
