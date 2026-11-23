// smoke/edge.ts
//
// Proves the Supabase Edge Functions behave like the Vercel routes they replaced.
//
// WHAT IS ACTUALLY UNDER TEST
//
// Not a reimplementation: `supabase/.dist/*.ts` is the exact file the deploy
// workflow uploads (scripts/build-edge-functions.mjs flattens index.ts + its
// _shared imports; the workflow only minifies it afterwards). So a failure here
// is a failure in production.
//
// Deno and the Supabase JS client are stubbed. Everything else — the HMAC
// verification, the money limits, the admin gate, the status cache — is the real
// code path.
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { apiUrl } from '../src/lib/backend'

const fails: string[] = []
const ok = (name: string, cond: boolean, extra = '') => {
  if (!cond) fails.push(name)
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name} ${extra}`)
}

// ------------------------------------------------------------- Deno shim ----

const ENV: Record<string, string> = {
  SUPABASE_URL: 'https://fake.supabase.co',
  SUPABASE_ANON_KEY: 'anon-key',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key',
  DGATEWAY_API_KEY: 'dgw_test_abc',
  DGATEWAY_WEBHOOK_SECRET: 'whsec_test',
  CRON_SECRET: 'cron-secret',
  ODDS_API_KEY: 'odds-key',
  APP_URL: 'https://floatbet.space',
}

type Handler = (req: Request) => Promise<Response>
const handlers: Record<string, Handler> = {}

;(globalThis as any).Deno = {
  env: { get: (k: string) => ENV[k] },
  serve: (fn: Handler) => {
    // Each bundle calls Deno.serve once; the loop below registers them by order.
    handlers[Object.keys(handlers).length.toString()] = fn
  },
}

// ------------------------------------------------------- network stubs ------

const realFetch = globalThis.fetch
type Call = { url: string; init: any }
let calls: Call[] = []

function upstream(handler: (url: string, init: any) => Response | null) {
  calls = []
  globalThis.fetch = (async (url: any, init: any) => {
    const u = String(url)
    calls.push({ url: u, init })
    const hit = handler(u, init)
    if (hit) return hit
    throw new Error(`unstubbed upstream call: ${u}`)
  }) as any
}

const jsonRes = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

// Supabase client calls go through our mocked fetch, so no network is touched.

// --------------------------------------------------------------- bundles ----

// Importing a bundle runs its Deno.serve, which registers the handler above.
const bundleFiles = ['pay', 'admin-ops', 'webhooks-dgateway', 'webhooks-dgateway-store', 'feed-sports']
for (let i = 0; i < bundleFiles.length; i++) {
  // @ts-expect-error generated module, no types
  await import(`../supabase/.dist/${bundleFiles[i]}.ts`)
}
const handler = (i: number) => handlers[i.toString()]

const pay = handler(0)
const admin = handler(1)
const wh = handler(2)
const whStore = handler(3)
const feedSports = handler(4)

ok('every bundle registered a handler', [pay, admin, wh, whStore, feedSports].every(Boolean))

// -------------------------------------------------------- frontend routes ----

ok('apiUrl maps collect', apiUrl('/api/collect').endsWith('/functions/v1/pay?op=collect'))
ok('apiUrl maps claim', apiUrl('/api/topup/claim').endsWith('/functions/v1/pay?op=claim'))
ok('apiUrl maps admin players', apiUrl('/api/admin/players', { limit: '100' }).endsWith('/functions/v1/admin-ops?op=players&limit=100'))
ok('apiUrl maps admin parked', apiUrl('/api/admin/parked', { status: 'pending' }).endsWith('admin-ops?op=parked&status=pending'))
ok('apiUrl maps feed sync', apiUrl('/api/feed/sync').endsWith('/functions/v1/feed-sync'))
let threw = false
try { apiUrl('/api/does-not-exist') } catch { threw = true }
ok('apiUrl refuses an unmapped path', threw)

// The mapping table is the contract between the bundle and the deployment: a
// path that resolves to a function nobody deployed is a 404 in production, and
// the browser gets an HTML 404 page that `res.json()` quietly turns into null.
// So compare every mapped slug against supabase/functions/ on disk.
// Run from the repo root (the other smoke suites share that convention), so
// this resolves against the working directory rather than the built file.
const deployed = new Set(
  readdirSync(join(process.cwd(), 'supabase/functions'), { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== '_shared')
    .map((d) => d.name),
)

for (const [path, target] of [
  ['/api/collect', 'pay'], ['/api/disburse', 'pay'], ['/api/status', 'pay'],
  ['/api/topup/claim', 'pay'],
  ['/api/admin/health', 'admin-ops'], ['/api/admin/cashouts', 'admin-ops'],
  ['/api/admin/audit', 'admin-ops'], ['/api/admin/lookup', 'admin-ops'],
  ['/api/admin/players', 'admin-ops'], ['/api/admin/parked', 'admin-ops'],
  ['/api/admin/actions', 'admin-ops'],
  ['/api/feed/sports', 'feed-sports'], ['/api/feed/settle', 'feed-settle'],
  ['/api/feed/sync', 'feed-sync'],
] as const) {
  const url = apiUrl(path)
  ok(`${path} -> ${target} (deployed)`, url.includes(`/functions/v1/${target}`) && deployed.has(target))
}

// The two webhooks are called by DGateway, never by the app, so they have no
// entry in the mapping table. They must still exist.
ok('webhooks-dgateway is deployed', deployed.has('webhooks-dgateway'))
ok('webhooks-dgateway-store is deployed', deployed.has('webhooks-dgateway-store'))

// ------------------------------------------------------------- pay: auth ----

upstream(() => jsonRes({}, 500))
let res = await pay(new Request('https://x/functions/v1/pay?op=collect', { method: 'POST', body: '{}' }))
ok(`pay: unauthenticated collect is 401 (${res.status})`, res.status === 401)

res = await pay(new Request('https://x/functions/v1/pay?op=status&reference=DG-1'))
ok(`pay: unauthenticated status is 401 (${res.status})`, res.status === 401)

// --------------------------------------------------------- pay: collect ----

upstream((u) => {
  if (u.includes('/auth/v1/user')) return jsonRes({ id: 'user-1' })
  if (u.includes('/v1/payments/collect')) return jsonRes({ data: { reference: 'DG-1', status: 'pending', provider: 'iotec' } })
  if (u.includes('/rest/v1/rpc/record_collect')) return jsonRes(null, 204)
  return null
})

const auth = { Authorization: 'Bearer good-token', 'Content-Type': 'application/json' }

res = await pay(new Request('https://x/functions/v1/pay?op=collect', {
  method: 'POST', headers: auth, body: JSON.stringify({ amount: 5000, phone: '0771234567' }),
}))
let body: any = await res.json()
ok('collect: succeeds', res.status === 200, JSON.stringify(body))
ok('collect: returns the reference', body.reference === 'DG-1')
const collectCall = calls.find((c) => c.url.includes('/v1/payments/collect'))!
const sent = JSON.parse(collectCall.init.body)
ok('collect: sends X-API-Key', collectCall.init.headers['X-API-Key'] === 'dgw_test_abc')
ok('collect: keeps the leading 0 in the phone', sent.phone_number === '0771234567')
ok('collect: whole-unit amount', sent.amount === 5000)
ok('collect: callback is the deployed webhook', String(sent.callback_url) === 'https://floatbet.space/functions/v1/webhooks-dgateway')

// limits, checked before any upstream call: the auth lookup still answers, but
// anything that would move money throws.
upstream((u) => {
  if (u.includes('/auth/v1/user')) return jsonRes({ id: 'user-1' })
  throw new Error(`must not reach ${u}`)
})
for (const [label, amount, want] of [
  ['below the 500 UGX floor', 499, 400],
  ['above the 5,000,000 UGX ceiling', 5_000_001, 400],
  ['not a whole number', 500.5, 400],
] as const) {
  const r = await pay(new Request('https://x/functions/v1/pay?op=collect', {
    method: 'POST', headers: auth, body: JSON.stringify({ amount, phone: '0771234567' }),
  }))
  ok(`collect: rejects ${label} (${r.status})`, r.status === want)
}

// -------------------------------------------------------- pay: live mode ----

const savedKey = ENV.DGATEWAY_API_KEY
const savedSecret = ENV.DGATEWAY_WEBHOOK_SECRET
ENV.DGATEWAY_API_KEY = 'dgw_live_abc'
delete ENV.DGATEWAY_WEBHOOK_SECRET
upstream((u) => (u.includes('/auth/v1/user') ? jsonRes({ id: 'user-1' }) : null))
res = await pay(new Request('https://x/functions/v1/pay?op=collect', {
  method: 'POST', headers: auth, body: JSON.stringify({ amount: 5000, phone: '0771234567' }),
}))
body = await res.json()
ok('live key with no webhook secret refuses to charge', res.status === 503 && body.code === 'WEBHOOK_SECRET_MISSING')
ok('refusal reached no upstream payments call', !calls.some((c) => c.url.includes('/v1/payments')))
ENV.DGATEWAY_API_KEY = savedKey
ENV.DGATEWAY_WEBHOOK_SECRET = savedSecret

// ------------------------------------------------------- pay: status cache --

let statusHits = 0
upstream((u) => {
  if (u.includes('/auth/v1/user')) return jsonRes({ id: 'user-1' })
  if (u.includes('/v1/transactions/')) {
    statusHits++
    return jsonRes({ data: { reference: 'DG-CACHE', status: 'pending', amount: 5000, currency: 'UGX' } })
  }
  return null
})
const poll = () => pay(new Request('https://x/functions/v1/pay?op=status&reference=DG-CACHE', { headers: auth }))
const first = await (await poll()).json() as any
const second = await (await poll()).json() as any
ok('status: first read is uncached', first.cached === false)
ok('status: second read inside 10s is cached', second.cached === true)
ok('status: memoised window makes one upstream call', statusHits === 1, `(${statusHits})`)
ok('status: pollAfterMs is 10s', first.pollAfterMs === 10_000)
const fresh = await (await pay(new Request('https://x/functions/v1/pay?op=status&reference=DG-CACHE&fresh=1', { headers: auth }))).json() as any
ok('status: fresh=1 bypasses the cache', fresh.cached === false && statusHits === 2)

// --------------------------------------------------------- admin gate ------

upstream((u) => {
  if (u.includes('/auth/v1/user')) return jsonRes({ id: 'user-1' })
  if (u.includes('/rest/v1/profiles')) return jsonRes({ id: 'user-1', username: 'player', is_admin: false })
  return null
})
res = await admin(new Request('https://x/functions/v1/admin-ops?op=health', { headers: auth }))
ok(`admin: a signed-in non-admin gets 403 (${res.status})`, res.status === 403)

upstream((u) => {
  if (u.includes('/auth/v1/user')) return jsonRes({ id: 'admin-1' })
  if (u.includes('/rest/v1/profiles')) return jsonRes({ id: 'admin-1', username: 'boss', is_admin: true })
  return null
})
res = await admin(new Request('https://x/functions/v1/admin-ops?op=health'))
ok(`admin: no token at all is 401 (${res.status})`, res.status === 401)

// an adjust above the cap is refused before the database sees it
res = await admin(new Request('https://x/functions/v1/admin-ops?op=actions', {
  method: 'POST', headers: auth,
  body: JSON.stringify({ action: 'adjust', userId: '9f1d5b1e-0000-4000-8000-000000000000', deltaPx: 5_000_001 }),
}))
ok(`admin: adjustment over the cap is refused (${res.status})`, res.status === 400)

// ------------------------------------------------------------ webhooks -----

const sign = async (raw: string) => {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', enc.encode('whsec_test'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(raw)))
  return [...sig].map((b) => b.toString(16).padStart(2, '0')).join('')
}

upstream(() => { throw new Error('must not reach upstream') })
res = await wh(new Request('https://x/functions/v1/webhooks-dgateway', { method: 'POST', body: '{}' }))
ok(`webhook: unsigned request is 401 (${res.status})`, res.status === 401)

const payload = JSON.stringify({ reference: 'DG-UNKNOWN', status: 'completed' })
res = await wh(new Request('https://x/functions/v1/webhooks-dgateway', {
  method: 'POST', headers: { 'X-DGateway-Signature': 'sha256=deadbeef' }, body: payload,
}))
ok(`webhook: malformed signature is 401 (${res.status})`, res.status === 401)

upstream((u) => {
  if (u.includes('/rest/v1/payment_orders')) return jsonRes([])
  return null
})
res = await wh(new Request('https://x/functions/v1/webhooks-dgateway', {
  method: 'POST', headers: { 'X-DGateway-Signature': await sign(payload) }, body: payload,
}))
ok(`webhook: good HMAC on an unknown reference is 404 (${res.status})`, res.status === 404)

// the store webhook must block an ambiguous cart before spending a look-up
const mixed = JSON.stringify({ line_items: [{ product_id: 'a', quantity: 1 }, { product_id: 'b', quantity: 1 }] })
upstream(() => { throw new Error('mixed cart must not be looked up') })
res = await whStore(new Request('https://x/functions/v1/webhooks-dgateway-store', {
  method: 'POST', headers: { 'X-DGateway-Signature': await sign(mixed) }, body: mixed,
}))
ok(`store webhook: mixed cart is 409 (${res.status})`, res.status === 409)

// --------------------------------------------------------------- feed ------

upstream((u) => { throw new Error(`must not reach ${u}`) })
res = await feedSports(new Request('https://x/functions/v1/feed-sports'))
ok(`feed-sports: unauthenticated is 401 (${res.status})`, res.status === 401)

upstream((u) => {
  if (u.includes('api.the-odds-api.com')) return jsonRes([{ key: 'soccer_epl', title: 'EPL', active: true }])
  return null
})
res = await feedSports(new Request('https://x/functions/v1/feed-sports?active=1', {
  headers: { Authorization: 'Bearer cron-secret' },
}))
body = await res.json()
ok(`feed-sports: cron secret is accepted (${res.status})`, res.status === 200)
ok('feed-sports: reports what to sync', (body.recommendedForSync ?? []).includes('soccer_epl'))

globalThis.fetch = realFetch
console.log(fails.length ? `\n${fails.length} FAILED: ${fails.join(', ')}` : '\nall edge-function checks passed')
process.exit(fails.length ? 1 : 0)
