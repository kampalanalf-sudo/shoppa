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

if (fails.length) { console.log(`\n${fails.length} FAILED: ${fails.join(', ')}`); process.exit(1) }
console.log('\nall migration invariants hold')
