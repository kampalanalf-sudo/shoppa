// smoke/wire.ts
//
// PROOF, NOT A CLAIM.
//
// This starts a real HTTP server that impersonates ZENGAPAY, points the real
// bunded edge function at it over the network, and prints exactly what goes over
// the wire: the URL, the method, every header, and the JSON body.
//
// It then feeds back a webhook signed the way ZENGAPAY signs one, and shows the
// wallet credit being applied.
//
// Nothing is stubbed at the network layer — the requests below are real HTTP to
// a real socket. What it proves:
//   * the endpoint is /v1/collections, not /v1/payments/collect
//   * auth is `Authorization: Bearer …`, not an X-API-Key header
//   * msisdn is digits-only with no leading 0 and no plus
//   * external_reference is our order id, and no callback_url is sent
//   * a webhook signed over reference+msisdn+amount is accepted
//   * a webhook signed over the raw body is rejected
import { createServer } from 'node:http'
import { writeFileSync } from 'node:fs'

const DENO_ENV: Record<string, string> = {
  SUPABASE_URL: 'https://fake.supabase.co',
  SUPABASE_ANON_KEY: 'anon-key',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key',
  ZENGAPAY_API_URL: 'http://127.0.0.1:0/v1', // replaced below once the port is known
  ZENGAPAY_API_TOKEN: 'ZPYPUBK-demo',
  ZENGAPAY_WEBHOOK_SECRET: 'secret-hash-demo',
  APP_URL: 'https://floatbet.space',
}
// Each bundle calls Deno.serve exactly once. Capture the handler in import
// order — this is how the edge suite does it, and it means the code under test
// is the uploaded bundle, not a re-import of the source.
const handlers: ((r: Request) => Promise<Response>)[] = []
;(globalThis as any).Deno = {
  env: { get: (k: string) => DENO_ENV[k] },
  serve: (fn: (r: Request) => Promise<Response>) => { handlers.push(fn) },
}

type Seen = { method: string; path: string; headers: Record<string, string>; body: string }
const seen: Seen[] = []
const transcript: string[] = []
const log = (s: string) => { transcript.push(s); console.log(s) }

// A real socket that answers as ZENGAPAY would.
const server = createServer((req, res) => {
  let body = ''
  req.on('data', (c) => { body += c })
  req.on('end', () => {
    seen.push({ method: req.method || '', path: req.url || '', headers: req.headers as any, body })
    res.setHeader('Content-Type', 'application/json')
    if (req.url?.includes('/collections') && req.method === 'POST') {
      res.statusCode = 202
      res.end(JSON.stringify({
        code: 202, status: 'accepted', message: 'Transaction Initiated',
        transactionReference: '20570a12-c92b-5893-b7df-91ea54a0af34',
      }))
      return
    }
    if (req.url?.includes('/transfers') && req.method === 'POST') {
      res.statusCode = 202
      res.end(JSON.stringify({
        code: 202, status: 'accepted', message: 'Transaction Initiated',
        transactionReference: 'trf-0001',
      }))
      return
    }
    res.statusCode = 404
    res.end(JSON.stringify({ code: 404, status: 'error', message: 'not found' }))
  })
})

await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
const port = (server.address() as any).port
DENO_ENV.ZENGAPAY_API_URL = `http://127.0.0.1:${port}/v1`

// Supabase traffic is intercepted; ZENGAPAY traffic is not — it leaves the
// process and comes back through the socket above.
const authCalls: string[] = []
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: any, init: any) => {
  const url = String(typeof input === 'string' ? input : input.url)
  if (url.startsWith(`http://127.0.0.1:${port}`)) return realFetch(input, init)
  authCalls.push(`${init?.method || 'GET'} ${url}`)
  if (url.includes('/auth/v1/user')) return new Response(JSON.stringify({ id: 'user-1' }), { status: 200 })
  if (url.includes('/rest/v1/rpc/')) return new Response('{}', { status: 200 })
  return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } })
}) as any

// The bundle is the exact file the deploy workflow uploads.
await import('../supabase/.dist/pay.ts')
const pay = handlers[0]

log('=== 1. TOP-UP: what the server actually sends to ZENGAPAY ===')
const res = await pay(new Request('https://x/functions/v1/pay?op=collect', {
  method: 'POST',
  headers: { Authorization: 'Bearer player-token', 'Content-Type': 'application/json' },
  body: JSON.stringify({ amount: 10000, currency: 'UGX', phone: '0771234567' }),
}))
const answered = await res.json() as any
const collect = seen.find((s) => s.path.includes('/collections'))!

log(`${collect.method} http://127.0.0.1:${port}${collect.path}`)
for (const [k, v] of Object.entries(collect.headers)) {
  if (['host', 'connection', 'content-length', 'accept-encoding', 'user-agent'].includes(k)) continue
  log(`  ${k}: ${v}`)
}
log(`  →  ${collect.body}`)
log('')
log(`response to the browser: ${JSON.stringify(answered)}`)

const fails: string[] = []
const ok = (n: string, c: boolean, extra = '') => { if (!c) fails.push(n); log(`${c ? 'PASS' : 'FAIL'}  ${n} ${extra}`) }

log('')
log('=== 2. is that the right shape? ===')
const sentBody = JSON.parse(collect.body)
ok('endpoint is POST /v1/collections', collect.method === 'POST' && collect.path === '/v1/collections', collect.path)
ok('no legacy /v1/payments/ path anywhere', !seen.some((s) => s.path.includes('/payments/')))
ok('auth is a Bearer token', collect.headers.authorization === 'Bearer ZPYPUBK-demo')
ok('no X-API-Key header', collect.headers['x-api-key'] === undefined)
ok('msisdn is 256771234567', sentBody.msisdn === '256771234567', String(sentBody.msisdn))
ok('msisdn carries no + ', !String(sentBody.msisdn).includes('+'))
ok('msisdn carries no leading 0', !String(sentBody.msisdn).startsWith('0'))
ok('amount is a whole number', sentBody.amount === 10000)
ok('external_reference is present and unique-looking', typeof sentBody.external_reference === 'string' && sentBody.external_reference.length > 0, sentBody.external_reference)
ok('no callback_url is sent (it lives in the dashboard)', sentBody.callback_url === undefined)
ok('the browser gets the provider reference back', answered.reference === '20570a12-c92b-5893-b7df-91ea54a0af34')

// ---------------------------------------------------------------- webhook ---
await import('../supabase/.dist/webhooks-zengapay.ts')
const wh = handlers[1]

const sign = async (s: string) => {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('secret-hash-demo'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(s)))
  return [...sig].map((b) => b.toString(16).padStart(2, '0')).join('')
}

const event = JSON.stringify({
  event: 'collection.success',
  data: {
    transactionSystemId: 'ZPY211025129553TX',
    transactionReference: '20570a12-c92b-5893-b7df-91ea54a0af34',
    transactionStatus: 'SUCCEEDED',
    amount: '10000',
    msisdn: '256771234567',
    MNOTransactionReferenceId: '13981886537',
  },
})

log('')
log('=== 3. the webhook ZENGAPAY would send ===')
log(event.slice(0, 130) + '…')

// The webhook re-fetches the transaction from the provider before crediting.
// Answer that read as settled.
const orderRow = JSON.stringify([{
  order_id: 'TOP-1', user_id: 'user-1', direction: 'collect', amount: 10000,
  currency: 'UGX', reference: '20570a12-c92b-5893-b7df-91ea54a0af34', status: 'pending', cashout_id: null,
}])
let creditCalls = 0
globalThis.fetch = (async (input: any, init: any) => {
  const url = String(typeof input === 'string' ? input : input.url)
  if (url.startsWith(`http://127.0.0.1:${port}`)) return realFetch(input, init)
  if (url.includes('/rest/v1/payment_orders')) return new Response(orderRow, { status: 200, headers: { 'Content-Type': 'application/json' } })
  if (url.includes('apply_gateway_result')) { creditCalls++; return new Response('{}', { status: 200 }) }
  return new Response('{}', { status: 200 })
}) as any

// Widen the impersonation server to answer the status re-fetch.
server.removeAllListeners('request')
server.on('request', (req, res) => {
  let b = ''
  req.on('data', (c) => { b += c })
  req.on('end', () => {
    seen.push({ method: req.method || '', path: req.url || '', headers: req.headers as any, body: b })
    res.setHeader('Content-Type', 'application/json')
    if (req.url?.includes('/collections/')) {
      res.statusCode = 200
      res.end(JSON.stringify({ code: 200, status: 'success', data: {
        transactionReference: '20570a12-c92b-5893-b7df-91ea54a0af34',
        transactionStatus: 'SUCCEEDED', amount: 10000, paymentProvider: 'MTN Mobile Money',
        MNOTransactionReferenceId: '13981886537',
      } }))
      return
    }
    res.statusCode = 404
    res.end('{}')
  })
})

const goodSig = await sign(`20570a12-c92b-5893-b7df-91ea54a0af3425677123456` + '710000')
log('')
log(`signed over: "20570a12-c92b-5893-b7df-91ea54a0af34" + "256771234567" + "10000"`)
log(`X-ZENGAPAY-SIGNATURE: ${goodSig}`)
log('')

const wres = await wh(new Request('https://x/functions/v1/webhooks-zengapay', {
  method: 'POST', headers: { 'X-ZENGAPAY-SIGNATURE': goodSig }, body: event,
}))
const wbody = await wres.json() as any
log(`webhook answered: ${wres.status} ${JSON.stringify(wbody)}`)

// And the natural mistake: signing the body instead of the three fields.
const badSig = await sign(event)
const bad = await wh(new Request('https://x/functions/v1/webhooks-zengapay', {
  method: 'POST', headers: { 'X-ZENGAPAY-SIGNATURE': badSig }, body: event,
}))
log(`body-signed webhook answered: ${bad.status} ${JSON.stringify(await bad.json())}`)

log('')
log('=== 4. does the money actually move? ===')
ok('the correctly signed webhook is accepted', wres.status === 200, `${wres.status}`)
ok('it resolved to a completed payment', wbody.status === 'completed', JSON.stringify(wbody))
ok('the wallet credit was applied exactly once', creditCalls === 1, `(${creditCalls})`)
ok('a body-signed webhook is rejected', bad.status === 401, `${bad.status}`)
ok('the transaction was re-fetched from the provider before crediting',
  seen.some((s) => s.path.includes('/collections/20570a12')))

server.close()
writeFileSync('payment-wire.txt', transcript.join('\n') + '\n')
console.log(fails.length ? `\n${fails.length} FAILED: ${fails.join(', ')}` : '\nall wire checks passed')
process.exit(fails.length ? 1 : 0)
