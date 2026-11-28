// smoke/readiness.ts
//
// Can this deployment take real money, and does the app know?
//
// WHY THIS SUITE EXISTS
//
// The live site refused every deposit with "Mobile money is not configured"
// while the admin health screen reported everything healthy. Two separate
// failures, both silent:
//
//   1. no env was set, and nothing surfaced that except a 503 to one player
//   2. the health screen checked eight things and payments was not one of them
//
// and one dishonest one: the hosted-checkout return URL carried `?session=`
// while the router read `?reference=`, so the success page had no reference and
// set its state to "paid" without asking anyone.
//
// These checks are on the REAL modules, injected with different env values, so
// the answer here is the answer production will give.
import { readFileSync } from 'node:fs'

// The payment client is a Deno module and reads Deno.env at import time. Under
// Node that is a ReferenceError before any assertion runs, so the shim is
// installed first and the module imported dynamically -- the same pattern
// smoke/feed.ts uses for the odds-feed client.
const envStore: Record<string, string> = {}
;(globalThis as any).Deno ??= {
  env: {
    get: (k: string) => envStore[k],
    set: (k: string, v: string) => { envStore[k] = v },
    delete: (k: string) => { delete envStore[k] },
  },
}
const { paymentReadiness, isIpNotPermitted, GatewayError } =
  await import('../supabase/functions/_shared/zengapay.ts')

let fail = 0
const check = (name: string, cond: boolean, extra = '') => {
  if (!cond) fail++
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name} ${extra}`)
}

const read = (p: string) => readFileSync(p, 'utf8')
const withEnv = (env: Record<string, string>) => {
  const saved: Record<string, string | undefined> = {}
  for (const k of ['ZENGAPAY_API_URL', 'ZENGAPAY_API_TOKEN', 'ZENGAPAY_WEBHOOK_SECRET']) {
    saved[k] = Deno.env.get(k)
  }
  for (const k of Object.keys(saved)) Deno.env.delete(k)
  for (const [k, v] of Object.entries(env)) Deno.env.set(k, v)
  return () => {
    for (const k of Object.keys(saved)) {
      if (saved[k] === undefined) Deno.env.delete(k)
      else Deno.env.set(k, saved[k]!)
    }
  }
}

// ------------------------------------------------------------ the verdicts --
{
  const restore = withEnv({})
  const r = paymentReadiness()
  check('with no env at all, deposits are reported blocked', r.blockers.length > 0, r.mode)
  check('unconfigured is its own mode, not "sandbox"', r.mode === 'unconfigured')
  check('the blocker names the missing variable',
    r.blockers.some((b) => b.includes('ZENGAPAY_API_TOKEN')))
  check('the message a player sees is the same one the health screen reports',
    r.blockers.some((b) => /no deposit can be requested/.test(b)))
  restore()
}

{
  const restore = withEnv({
    ZENGAPAY_API_URL: 'https://api.zengapay.com/v1',
    ZENGAPAY_API_TOKEN: 'ZPYPUBK-abc123',
    ZENGAPAY_WEBHOOK_SECRET: 'shh',
  })
  const r = paymentReadiness()
  check('a live token plus a webhook secret reports ready', r.blockers.length === 0, r.blockers.join('; '))
  check('and is reported as live, not sandbox', r.mode === 'live')
  restore()
}

{
  // The dangerous half-configured state: money can be charged but no webhook can
  // be verified, so the credit never lands.
  const restore = withEnv({
    ZENGAPAY_API_URL: 'https://api.zengapay.com/v1',
    ZENGAPAY_API_TOKEN: 'ZPYPUBK-abc123',
  })
  const r = paymentReadiness()
  check('live token without a webhook secret is blocked',
    r.blockers.some((b) => b.includes('ZENGAPAY_WEBHOOK_SECRET')))
  check('and says the charge could be taken and never credited',
    r.blockers.some((b) => /never credited/.test(b)))
  restore()
}

{
  // The dashboard calls it an "API key", and storing it under that name is easy
  // to do. It happened on this project and the symptom was a 503 while the
  // secret sat there set under a name nothing read.
  const restore = withEnv({
    ZENGAPAY_API_URL: 'https://api.zengapay.com/v1',
    ZENGAPAY_API_KEY: 'ZPYPUBK-under-the-other-name',
    ZENGAPAY_WEBHOOK_SECRET: 'shh',
  })
  const r = paymentReadiness()
  check('the key is accepted under the name the dashboard uses', r.blockers.length === 0, r.blockers.join('; '))
  check('and that counts as live, not sandbox', r.mode === 'live')
  restore()
}

{
  const restore = withEnv({ ZENGAPAY_API_TOKEN: 'not-a-real-key' })
  const r = paymentReadiness()
  check('a token that is not a ZPYPUBK key is called out',
    r.blockers.some((b) => b.includes('ZPYPUBK-')))
  restore()
}

{
  const restore = withEnv({
    ZENGAPAY_API_URL: 'https://api.zengapay.com/v1',
    ZENGAPAY_API_TOKEN: 'ZPYPUBK-abc123',
    ZENGAPAY_WEBHOOK_SECRET: 'shh\n',
  })
  check('a newline in a secret does not break the screen', !paymentReadiness().blockers.some((b) => b.includes('\n')))
  restore()
}

// ------------------------------------------------- the health screen knows --
const adminOps = read('supabase/functions/admin-ops/index.ts')
check('the admin health screen reports a payments check', /key: 'payments'/.test(adminOps))
check('it reads the same helper the payment path uses', /paymentReadiness\(\)/.test(adminOps))
check('a blocked payment path is state bad, not warn',
  /key: 'payments',[\s\S]{0,400}?p\.blockers\.length === 0 \? 'ok' : 'bad'/.test(adminOps))

// ------------------------------------------------- the success page is honest --
const success = read('src/pages/TopUpSuccess.tsx')
check('with no reference the page no longer claims the payment is paid',
  !/if \(!reference\) \{[\s\S]{0,300}?setState\('paid'\)/.test(success))
check('a hosted-checkout session is resolved before any claim',
  /resolveCheckoutSession\(sessionId\)/.test(success))
const pay = read('supabase/functions/pay/index.ts')
check('the checkout return URL uses the key the router reads',
  /#topup-success\?reference=CHECKOUT_SESSION_ID/.test(pay) &&
  !/#topup-success\?session=CHECKOUT_SESSION_ID/.test(pay))
check('the router parses both rails', /qs\.get\('session'\)/.test(read('src/App.tsx')))
check('there is a signed-in endpoint to resolve a session', /op === 'session'/.test(pay))
// APP_URL was never set on this project, so the fallback built return URLs from
// the request host -- the Supabase function host -- and returned a paying player
// to a 401 page. The default must be the site.
check('checkout returns to the site even when APP_URL is unset',
  /DEFAULT_APP_ORIGIN = 'https:\/\/floatbet\.space'/.test(pay) &&
  /if \(!\/supabase/.test(pay))
check('a session id is validated before it reaches the provider',
  /\^\[A-Za-z0-9_-\]\{8,128\}\$/.test(pay))
check('the client can call it', /'\/api\/session': 'pay\?op=session'/.test(read('src/lib/backend.ts')))

// ------------------------------------------- a blocked form explains itself --
// The pay button was silently disabled when the amount was under 500 or the
// phone was short. A tap on a disabled button does nothing at all, so a player
// reported "no outward sign" and had no way to learn the phone field was empty.
const panel = read('src/components/TopUpPanel.tsx')
check('a blocked top-up states the requirement up front',
  /blockedReason/.test(panel) && /minimum top-up is UGX 500/i.test(panel) && /mobile money number/i.test(panel))
check('the pay button is not disabled for a form problem, only while sending',
  /disabled=\{busy\}/.test(panel) && !/disabled=\{busy \|\| ugx < 500/.test(panel))
check('a tap while blocked still surfaces the reason', /if \(blockedReason\) \{ setError\(blockedReason\); return \}/.test(panel))

// ------------------------------- a confirmed top-up must reach the screen --
// A real UGX 600 deposit completed on 2026-11-28 (order TOP-MWZSSJUU): the
// webhook credited wallets.balance_px and wrote a +600 ledger row, and the app
// showed no change. The real balance lived only in localStorage, seeded to
// STARTING_UGX, and nothing ever read it back from the database.
const store = read('src/lib/store.tsx')
check('the store adopts the server wallet balance',
  /stateRef\.current\.balance === server/.test(store) || /balance: server/.test(store))
check('and it reads the balance from the server row, not a local seed',
  /serverWallet\.balance_px/.test(store))
check('the top-up panel refreshes after a completed payment',
  /poll\.state === 'completed'[\s\S]{0,120}refreshWallet\(\)/.test(read('src/components/TopUpPanel.tsx')))

// ------------------------------- the cashout gates the owner asked for ----
// Comments in this migration name the gates it removed, so strip them before
// asserting on the code.
const sql17 = read('supabase/migrations/0017_cashout_gates.sql')
  .split('\n').map((l) => l.replace(/--.*$/, '')).join('\n')
check('no 7-day account-age gate remains', !/86400|v_age_days/.test(sql17))
check('no phone-verification gate remains', !/phone_verified/.test(sql17))
check('the 18+ gate is kept (not part of the request)', /age_confirmed/.test(sql17))
check('the minimum and the balance lock survive',
  /minimum cashout is 1,000 UGX/.test(sql17) && /for update/.test(sql17))
check('the cashout page no longer asks for phone verification',
  !/Verify your phone number in Settings/.test(read('src/pages/Cashout.tsx')))

// ------------------------------- an IP fault is not a token fault ----------
// This cost real money and real confusion. ZENGAPAY refuses whitelisted
// endpoints (checkout, transfers, account) from an unlisted host with HTTP 403,
// and their body names the offending IP. We called every 403 "rejected our API
// token", so the operator's obvious move -- rotate a perfectly good token --
// could never have fixed it. The two have opposite fixes, so they must read
// differently.
{
  const theirs =
    'Connection refused from unauthorized IP: 81.202.241.36,  This IP is NOT ' +
    'unauthorized to access the /account endpoint on your account. If you believe ' +
    'this is in error, please contact support@zengapay.com'
  check('an IP refusal is recognised', isIpNotPermitted(theirs))
  check('a token complaint is not mistaken for an IP refusal',
    !isIpNotPermitted('Invalid API token supplied'))
  check('an invalid-token 401 message is not an IP refusal',
    !isIpNotPermitted('Unauthorized: the token provided is invalid'))
  check('an empty message is not an IP refusal', !isIpNotPermitted(''))

  // The real `request` path, driven with a stubbed fetch. This is the assertion
  // that keeps the two errors from collapsing back into one string.
  const restore = withEnv({
    ZENGAPAY_API_URL: 'https://api.zengapay.com/v1',
    ZENGAPAY_API_TOKEN: 'ZPYPUBK-live-abc',
    ZENGAPAY_WEBHOOK_SECRET: 'whsec_live',
  })
  const realFetch = globalThis.fetch
  const stub = (status: number, body: unknown) => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })) as any
  }
  try {
    const { disbursePayment } = await import('../supabase/functions/_shared/zengapay.ts')

    stub(403, { code: 403, status: 'Forbidden', message: theirs })
    let err: any = null
    try { await disbursePayment({ amount: 1000, currency: 'UGX', phone_number: '0758443666', description: 'x', order_id: 'T1' }) }
    catch (e) { err = e }
    check('a 403 naming an IP becomes PROVIDER_IP_NOT_PERMITTED',
      err instanceof GatewayError && err.code === 'PROVIDER_IP_NOT_PERMITTED', `(${err?.code})`)
    check('and it says what to do, in the operator\'s language',
      /whitelist/i.test(err?.message ?? '') && /Developer Settings/i.test(err?.message ?? ''))
    check('and it keeps ZENGAPAY\'s own words, including the IP',
      (err?.message ?? '').includes('81.202.241.36'))
    check('and it does NOT blame the token', !/rejected our API token/i.test(err?.message ?? ''))

    stub(401, { code: 401, status: 'Unauthorized', message: 'Invalid API token supplied' })
    err = null
    try { await disbursePayment({ amount: 1000, currency: 'UGX', phone_number: '0758443666', description: 'x', order_id: 'T2' }) }
    catch (e) { err = e }
    check('a 401 is still a credential fault',
      err instanceof GatewayError && err.code === 'PAYMENT_NOT_CONFIGURED', `(${err?.code})`)
    check('and still mentions the token', /token/i.test(err?.message ?? ''))
  } finally {
    globalThis.fetch = realFetch
    restore()
  }
}

// ------------------------------- the health screen can see a payout failure --
// The IP probe exists so an operator does not have to find out from a player.
{
  const admin = read('supabase/functions/admin-ops/index.ts')
  check('the health screen probes the payout path, not just deposits',
    /checkIpAllowed\(\)/.test(admin) && /key: 'payouts'/.test(admin))
  check('it names the setting to change',
    /Developer Settings/.test(admin) && /IP Address/.test(admin))
  check('it says deposits are unaffected, because they are',
    /Deposits still work/.test(admin))
  check('the probe is bounded so the screen cannot hang',
    /timeoutMs: 8_000/.test(read('supabase/functions/_shared/zengapay.ts')))
}

// ------------------------------- a refused payout must not keep the money ---
// request_cashout moves the amount out of the balance into a hold BEFORE the
// provider is asked. If the provider then refuses, nothing gave it back: the
// cashout sat at `requested` forever and the player was short with no
// explanation. This is what an un-whitelisted IP did in production.
{
  const cashout = read('src/pages/Cashout.tsx')
  check('a failed payout releases the hold it created',
    /cancel_cashout/.test(cashout) && /held/.test(cashout))
  check('the player is told the balance was restored',
    /balance has been restored/.test(cashout))

  const sql18 = read('supabase/migrations/0018_cancel_cashout.sql')
    .split('\n').map((l: string) => l.replace(/--.*$/, '')).join('\n')
  check('cancel_cashout refunds through settle_cashout, not a second money path',
    /perform settle_cashout\(/.test(sql18))
  check('it is limited to the caller\'s own cashout',
    /v_co\.user_id <> v_uid/.test(sql18))
  check('it cannot cancel a payout the provider already accepted',
    /v_co\.status <> 'requested'/.test(sql18))
  check('it is not callable by anon', /revoke all on function public\.cancel_cashout\(uuid\) from anon/.test(sql18))
}

// ------------------------------------------------------- the env is honest --
const env = read('.env.example')
check('the env template no longer documents the retired gateway', !/DGATEWAY/i.test(env))
const wanted = ['ZENGAPAY_API_URL', 'ZENGAPAY_API_TOKEN', 'ZENGAPAY_WEBHOOK_SECRET', 'APP_URL', 'ODDS_API_KEY']
check('the env template names them', wanted.every((k) => env.includes(k)))
check('APP_URL is the domain players actually use', /^APP_URL=https:\/\/floatbet\.space$/m.test(env))
check('the env template says the webhook secret is required in live mode',
  /REQUIRED IN LIVE MODE/i.test(env))

// ------------------------------------------------------ the webhook is wired --
const live = read('docs/GO-LIVE.md')
check('the runbook points the webhook at the edge function, not the dead Vercel path',
  /functions\/v1\/webhooks-zengapay/.test(live))
// The runbook's env table is what an operator copies. If it still names the old
// host, APP_URL gets set to a domain that is not the one players use, and a paid
// checkout returns them to a site that does not exist.
check('the runbook no longer sets APP_URL to the retired host',
  !/\|\s*`APP_URL`\s*\|[^|]*shoppa-sigma/.test(live))

console.log(fail ? `\n${fail} FAILED` : '\npayments: the config, the health screen and the success page all agree')
process.exit(fail ? 1 : 0)
