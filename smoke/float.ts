// smoke/float.ts
//
// The rules of the credit product, checked against the source that enforces them.
//
// Everything here is a promise a player can be harmed by:
//
//   * borrowed money cannot leave the platform as cash;
//   * the limit, the instalments and the levy are derived on the server;
//   * a deposit code is single-use and pays the REQUESTER, never the payer;
//   * the sponsor's route works with no account and gives away nothing about the
//     person being paid for;
//   * a deposit is charged to the account's own number, which the top-up page
//     cannot be typed over.
//
// These are SQL and source invariants, so they are read, not executed. The money
// paths themselves are covered by test:board (the same `settle_round_server`
// shape) and by the live database check recorded in the PR.
import { readFileSync } from 'node:fs'

const fails: string[] = []
const ok = (name: string, cond: boolean, extra = '') => {
  if (!cond) fails.push(name)
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`)
}

const read = (p: string) => readFileSync(p, 'utf8')
/** SQL with comments stripped, so prose about a rule is not mistaken for it. */
const sqlOf = (p: string) =>
  read(p).split('\n').map((l) => l.replace(/--.*$/, '')).join('\n')

// ------------------------------------------------------------------ the files --

const floatSql = sqlOf('supabase/migrations/0023_float_credit.sql')
const depositSql = sqlOf('supabase/migrations/0022_deposit_requests.sql')
const giftFn = read('supabase/functions/gift/index.ts')
const depositPage = read('src/pages/Deposit.tsx')
const floatPage = read('src/pages/Float.tsx')
const lib = read('src/lib/deposits.ts')
const app = read('src/App.tsx')
// Comments stripped: the manifest explains in prose which permissions it does
// NOT declare, and a naive match on those words would fail on its own honesty.
const manifest = read('android/app/src/main/AndroidManifest.xml')
  .replace(/<!--[\s\S]*?-->/g, '')
const bridge = read('android/app/src/main/java/com/floatbet/gaming/NativeBridge.java')
const activity = read('android/app/src/main/java/com/floatbet/gaming/MainActivity.java')
const nativeLib = read('src/lib/native.ts')

const fn = (sql: string, name: string) => {
  const at = sql.indexOf(`function ${name}(`)
  if (at < 0) return ''
  const end = sql.indexOf('$$;', at)
  return end < 0 ? '' : sql.slice(at, end)
}

// ------------------------------------------------- the float is credit, not cash --

const cashout = fn(floatSql, 'request_cashout')
ok('request_cashout is redefined here, so the float gate cannot be bypassed',
  cashout.length > 0)
ok('it holds back everything still owed on a float',
  /v_owed/.test(cashout) && /v_spendable\s*:=\s*greatest\(v_balance - v_owed, 0\)/.test(cashout))
ok('and refuses a payout above what the float leaves spendable',
  /p_amount_px > v_spendable/.test(cashout))
ok('the 18+ gate survives the rewrite', /age_confirmed/.test(cashout))
ok('the removed gates stay removed', !/86400|v_age_days|phone_verified/.test(cashout))
ok('the row lock survives, so two tabs cannot overdraw',
  /for update/.test(cashout))

// ---------------------------------------------------------- the server decides --

const offer = fn(floatSql, 'float_offer')
ok('the limit is derived from the deposit history, not sent by the client',
  /from payment_orders/.test(offer) && /v_limit\s*:=\s*(15000|5000|2000)/.test(offer))
ok('one open float blocks a second', /status = 'active'/.test(offer) && /already have a float open/.test(offer))
ok('a written-off float closes borrowing', /written_off/.test(offer))

const borrow = fn(floatSql, 'request_float')
ok('the borrow is refused above the server limit, not clipped to it',
  /p_amount > v_limit/.test(borrow) && /raise exception/.test(borrow))
ok('three instalments, inside 24 hours',
  /1, now\(\) \+ interval '8 hours'/.test(borrow) &&
  /3, v_due/.test(borrow) && /interval '24 hours'/.test(borrow))
ok('the instalments sum exactly to the principal',
  /v_third := p_amount - v_first - v_second/.test(borrow))
ok('the credit is written to the wallet and the ledger together',
  /update wallets set balance_px = v_after/.test(borrow) && /'float_in'/.test(borrow))

const levy = fn(floatSql, 'float_accrued_levy')
ok('the levy is 6% per day', /0\.06::numeric/.test(floatSql))
ok('it starts only after the 24-hour deadline', /if now\(\) <= v_f\.due_at then return 0/.test(levy))
ok('a levy is charged once per day, not per call',
  /v_days <= v_f\.levy_charged_through/.test(levy) && /levy_charged_through/.test(floatSql))

const repay = fn(floatSql, 'repay_float')
ok('a repayment cannot exceed what is owed', /you owe %/.test(repay))
ok('levies are paid before the principal', /v_fee_left/.test(repay))
ok('the float settles when it is covered', /status = 'settled'/.test(repay))
ok('repayment cannot invent balance', /if v_balance < p_amount/.test(repay))

// --------------------------------------------------- who may call what, at all --

// The player may READ what the levy would be (it is their own bill), and may not
// write one. Both halves are asserted, because granting the wrong one of these
// two same-shaped functions would either hide the fee or let a browser post it.
ok('a player can read the levy that applies to them',
  /grant execute on function float_accrued_levy\(uuid\) to authenticated/.test(floatSql))
ok('but cannot post one',
  /revoke all on function charge_float_levy\(uuid\) from public, anon, authenticated/.test(floatSql)
  && /grant execute on function charge_float_levy\(uuid\) to service_role/.test(floatSql))
ok('writing a levy off is server-only',
  /revoke all on function write_off_float\(uuid, text\) from public, anon, authenticated/.test(floatSql))
ok('the levy run is server-only',
  /revoke all on function charge_all_float_levies\(\) from public, anon, authenticated/.test(floatSql))
ok('settling a deposit request is not callable from a browser',
  /revoke all on function mark_deposit_request_paid\(\) from public, anon, authenticated/.test(depositSql))
ok('the sponsor\'s order write is server-only',
  /revoke all on function record_sponsor_collect[\s\S]{0,200}from public, anon, authenticated/.test(depositSql))
ok('the public lookup returns no personal data',
  !/username|display_name|balance_px|payer_phone/.test(fn(depositSql, 'deposit_request_public')))

// ------------------------------------------------------------- deposits, not--

const create = fn(depositSql, 'create_deposit_request')
ok('a code is single-use by construction: only a pending request can be paid',
  /status = 'pending'/.test(depositSql))
ok('a request expires in 24 hours', /interval '24 hours'/.test(depositSql))
ok('one live request per player', /already have a deposit request open/.test(create))
ok('a request cannot be paid for a different amount',
  /p_amount is distinct from v_req\.amount/.test(fn(depositSql, 'record_sponsor_collect')))
ok('the code alphabet has no look-alike characters',
  /alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'/.test(depositSql))

// the payer is not the beneficiary
const sponsor = fn(depositSql, 'record_sponsor_collect')
ok('a sponsor\'s payment credits the REQUESTER',
  /values \(p_order, v_req\.user_id, 'collect'/.test(sponsor))
ok('the request flips to paid off the payment order, not off the client',
  /create trigger payment_orders_settle_deposit_request/.test(depositSql))
ok('a failed payment frees the code so it can be retried',
  /create trigger payment_orders_release_deposit_request/.test(depositSql))

// ------------------------------------------------------ the sponsor's own route --

ok('the gift route is public (no session required)', !/requireUser/.test(giftFn))
ok('it takes the amount from the request, never from the caller',
  /const amount = Number\(info\.amount\)/.test(giftFn) && !/body\.amount/.test(giftFn))
ok('it refuses a code that is not pending before charging anyone',
  /info\.status !== 'pending'/.test(giftFn))
ok('it records the order before answering, or the webhook cannot credit',
  /record_sponsor_collect[\s\S]{0,900}return json\(\{/.test(giftFn))
ok('and says so plainly when that record fails',
  /needsSupport: true/.test(giftFn))
ok('the client speaks to it by name', /functions\/v1.*gift|SUPABASE_FUNCTIONS_URL}\/gift/.test(lib))

// --------------------------------------------------- the deposit page's own number --

ok('the deposit page reads the number from the account', /profile\?\.phone/.test(depositPage))
ok('it renders that number read-only rather than as an editable field',
  /locked/.test(depositPage) && /not editable/.test(depositPage))
ok('there is no free-text phone input in the paying path',
  !/value=\{phone\}/.test(depositPage))
ok('a deposit is charged to the account number, not to a typed one',
  /phone: own,/.test(depositPage))
ok('a missing number is asked for once and saved', /updateProfile\(\{ phone/.test(depositPage))

// ------------------------------------------------------------- navigation ----

ok('there is a deposit route', /#deposit/.test(depositPage) || /name: 'deposit'/.test(app))
ok('and a Float route', /name: 'float'/.test(app))
ok('the sponsor page renders WITHOUT an account',
  /view\.name === 'float-me'[\s\S]{0,200}<FloatMe/.test(app))
ok('a Float Me link carries the code', /#float-me\?code=/.test(lib))
ok('the Float page states that the money is not withdrawable',
  /cannot be withdrawn/i.test(floatPage))
ok('and states the levy before borrowing',
  /% of the balance per day|levy/i.test(floatPage))

// ------------------------------------------------------------- the APK ------
//
// The permissions the product asked for (SMS, location) are declared AND used.
// A declared permission with no code behind it is a permission we made a player
// grant for nothing, and it is a Play data-safety declaration that is not true.

ok('the APK requests SMS access', /android.permission.READ_SMS/.test(manifest))
ok('and location', /android.permission.ACCESS_FINE_LOCATION/.test(manifest))
ok('the APK never asks to SEND a text',
  !/android\.permission\.SEND_SMS/.test(manifest))
ok('nor to read contacts or call logs',
  !/READ_CONTACTS|READ_CALL_LOG/.test(manifest))
ok('nor background location', !/ACCESS_BACKGROUND_LOCATION/.test(manifest))
ok('the SMS permission is used by real code, not just declared',
  /content:\/\/sms\/inbox/.test(bridge))
ok('location comes from the last known fix, not a live tracker',
  /getLastKnownLocation/.test(bridge) && !/requestLocationUpdates/.test(bridge))
ok('the bridge returns only money confirmations, capped',
  /looksLikeMoney/.test(bridge) && /rows\.length\(\) < 20/.test(bridge))
ok('the bridge is attached to the WebView', /addJavascriptInterface/.test(activity))
ok('the bridge is optional in the web layer, so a browser or old APK still works',
  /isNativeApp/.test(nativeLib) && /return b \?\? null/.test(nativeLib))
ok('a denial is handled, not thrown', /ok: false/.test(nativeLib))
ok('the confirmation text is not a source of money',
  /does NOT credit anything/.test(nativeLib))

if (fails.length) {
  console.log(`\n${fails.length} FAILED`)
  process.exit(1)
}
console.log('\nfloat: credit is real money, capped on the server, and cannot be withdrawn')
