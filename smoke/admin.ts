import parked from '../api/admin/parked'
import lookup from '../api/admin/lookup'

const fails: string[] = []
const ok = (n: string, c: boolean, e = '') => { if (!c) fails.push(n); console.log(`${c ? 'ok  ' : 'FAIL'} ${n} ${e}`) }

process.env.SUPABASE_URL = 'https://fake.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc'

const jsonRes = (b: any, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })

type Opts = {
  method?: string
  auth?: boolean
  isAdmin?: boolean
  body?: any
  rpcThrows?: string
  rows?: any[]
  rpcResult?: any
  url?: string
}

async function run(opts: Opts, which: 'parked' | 'lookup' = 'parked') {
  const calls: { url: string; body?: any }[] = []
  const real = globalThis.fetch
  globalThis.fetch = (async (url: any, init: any) => {
    const u = String(url)
    if (u.includes('/auth/v1/user')) {
      return opts.auth === false ? jsonRes({ message: 'no' }, 401) : jsonRes({ id: 'admin-1' })
    }
    if (u.includes('/rest/v1/profiles?')) {
      return jsonRes(opts.isAdmin === false ? [{ id: 'admin-1', username: 'king', is_admin: false }]
                                            : [{ id: 'admin-1', username: 'king', is_admin: true }])
    }
    if (u.includes('/rest/v1/profiles?')) return jsonRes([])
    if (u.includes('/rest/v1/store_topups?')) { calls.push({ url: u }); return jsonRes(opts.rows ?? []) }
    if (u.includes('/rest/v1/rpc/')) {
      calls.push({ url: u, body: JSON.parse(init.body) })
      if (opts.rpcThrows) return jsonRes({ message: opts.rpcThrows }, 400)
      return jsonRes(opts.rpcResult ?? { ok: true, px: 100000, balance: 105000 })
    }
    if (u.includes('/rest/v1/profiles?or=')) { calls.push({ url: u }); return jsonRes([]) }
    return jsonRes({}, 404)
  }) as any

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (opts.auth !== false) headers.Authorization = 'Bearer tok'
  const target = which === 'parked' ? parked : lookup
  const res = await target(new Request(opts.url ?? 'http://x/api/admin/parked', {
    method: opts.method ?? (which === 'lookup' ? 'GET' : 'GET'),
    headers,
    body: opts.method === 'POST' ? JSON.stringify(opts.body ?? {}) : undefined,
  }))
  globalThis.fetch = real
  return { status: res.status, body: await res.json().catch(() => null), calls }
}

const main = async () => {
  // ---- the gate, three layers
  ok('anonymous is rejected 401', (await run({ auth: false })).status === 401)
  ok('signed-in non-admin is rejected 403', (await run({ isAdmin: false })).status === 403)
  ok('non-admin cannot list the queue', (await run({ isAdmin: false, rows: [{ reference: 'DG-1' }] })).body?.rows === undefined)
  ok('admin can list the queue', (await run({ rows: [{ reference: 'DG-1', status: 'pending' }] })).status === 200)

  // ---- a non-admin cannot release, even with a valid-looking body
  const blocked = await run({ isAdmin: false, method: 'POST', body: { reference: 'DG-1', action: 'release', userId: 'u1' } })
  ok('non-admin release is blocked', blocked.status === 403)
  ok('blocked release makes no RPC call', blocked.calls.length === 0)

  // ---- release path
  const rel = await run({ method: 'POST', body: { reference: 'DG-1', action: 'release', userId: 'user-9' }, rpcResult: { ok: true, px: 100000, balance: 205000 } })
  ok('admin release succeeds', rel.status === 200 && rel.body?.credited === true)
  ok('release names the admin', rel.calls[0]?.body.p_admin_id === 'admin-1')
  ok('release names the credited user', rel.calls[0]?.body.p_user_id === 'user-9')
  ok('release uses the attributed RPC', String(rel.calls[0]?.url).includes('admin_release_store_topup'))
  ok('release reports the new balance', rel.body?.balance === 205000)

  // ---- validation
  ok('release without userId is 400', (await run({ method: 'POST', body: { reference: 'DG-1', action: 'release' } })).status === 400)
  ok('release without reference is 400', (await run({ method: 'POST', body: { action: 'release', userId: 'u1' } })).status === 400)
  ok('unknown action is 400', (await run({ method: 'POST', body: { reference: 'DG-1', action: 'credit' } })).status === 400)

  // ---- dismiss
  const dis = await run({ method: 'POST', body: { reference: 'DG-1', action: 'dismiss' } })
  ok('dismiss succeeds', dis.status === 200 && dis.body?.action === 'dismiss')
  ok('dismiss is attributed', dis.calls[0]?.body.p_admin_id === 'admin-1')
  ok('dismiss touches no wallet', !String(dis.calls[0]?.url).includes('admin_release'))

  // ---- conflicting states are surfaced, not swallowed
  ok('already-credited release is 409', (await run({ method: 'POST', body: { reference: 'DG-1', action: 'release', userId: 'u1' }, rpcThrows: 'this top-up has already been credited' })).status === 409)
  ok('releasing a pending payment is 409', (await run({ method: 'POST', body: { reference: 'DG-1', action: 'release', userId: 'u1' }, rpcThrows: 'this payment is still pending at the gateway' })).status === 409)
  ok('unexpected error is 502, never a false success', (await run({ method: 'POST', body: { reference: 'DG-1', action: 'release', userId: 'u1' }, rpcThrows: 'connection reset' })).status === 502)

  // ---- lookup
  ok('lookup requires admin', (await run({ isAdmin: false }, 'lookup')).status === 403)
  ok('lookup needs 3+ characters', (await run({ url: 'http://x/api/admin/lookup?q=ab' }, 'lookup')).body?.rows?.length === 0)
  const inj = await run({ url: 'http://x/api/admin/lookup?q=' + encodeURIComponent('%_*(,)abc') }, 'lookup')
  ok('lookup strips PostgREST wildcards', !inj.calls.some((c) => /ilike\.\*%/.test(c.url)))

  // ---- an admin cannot POST to lookup
  ok('lookup rejects POST', (await run({ method: 'POST' }, 'lookup')).status === 405)

  if (fails.length) { console.log(`\n${fails.length} FAILED: ${fails.join(', ')}`); process.exit(1) }
  console.log('\nall admin checks passed')
}
void main()
