import webhook from '../api/webhooks/dgateway'

const fails: string[] = []
const ok = (n: string, c: boolean, e = '') => { if (!c) fails.push(n); console.log(`${c ? 'ok  ' : 'FAIL'} ${n} ${e}`) }

process.env.SUPABASE_URL = 'https://fake.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc'
process.env.DGATEWAY_API_KEY = 'dgw_test_fake'
process.env.DGATEWAY_WEBHOOK_SECRET = 'whsec_test'

const jsonRes = (b: any, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })
const enc = new TextEncoder()
async function sign(body: string) {
  const k = await crypto.subtle.importKey('raw', enc.encode('whsec_test'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(body)))]
    .map((b) => b.toString(16).padStart(2, '0')).join('')
}

type Mode = 'completed' | 'failed' | 'pending' | 'mismatch'
async function run(label: string, mode: Mode, orderStatus = 'pending') {
  const rpcCalls: { fn: string; body: any }[] = []
  const patches: any[] = []
  const real = globalThis.fetch
  globalThis.fetch = (async (url: any, init: any) => {
    const u = String(url)
    if (u.includes('/rest/v1/payment_orders') && (!init || init.method !== 'PATCH')) {
      return jsonRes([{ order_id: 'ORD-1', user_id: 'u1', direction: 'collect', amount: 5000, currency: 'UGX', reference: 'DG-1', status: orderStatus, cashout_id: null }])
    }
    if (u.includes('/rest/v1/payment_orders') && init?.method === 'PATCH') { patches.push(JSON.parse(init.body)); return new Response(null, { status: 204 }) }
    if (u.includes('/v1/transactions/')) {
      const status = mode === 'mismatch' ? 'completed' : mode
      const amount = mode === 'mismatch' ? 999999 : 5000
      return jsonRes({ data: { reference: 'DG-1', status, amount, currency: 'UGX', provider_ref: 'PR-1' } })
    }
    if (u.includes('/rest/v1/rpc/')) { rpcCalls.push({ fn: u.split('/rpc/')[1], body: JSON.parse(init.body) }); return jsonRes(null) }
    return jsonRes({}, 404)
  }) as any

  const body = JSON.stringify({ reference: 'DG-1', status: mode })
  const res = await webhook(new Request('http://x/api/webhooks/dgateway', {
    method: 'POST', headers: { 'X-DGateway-Signature': `sha256=${await sign(body)}` }, body,
  }))
  const out = await res.json().catch(() => ({}))
  globalThis.fetch = real
  console.log(`  -> ${label}: ${res.status} ${JSON.stringify(out)}`)
  return { res, out, rpcCalls, patches }
}

// completed collect => fulfil exactly once
let r = await run('completed', 'completed')
ok('completed collect: 200', r.res.status === 200)
ok('completed collect: calls apply_gateway_result', r.rpcCalls.some((c) => c.fn === 'apply_gateway_result'))
ok('completed collect: passes status completed', r.rpcCalls[0]?.body.p_status === 'completed')

// already completed => idempotent, no credit
r = await run('already completed', 'completed', 'completed')
ok('idempotent: no RPC on repeat', r.rpcCalls.length === 0)
ok('idempotent: flagged idempotent', (r.out as any).idempotent === true)

// failed is final
r = await run('failed', 'failed')
ok('failed: applies failed', r.rpcCalls[0]?.body.p_status === 'failed')
ok('failed: records reason', typeof r.rpcCalls[0]?.body.p_failure_reason === 'string')

// pending => no fulfilment
r = await run('pending', 'pending')
ok('pending: no RPC', r.rpcCalls.length === 0)
ok('pending: returns pending', (r.out as any).status === 'pending')

// amount mismatch => refuse
r = await run('amount mismatch', 'mismatch')
ok('mismatch: 409 refused', r.res.status === 409)
ok('mismatch: no RPC', r.rpcCalls.length === 0)
ok('mismatch: marks order failed', r.patches.some((p) => p.status === 'failed'))

console.log(fails.length ? `\n${fails.length} FAILED: ${fails.join(', ')}` : '\nall webhook fulfilment checks passed')
process.exit(fails.length ? 1 : 0)
