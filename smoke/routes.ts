import collect from '../api/collect'
import disburse from '../api/disburse'
import status from '../api/status'
import webhook from '../api/webhooks/dgateway'

const fails: string[] = []
const ok = (n: string, c: boolean, extra = '') => { if (!c) fails.push(n); console.log(`${c ? 'ok  ' : 'FAIL'} ${n} ${extra}`) }

const realFetch = globalThis.fetch
let calls: { url: string; init: any }[] = []
function mockUpstream(handler: (url: string, init: any) => any) {
  calls = []
  globalThis.fetch = (async (url: any, init: any) => {
    const u = String(url)
    calls.push({ url: u, init })
    return handler(u, init)
  }) as any
}
const jsonRes = (body: any, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

// ---- no / bad auth on every authenticated route ----
for (const [name, fn] of [['collect', collect], ['disburse', disburse], ['status', status]] as const) {
  mockUpstream(() => jsonRes({}, 500))
  const req = new Request('http://x/api/' + name, { method: name === 'status' ? 'GET' : 'POST', body: name === 'status' ? undefined : '{}' })
  const res = await (fn as any)(req)
  ok(`${name}: rejects unauthenticated (${res.status})`, res.status === 401)
}

// ---- collect: amount/phone validation happens before upstream ----
process.env.SUPABASE_URL = 'https://fake.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc'
process.env.DGATEWAY_API_KEY = 'dgw_test_fake'

const authHeader = { Authorization: 'Bearer good-token' }
mockUpstream((u) => {
  if (u.includes('/auth/v1/user')) return jsonRes({ id: 'user-1' })
  if (u.includes('/v1/payments/collect')) return jsonRes({ data: { reference: 'DG-1', status: 'pending', provider: 'iotec' } })
  if (u.includes('/rest/v1/rpc/')) return jsonRes(null, 204)
  return jsonRes({}, 404)
})

let res = await collect(new Request('http://x/api/collect', { method: 'POST', headers: authHeader, body: JSON.stringify({ amount: 5000, phone: '0771234567' }) }))
let body: any = await res.json()
ok('collect: succeeds', res.status === 200, JSON.stringify(body))
ok('collect: returns reference', body.reference === 'DG-1')
ok('collect: tells user to check phone', /check your phone/i.test(body.message))

const collectCall = calls.find((c) => c.url.includes('/v1/payments/collect'))!
const sent = JSON.parse(collectCall.init.body)
ok('collect: sends X-API-Key header', collectCall.init.headers['X-API-Key'] === 'dgw_test_fake')
ok('collect: keeps leading 0 in phone', sent.phone_number === '0771234567')
ok('collect: sends whole-unit amount', sent.amount === 5000)
ok('collect: sends currency UGX', sent.currency === 'UGX')
ok('collect: sends callback_url', String(sent.callback_url).endsWith('/api/webhooks/dgateway'))

// decimals rejected
res = await collect(new Request('http://x/api/collect', { method: 'POST', headers: authHeader, body: JSON.stringify({ amount: 50.5, phone: '0771234567' }) }))
ok('collect: rejects decimal amount', res.status === 400)

// bad phone rejected
res = await collect(new Request('http://x/api/collect', { method: 'POST', headers: authHeader, body: JSON.stringify({ amount: 5000, phone: '12345' }) }))
ok('collect: rejects bad phone', res.status === 400)

// ---- disburse ----
mockUpstream((u) => {
  if (u.includes('/auth/v1/user')) return jsonRes({ id: 'user-1' })
  if (u.includes('/v1/payments/disburse')) return jsonRes({ data: { reference: 'DG-2', status: 'pending', provider: 'relworx' } })
  if (u.includes('/rest/v1/rpc/')) return jsonRes(null, 204)
  return jsonRes({}, 404)
})
res = await disburse(new Request('http://x/api/disburse', { method: 'POST', headers: authHeader, body: JSON.stringify({ amount: 25000, phone: '+256771234567', cashoutId: 'c1' }) }))
body = await res.json()
ok('disburse: succeeds', res.status === 200, JSON.stringify(body))
ok('disburse: reference returned', body.reference === 'DG-2')
const disCall = calls.find((c) => c.url.includes('/v1/payments/disburse'))!
ok('disburse: uses +256 form', JSON.parse(disCall.init.body).phone_number === '+256771234567')
ok('disburse: no callback_url needed', JSON.parse(disCall.init.body).callback_url === undefined)

// ---- status: memoised at 10s ----
let statusHits = 0
mockUpstream((u) => {
  if (u.includes('/auth/v1/user')) return jsonRes({ id: 'user-1' })
  if (u.includes('/v1/transactions/')) { statusHits++; return jsonRes({ data: { reference: 'DG-1', status: 'pending' } }) }
  return jsonRes({}, 404)
})
const mkStatus = () => new Request('http://x/api/status?reference=DG-1', { headers: authHeader })
await status(mkStatus())
await status(mkStatus())
await status(mkStatus())
ok('status: upstream hit once per 10s window', statusHits === 1, `(hits=${statusHits})`)
const s3 = await (await status(mkStatus())).json() as any
ok('status: reports pollAfterMs 10000', s3.pollAfterMs === 10000)

// ---- webhook: signature required ----
process.env.DGATEWAY_WEBHOOK_SECRET = ''
mockUpstream(() => jsonRes({}))
let wres = await webhook(new Request('http://x/api/webhooks/dgateway', { method: 'POST', body: JSON.stringify({ reference: 'DG-1', status: 'completed' }) }))
ok('webhook: rejects when no secret configured', wres.status === 401)

process.env.DGATEWAY_WEBHOOK_SECRET = 'whsec_test'
wres = await webhook(new Request('http://x/api/webhooks/dgateway', { method: 'POST', headers: { 'X-DGateway-Signature': 'deadbeef' }, body: '{}' }))
ok('webhook: rejects malformed signature', wres.status === 401)

// valid signature but unknown reference
const payload = JSON.stringify({ reference: 'DG-UNKNOWN', status: 'completed' })
const enc = new TextEncoder()
const k = await crypto.subtle.importKey('raw', enc.encode('whsec_test'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
const sig = [...new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(payload)))].map((b) => b.toString(16).padStart(2, '0')).join('')
mockUpstream((u) => {
  if (u.includes('/rest/v1/payment_orders')) return jsonRes([])
  return jsonRes({}, 404)
})
wres = await webhook(new Request('http://x/api/webhooks/dgateway', { method: 'POST', headers: { 'X-DGateway-Signature': `sha256=${sig}` }, body: payload }))
ok('webhook: accepts good HMAC', wres.status !== 401, `(got ${wres.status})`)
ok('webhook: refuses unknown reference', wres.status === 404)

globalThis.fetch = realFetch
console.log(fails.length ? `\n${fails.length} FAILED: ${fails.join(', ')}` : '\nall route checks passed')
process.exit(fails.length ? 1 : 0)
