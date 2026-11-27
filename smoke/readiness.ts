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
const { paymentReadiness } = await import('../supabase/functions/_shared/zengapay.ts')

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
check('a session id is validated before it reaches the provider',
  /\^\[A-Za-z0-9_-\]\{8,128\}\$/.test(pay))
check('the client can call it', /'\/api\/session': 'pay\?op=session'/.test(read('src/lib/backend.ts')))

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
