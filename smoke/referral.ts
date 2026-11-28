// smoke/referral.ts
//
// The referral rules, checked against the source that enforces them.
//
// The product promise is narrow and easy to break silently:
//
//   * the reward is a share of PROFIT, not of turnover — a referred player who
//     takes their money back out must not earn the referrer anything;
//   * it covers the first FIVE deposits only, counted from the payment rows the
//     server confirmed, never from a number the client sends;
//   * one reward per (referred player, deposit number), so a retried webhook
//     cannot pay twice;
//   * the rate is read from the database on both sides, so the percentage the
//     screen prints is the percentage the money pays;
//   * a code is claimed once, before the first deposit, and not by yourself.
//
// These are SQL and source invariants, so they are read, not executed. The live
// database run that proves the money moves is recorded in the PR.
import { readFileSync } from 'node:fs'

const fails: string[] = []
const ok = (name: string, cond: boolean, extra = '') => {
  if (!cond) fails.push(name)
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`)
}

const read = (p: string) => readFileSync(p, 'utf8')
const sqlOf = (p: string) =>
  read(p).split('\n').map((l) => l.replace(/--.*$/, '')).join('\n')

const sql = sqlOf('supabase/migrations/0024_referrals.sql')
const lib = read('src/lib/referrals.ts')
const page = read('src/pages/Referral.tsx')
const auth = read('src/lib/auth.tsx')
const authPage = read('src/pages/Auth.tsx')
const app = read('src/App.tsx')
const chrome = read('src/components/Chrome.tsx')
const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> }
const ci = read('.github/workflows/deploy-pages.yml')

const fn = (name: string) => {
  const at = sql.indexOf(`function ${name}(`)
  if (at < 0) return ''
  const end = sql.indexOf('$$;', at)
  return end < 0 ? '' : sql.slice(at, end)
}

// -------------------------------------------------------- the five deposits ---

const trigger = fn('referral_on_deposit')
ok('a completed collection is what triggers a reward',
  /new\.status <> 'completed'/.test(trigger) && /new\.direction <> 'collect'/.test(trigger))
ok('a payment inserted ALREADY completed is also covered, not just an update',
  /after insert or update of status on payment_orders/.test(sql))
ok('the deposit NUMBER is counted from payment_orders, not taken from the caller',
  /select count\(\*\) into v_n[\s\S]*from payment_orders/.test(trigger))
ok('the count is total-ordered (created_at, reference) so two deposits in the same second get different numbers',
  /\(o\.created_at, o\.reference\) <= \(new\.created_at, new\.reference\)/.test(trigger))
ok('anything past the fifth is refused by the payer',
  /p_deposit_n > 5/.test(fn('pay_referral_reward')) &&
  /outside the first five deposits/.test(fn('pay_referral_reward')))

// --------------------------------------------------- profit, not the deposit ---

const profit = fn('referral_profit')
ok('profit is deposits minus withdrawals minus what is still in the wallet',
  /sum\(amount\)/.test(profit) && /sum\(amount_px\)/.test(profit) && /balance_px/.test(profit))
ok('profit is floored at zero, so a winning friend never produces a negative reward',
  /greatest\(/.test(profit) && /,\s*0\)/.test(profit))
ok('the reward is the rate applied to profit, not to the deposit',
  /floor\(v_marginal \* v_rate\)/.test(fn('pay_referral_reward')) &&
  !/floor\(v_profit \* v_rate\)/.test(fn('pay_referral_reward')))
ok('the rate applies to profit earned SINCE the last reward, so five deposits pay 2% once',
  /v_marginal := greatest\(v_profit - v_base, 0\)/.test(fn('pay_referral_reward')) &&
  /max\(profit_px\)/.test(fn('pay_referral_reward')))
ok('both the cumulative and the marginal profit are recorded, so a reward can be audited',
  /marginal_px/.test(sql) && /profit_px\s+bigint not null/.test(sql))

// ------------------------------------------------------------- no double pay ---

ok('(referred, deposit number) is unique, so a replayed webhook cannot pay twice',
  /unique \(referred_id, deposit_n\)/.test(sql))
ok('the payer also checks for an existing row before inserting',
  /if exists \(select 1 from referral_rewards where referred_id = p_referred and deposit_n = p_deposit_n\)/.test(sql))

// ------------------------------------------------------------- the rate -------

ok('the rate lives in one table and is capped at 10 percent by a constraint',
  /create table if not exists referral_settings/.test(sql) && /rate <= 0.10/.test(sql))
ok('the payment reads the rate from the database',
  /v_rate := referral_rate_now\(\)/.test(fn('pay_referral_reward')))
ok('the screen reads the same rate, and prints no hard-coded percentage',
  /state\.rate/.test(page) && /referral_rate_now/.test(sql) &&
  !/2% of/.test(page.replace(/state\.rate/g, '')))

// ------------------------------------------------------------- claiming -------

const claim = fn('claim_referral')
ok('a code cannot be claimed by the account that owns it',
  /v_referrer = v_uid/.test(claim))
ok('a code cannot be claimed after the first deposit',
  /has to be added before your first deposit/.test(claim))
ok('a code can only be claimed once',
  /already used a referral code/.test(claim))
ok('a referral row cannot point at itself',
  /no_self_referral/.test(sql))

// ------------------------------------------------------------- money out -------

ok('a reward is written to the ledger so it reconciles like every other movement',
  /insert into ledger \(user_id, kind, delta_px, balance_after, ref, meta\)/.test(sql) &&
  /'referral_bonus'/.test(sql))
ok('the reward is credited under a wallet row lock',
  /for update/.test(fn('pay_referral_reward')))
ok('the reward-paying function is not executable by a client',
  /revoke all on function pay_referral_reward\(uuid, int\) from public, anon, authenticated/.test(sql))

// ------------------------------------------------------------- the app --------

ok('the referral screen exists and is routed', /view\.name === 'referral'/.test(app))
ok('it is reachable from the account menu', /'referral'/.test(chrome) && /Refer a friend/.test(chrome))
ok('a shared link goes to sign-up, not to the referral page',
  /h === 'join'/.test(app) && /setView\(\{ name: 'auth' \}\)/.test(app))
ok('the code is pre-filled from the link before the player types anything',
  /referralCodeFromUrl/.test(authPage))
ok('the code is kept in local storage, not in user metadata the client can rewrite',
  /PENDING_REFERRAL_KEY/.test(auth) && !/referral.*raw_user_meta_data/.test(auth))
ok('the pending code is claimed as soon as a session exists',
  /claimPendingReferral/.test(auth) && /supabase\.rpc\('claim_referral'/.test(auth))
ok('the screen says the reward is a share of profit, in those words',
  /of <b className="text-white">profit/.test(page))
ok('the screen shows the five-deposit limit', /first \{covered\} deposits/.test(page))
ok('the client computes no reward of its own',
  !/rate\s*\*\s*profit/.test(lib) && !/profit_px\s*\*/.test(page))

// ------------------------------------------------------------- the gate -------

ok('the smoke test is wired into package.json',
  /vite\.referral\.config\.ts/.test(pkg.scripts['test:referral'] ?? ''))
ok('and runs in the deploy gate', /test:referral/.test(ci))

if (fails.length) {
  console.error(`\n${fails.length} referral rule(s) broken:\n  ${fails.join('\n  ')}`)
  process.exit(1)
}
console.log('\nthe referral rules hold')
