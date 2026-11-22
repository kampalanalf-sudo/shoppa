import { op } from './payop'

const claim = (req: Request) => op('claim', req)

const fails: string[] = []
const ok = (n: string, c: boolean, e = '') => { if (!c) fails.push(n); console.log(`${c ? 'ok  ' : 'FAIL'} ${n} ${e}`) }

process.env.SUPABASE_URL = 'https://fake.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc'

const jsonRes = (b: any, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })

async function run(opts: { method?: string; auth?: boolean; body?: any; rpcThrows?: string; rpcResult?: any }) {
  const rpcCalls: any[] = []
  const real = globalThis.fetch
  globalThis.fetch = (async (url: any, init: any) => {
    const u = String(url)
    if (u.includes('/auth/v1/user')) {
      return opts.auth === false ? jsonRes({ message: 'bad token' }, 401) : jsonRes({ id: 'u1' })
    }
    if (u.includes('/rest/v1/rpc/')) {
      rpcCalls.push(JSON.parse(init.body))
      if (opts.rpcThrows) return jsonRes({ message: opts.rpcThrows }, 400)
      return jsonRes(opts.rpcResult ?? { credited: true, px: 100000, balance: 105000 })
    }
    return jsonRes({}, 404)
  }) as any
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (opts.auth !== false) headers.Authorization = 'Bearer tok'
  else delete headers.Authorization
  const res = await claim(new Request('http://x/api/topup/claim', {
    method: opts.method ?? 'POST', headers, body: opts.method === 'GET' ? undefined : JSON.stringify(opts.body ?? {}),
  }))
  globalThis.fetch = real
  return { status: res.status, body: await res.json().catch(() => null), rpcCalls }
}

const main = async () => {
  ok('rejects GET', (await run({ method: 'GET' })).status === 405)
  ok('requires a signed-in user', (await run({ auth: false, body: { reference: 'DG-1' } })).status === 401)
  ok('rejects a missing reference', (await run({ body: {} })).status === 400)
  ok('rejects a blank reference', (await run({ body: { reference: '   ' } })).status === 400)
  ok('rejects an absurdly long reference', (await run({ body: { reference: 'x'.repeat(500) } })).status === 400)

  const good = await run({ body: { reference: 'DG-STORE-9' }, rpcResult: { credited: true, px: 100000, balance: 205000 } })
  ok('claims a parked top-up', good.status === 200 && good.body?.credited === true)
  ok('passes the reference to the RPC', good.rpcCalls[0]?.p_reference === 'DG-STORE-9')
  ok('never accepts a caller-supplied user id', !('p_user_id' in (good.rpcCalls[0] ?? {})))
  ok('returns the new balance', good.body?.balance === 205000)

  const replay = await run({ body: { reference: 'DG-STORE-9' }, rpcResult: { credited: true, replay: true } })
  ok('a replay is reported as a replay', replay.body?.replay === true)

  ok('already-claimed returns 409', (await run({ body: { reference: 'DG-1' }, rpcThrows: 'this top-up has already been claimed' })).status === 409)
  ok('failed payment returns 409', (await run({ body: { reference: 'DG-1' }, rpcThrows: 'this payment failed and cannot be claimed' })).status === 409)
  ok('still-pending returns 409', (await run({ body: { reference: 'DG-1' }, rpcThrows: 'this payment is still pending' })).status === 409)
  ok('unknown reference returns 409', (await run({ body: { reference: 'DG-X' }, rpcThrows: 'unknown reference' })).status === 409)
  ok('an unexpected error returns 502, not a false success', (await run({ body: { reference: 'DG-1' }, rpcThrows: 'connection reset' })).status === 502)

  if (fails.length) { console.log(`\n${fails.length} FAILED: ${fails.join(', ')}`); process.exit(1) }
  console.log('\nall claim checks passed')
}
void main()
