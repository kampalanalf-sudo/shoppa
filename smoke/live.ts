import { op } from './payop'

const collect = (req: Request) => op('collect', req)

const fails: string[] = []
const ok = (n: string, c: boolean, e = '') => { if (!c) fails.push(n); console.log(`${c ? 'ok  ' : 'FAIL'} ${n} ${e}`) }

const jsonRes = (b: any, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })
const real = globalThis.fetch
let upstreamHits = 0
globalThis.fetch = (async (u: any) => {
  const url = String(u)
  if (url.includes('/auth/v1/user')) return jsonRes({ id: 'u1' })
  if (url.includes('/v1/payments/')) { upstreamHits++; return jsonRes({ data: { reference: 'DG-1', status: 'pending' } }) }
  if (url.includes('/rest/v1/rpc/')) return jsonRes(null)
  return jsonRes({}, 404)
}) as any

process.env.SUPABASE_URL = 'https://fake.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc'
const auth = { Authorization: 'Bearer t', 'content-type': 'application/json' }
const call = (body: any) => collect(new Request('http://x/api/collect', { method: 'POST', headers: auth, body: JSON.stringify(body) }))

// ---- LIVE key + no webhook secret => blocked, no upstream charge ----
process.env.DGATEWAY_API_KEY = 'dgw_live_abc123'
delete process.env.DGATEWAY_WEBHOOK_SECRET
upstreamHits = 0
let res = await call({ amount: 10000, phone: '0771234567' })
let body: any = await res.json()
ok('live + no webhook secret: blocked (503)', res.status === 503, JSON.stringify(body))
ok('live + no webhook secret: no charge attempted', upstreamHits === 0)
ok('live + no webhook secret: clear reason', /webhook/i.test(body.error))

// ---- LIVE key + secret set => allowed ----
process.env.DGATEWAY_WEBHOOK_SECRET = 'whsec_live'
upstreamHits = 0
res = await call({ amount: 10000, phone: '0771234567' })
body = await res.json()
ok('live + secret: proceeds', res.status === 200, JSON.stringify(body))
ok('live + secret: charged once', upstreamHits === 1)

// ---- ceilings ----
process.env.DGATEWAY_API_KEY = 'dgw_test_xyz'
upstreamHits = 0
res = await call({ amount: 9_000_000, phone: '0771234567' })
ok('over-max top-up rejected', res.status === 400)
ok('over-max: no upstream charge', upstreamHits === 0)

res = await call({ amount: 100, phone: '0771234567' })
ok('under-min top-up rejected', res.status === 400)

// ---- sandbox key: no webhook secret is tolerated (dev convenience) ----
delete process.env.DGATEWAY_WEBHOOK_SECRET
upstreamHits = 0
res = await call({ amount: 10000, phone: '0771234567' })
ok('sandbox without secret: still allowed for dev', res.status === 200, `(${res.status})`)

globalThis.fetch = real
console.log(fails.length ? `\n${fails.length} FAILED: ${fails.join(', ')}` : '\nall live-mode checks passed')
process.exit(fails.length ? 1 : 0)
