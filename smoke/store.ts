import storeWebhook from '../api/webhooks/dgateway-store'

const fails: string[] = []
const ok = (n: string, c: boolean, e = '') => { if (!c) fails.push(n); console.log(`${c ? 'ok  ' : 'FAIL'} ${n} ${e}`) }

process.env.SUPABASE_URL = 'https://fake.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc'
process.env.DGATEWAY_API_KEY = 'dgw_test_fake'
process.env.DGATEWAY_WEBHOOK_SECRET = 'whsec_test'
process.env.DGATEWAY_STORE_SLUG = 'floatbet'

const jsonRes = (b: any, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })
const enc = new TextEncoder()
async function sign(body: string, secret = 'whsec_test') {
  const k = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(body)))]
    .map((b) => b.toString(16).padStart(2, '0')).join('')
}

type Verified = { reference?: string; status: string; amount: number; currency?: string; items?: any[]; customer?: any; product?: any; metadata?: any }

async function run(opts: {
  body: any
  verified?: Verified
  signature?: string | null
  rpcResult?: any
  rpcThrows?: boolean
}) {
  const rpcCalls: { fn: string; body: any }[] = []
  let verifyHits = 0
  const real = globalThis.fetch
  globalThis.fetch = (async (url: any, init: any) => {
    const u = String(url)
    if (u.includes('/v1/transactions/')) {
      verifyHits++
      // DGateway answers 200 with the *actual* transaction; the client notices
      // the reference differs and raises INVALID_RESPONSE. Mirror that, so this
      // test exercises our 409 path rather than a mock's HTTP error.
      if (!opts.verified) return jsonRes({ error: 'nope' }, 500)
      return jsonRes({ data: opts.verified })
    }
    if (u.includes('/rest/v1/rpc/')) {
      rpcCalls.push({ fn: u.split('/rpc/')[1], body: JSON.parse(init.body) })
      if (opts.rpcThrows) return jsonRes({ message: 'boom' }, 500)
      if (opts.rpcResult) return jsonRes(opts.rpcResult)
      // Mirror the SQL: only a completed payment can be credited.
      const args = JSON.parse(init.body)
      return jsonRes({ credited: args.p_status === 'completed' })
    }
    return jsonRes({}, 404)
  }) as any

  const raw = JSON.stringify(opts.body)
  const sig = opts.signature === undefined ? await sign(raw) : opts.signature
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (sig) headers['X-DGateway-Signature'] = sig

  const res = await storeWebhook(new Request('http://x/api/webhooks/dgateway-store', { method: 'POST', headers, body: raw }))
  globalThis.fetch = real
  return { status: res.status, body: await res.json().catch(() => null), rpcCalls, verifyHits }
}

const cart = {
  reference: 'DG-STORE-1',
  store_slug: 'floatbet',
  items: [{ product_id: '77', product_slug: 'floatbet-10000', quantity: 1 }],
  customer: { email: 'Player@Example.com', name: 'King' },
  metadata: { store_slug: 'floatbet' },
}

const main = async () => {
  // ---- signature
  let r = await run({ body: cart, verified: { reference: 'DG-STORE-1', status: 'completed', amount: 10000, currency: 'UGX' }, signature: null })
  ok('unsigned webhook is rejected', r.status === 401, `got ${r.status}`)
  ok('unsigned webhook makes no upstream call', r.verifyHits === 0 && r.rpcCalls.length === 0)

  r = await run({ body: cart, verified: { reference: 'DG-STORE-1', status: 'completed', amount: 10000 }, signature: await sign(JSON.stringify(cart), 'wrong') })
  ok('bad signature is rejected', r.status === 401)

  // ---- happy path
  r = await run({ body: cart, verified: { reference: 'DG-STORE-1', status: 'completed', amount: 10000, currency: 'UGX' }, rpcResult: { credited: true, px: 100000 } })
  ok('valid store payment credits', r.status === 200 && r.body?.credited === true, JSON.stringify(r.body))
  const applied = r.rpcCalls[0]
  ok('calls apply_store_topup', applied?.fn === 'apply_store_topup')
  ok('passes the verified reference', applied?.body.p_reference === 'DG-STORE-1')
  ok('lowercases the buyer email', applied?.body.p_buyer_email === 'player@example.com')
  ok('passes product + quantity', applied?.body.p_product_id === '77' && applied?.body.p_quantity === 1)
  ok('uses verified amount, not the body', applied?.body.p_amount === 10000)
  ok('never echoes the buyer email back', !JSON.stringify(r.body).includes('player@example.com'))

  // ---- verification is authoritative, not the notification body
  r = await run({
    body: { ...cart, amount: 1 },
    verified: { reference: 'DG-STORE-1', status: 'completed', amount: 50000, currency: 'UGX' },
  })
  ok('trusts the verified amount over the webhook body', r.rpcCalls[0]?.body.p_amount === 50000)

  // ---- failed / pending never credit.
  // Credits only when the RPC says it received status 'completed'.
  r = await run({ body: cart, verified: { reference: 'DG-STORE-1', status: 'failed', amount: 10000, currency: 'UGX' } })
  ok('failed payment is recorded as failed', r.rpcCalls[0]?.body.p_status === 'failed', String(r.rpcCalls[0]?.body.p_status))
  ok('failed payment never credits', r.body?.credited === false)
  r = await run({ body: cart, verified: { reference: 'DG-STORE-1', status: 'pending', amount: 10000, currency: 'UGX' } })
  ok('pending payment does not credit', r.body?.credited === false && r.rpcCalls[0]?.body.p_status === 'pending')

  // ---- the reference we act on comes from DGateway's own look-up, never the body
  r = await run({ body: { ...cart, reference: 'DG-FORGED' }, verified: { reference: 'DG-STORE-1', status: 'completed', amount: 10000, currency: 'UGX' } })
  ok("ignores a reference in the body that verification contradicts", !r.body?.credited && r.status === 409, "got " + r.status + " " + JSON.stringify(r.body))
  ok('contradicted reference makes no RPC call', r.rpcCalls.length === 0)

  // ---- mixed carts are ambiguous, so they are blocked
  r = await run({
    body: { ...cart, items: [
      { product_id: '77', product_slug: 'floatbet-10000', quantity: 1 },
      { product_id: '88', product_slug: 'floatbet-25000', quantity: 1 },
    ] },
    verified: { reference: 'DG-STORE-1', status: 'completed', amount: 35000, currency: 'UGX' },
  })
  ok('mixed cart is blocked outright', r.status === 409, `got ${r.status}`)
  ok('mixed cart makes no RPC call', r.rpcCalls.length === 0)

  // ---- different store
  r = await run({
    body: { ...cart, store_slug: 'tanktickets' },
    verified: { reference: 'DG-STORE-1', status: 'completed', amount: 10000, currency: 'UGX', metadata: { store_slug: 'tanktickets' } },
  })
  ok('payment for another store is rejected', r.status === 409, `got ${r.status}`)

  // ---- a look-up failure must never credit, and must ask for a retry
  r = await run({ body: cart, verified: undefined })
  ok('verification failure returns 502 for retry', r.status === 502, `got ${r.status}`)
  ok('verification failure never credits', r.rpcCalls.length === 0)

  // ---- a database failure must ask for a retry, not silently drop money
  r = await run({ body: cart, verified: { reference: 'DG-STORE-1', status: 'completed', amount: 10000, currency: 'UGX' }, rpcThrows: true })
  ok('database failure returns 503 for retry', r.status === 503, `got ${r.status}`)

  // ---- parked when the email does not match an account
  r = await run({ body: cart, verified: { reference: 'DG-STORE-1', status: 'completed', amount: 10000, currency: 'UGX' }, rpcResult: { credited: false, parked_reason: 'email_not_registered' } })
  ok('unmatched email is parked, not credited', r.body?.credited === false && r.body?.parked_reason === 'email_not_registered')

  // ---- method guard
  const real = globalThis.fetch
  const get = await storeWebhook(new Request('http://x/api/webhooks/dgateway-store', { method: 'GET' }))
  ok('GET is rejected', get.status === 405)
  globalThis.fetch = real

  if (fails.length) { console.log(`\n${fails.length} FAILED: ${fails.join(', ')}`); process.exit(1) }
  console.log('\nall store-webhook checks passed')
}
void main()

// diagnostic for the contradicted-reference case
export async function diag() {
  const r = await run({
    body: { ...cart, reference: 'DG-FORGED' },
    verified: { reference: 'DG-STORE-1', status: 'completed', amount: 10000, currency: 'UGX' },
  })
  console.log('DIAG', r.status, JSON.stringify(r.body), 'verifyHits', r.verifyHits)
}
