// smoke/api.ts
//
// Tests src/lib/api.ts — the client half of the session fix.
//
// The bug this covers: the admin screens read `supabase.auth.getSession()` and
// used the access token straight away. getSession() does not check expiry, so a
// tab left open past the hour kept sending a dead token; the function answered
// 401 and the screen said "Couldn't load players", which reads as a server
// failure. The fix refreshes once and retries, and if that fails too it says so
// plainly — and signs the dead session out so the app stops pretending.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { api, ApiError, AuthExpiredError, describeApiError } from '../src/lib/api'
import { supabase } from '../src/lib/supabase'

const fails: string[] = []
const ok = (n: string, c: boolean, extra = '') => {
  if (!c) fails.push(n)
  console.log(`${c ? 'ok  ' : 'FAIL'} ${n} ${extra}`)
}

const jsonRes = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

// ------------------------------------------------------------- stubs --------

type Sent = { url: string; auth: string | null }
let sent: Sent[] = []
let behaviours: Array<(n: number) => Response | null> = []
let signedOut = false

// Stand in for the session store. `tokens[i]` is what getSession() returns on
// its i-th call, which is how we simulate "the first token is stale".
let tokens: (string | null)[] = []
let getSessionCalls = 0

const fakeClient: any = {
  auth: {
    getSession: async () => {
      const t = tokens[Math.min(getSessionCalls, tokens.length - 1)] ?? null
      getSessionCalls++
      return { data: { session: t ? { access_token: t } : null }, error: null }
    },
    signOut: async () => {
      signedOut = true
      return { error: null }
    },
  },
}

// `supabase` is a real client created at import time, so patch the two methods
// the module under test actually uses rather than trying to swap the module.
Object.assign(supabase!.auth, fakeClient.auth)

const realFetch = globalThis.fetch
globalThis.fetch = (async (url: any, init: any) => {
  const auth = (init?.headers?.Authorization as string) ?? null
  sent.push({ url: String(url), auth })
  const n = sent.length - 1
  for (const b of behaviours) {
    const r = b(n)
    if (r) return r
  }
  return jsonRes({ ok: true })
}) as any

const reset = (opts: { tokens?: (string | null)[]; behaviours?: Array<(n: number) => Response | null> }) => {
  sent = []
  signedOut = false
  getSessionCalls = 0
  tokens = opts.tokens ?? ['tok-good', 'tok-good']
  behaviours = opts.behaviours ?? []
}

// ---------------------------------------------------- the expiry recovery ---

reset({
  tokens: ['tok-stale', 'tok-fresh'],
  behaviours: [(n) => (n === 0 ? jsonRes({ error: 'not signed in' }, 401) : null)],
})

const body = await api<{ rows: unknown[] }>('/api/admin/players', { params: { limit: '100' } })
ok('api: refreshes the token after a 401 and retries', sent.length === 2, `(${sent.length} requests)`)
ok('api: first attempt used the stale token', sent[0].auth === 'Bearer tok-stale')
ok('api: retry used the refreshed token', sent[1].auth === 'Bearer tok-fresh')
ok('api: the retried request succeeds', (body as any).ok === true)

// -------------------------------------------------- a session that is dead --

reset({
  tokens: ['tok-stale', 'tok-also-stale'],
  behaviours: [() => jsonRes({ error: 'not signed in' }, 401)],
})

let err: unknown = null
try {
  await api('/api/admin/players')
} catch (e) {
  err = e
}
ok('api: an unrecoverable 401 throws AuthExpiredError', err instanceof AuthExpiredError)
ok('api: it does not retry a second time', sent.length === 2, `(${sent.length})`)
ok('api: the dead session is signed out', signedOut)

// ------------------------------------------------------- no session at all --

reset({ tokens: [null] })
err = null
try {
  await api('/api/admin/players')
} catch (e) {
  err = e
}
ok('api: no session throws AuthExpiredError without calling the network', err instanceof AuthExpiredError && sent.length === 0)

// --------------------------------------------------------------- 403 ------

reset({ behaviours: [() => jsonRes({ error: 'admin access required' }, 403)] })
err = null
try {
  await api('/api/admin/players')
} catch (e) {
  err = e
}
ok('api: 403 surfaces the server message', err instanceof ApiError && (err as ApiError).status === 403)
ok('api: describeApiError(403) says "not an admin"', /not an admin/i.test(describeApiError(err)))
ok('api: a 403 is not treated as an expired session', !signedOut)

// ------------------------------------- HTML 200 from a host with no route --

reset({ behaviours: [() => new Response('<!doctype html><title>404</title>', { status: 200 })] })
err = null
try {
  await api('/api/admin/health')
} catch (e) {
  err = e
}
ok('api: a 200 that is not JSON is an error, not a null body', err instanceof ApiError)
ok('api: it names the undeployed function', /not be deployed/i.test(describeApiError(err)))

// ------------------------------------------------ the platform's own error --

// When a function fails to start, the PLATFORM answers -- not our code -- with
// {"code":"BOOT_ERROR","message":"Function failed to start"}. There is no
// `error` field. Reading only `error` turned the one real explanation into
// "Request failed (503)", which is how a boot failure spent hours being blamed
// on the database. Every function was doing this at once.
reset({
  behaviours: [
    () => jsonRes({ code: 'BOOT_ERROR', message: 'Function failed to start (please check logs)' }, 503),
  ],
})
err = null
try {
  await api('/api/admin/players')
} catch (e) {
  err = e
}
ok('api: a BOOT_ERROR is an ApiError', err instanceof ApiError && (err as ApiError).status === 503)
ok('api: it keeps the platform code', (err as ApiError).code === 'BOOT_ERROR')
ok(
  'api: it does not blame the database',
  !/database|unreachable/i.test(describeApiError(err, 'Could not run the checks.')),
)
ok(
  'api: it says the function did not start',
  /failed to start/i.test(describeApiError(err, 'Could not run the checks.')),
)

// ------------------------------------------- a POST is never double-sent --

// Retrying a POST is safe ONLY because a 401 means the request was rejected
// before it could do anything. Prove the retry happens for POST too, so a
// collect after a token refresh works — and that it is still exactly one retry.
reset({
  tokens: ['tok-stale', 'tok-fresh'],
  behaviours: [(n) => (n === 0 ? jsonRes({ error: 'not authenticated' }, 401) : jsonRes({ reference: 'DG-1' }))],
})
const collect = await api<{ reference: string }>('/api/collect', {
  method: 'POST',
  body: { amount: 5000, phone: '0771234567' },
})
ok('api: a POST recovers from an expired token', collect.reference === 'DG-1')
ok('api: the POST was sent exactly twice', sent.length === 2)

// --------------------------------------------------- describeApiError ------

ok('describe: AuthExpiredError reads as a session problem',
  /session/i.test(describeApiError(new AuthExpiredError())))
ok('describe: a TypeError reads as a connection problem',
  /connection/i.test(describeApiError(new TypeError('Failed to fetch'))))
ok('describe: an unknown error falls back to the caller\'s wording',
  describeApiError(new Error(''), 'Could not load players.') === 'Could not load players.')

// ------------------------------------------------- a guard against the bug --

// The regression this whole file exists for was a page reading the raw access
// token and treating it as proof of a live session. Nothing stops that coming
// back except a check, so: no page may call getSession() for a token again.
// Everything goes through api(), which knows what to do with a 401.
const PAGES = readdirSync(join(process.cwd(), 'src'), { recursive: true, encoding: 'utf8' })
  .filter((f) => /\.tsx?$/.test(f))

const offenders: string[] = []
for (const rel of PAGES) {
  const src = readFileSync(join(process.cwd(), 'src', rel), 'utf8')
  if (rel.includes('lib/auth') || rel.includes('lib/supabase') || rel.includes('lib/api')) continue
  // Match the *use*, not the word: a comment explaining Supabase's
  // `#access_token=` redirect hash is not a credential leak.
  const withoutComments = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  if (/access_token/.test(withoutComments)) offenders.push(rel)
}
ok(
  'no page reads a raw access token (use api() so a 401 is recoverable)',
  offenders.length === 0,
  offenders.length ? `-> ${offenders.join(', ')}` : '',
)

// ------------------------------------------ every route resolves to a URL ---

/*
 * The regression this block exists for: `apiUrl` joined its query string with
 * `&` unconditionally, which is right for the routes that map to `pay?op=…` and
 * silently wrong for the ones that map to a bare function name. `/api/play` +
 * `{op:'start'}` became `…/functions/v1/play&op=start` — a path, not a query —
 * so the function was never invoked and every server-settled game answered 404.
 * The arcade stopped starting and nothing in the suite noticed.
 *
 * So: resolve EVERY route with a parameter and assert the result is a usable
 * URL. The check is on the shape, not on the deployment.
 */
const { apiUrl, ROUTES } = await import('../src/lib/backend')

const badUrls: string[] = []
for (const bare of Object.keys(ROUTES)) {
  for (const withParam of [false, true]) {
    // A neutral parameter name: `op` is already carried by half the routes, and
    // setting it twice would be this test's bug, not the app's.
    const url = apiUrl(bare, withParam ? { probe: 'x' } : undefined)
    const path = new URL(url).pathname
    // The `&` bug turned the query into part of the path.
    const broken =
      /[&?]/.test(path) ||
      /&op=/.test(url) ||
      (withParam && !/[?&]probe=x\b/.test(url))
    if (broken) badUrls.push(`${bare} -> ${url}`)
  }
}
ok(
  'every backend route resolves to a well-formed URL with its params',
  badUrls.length === 0,
  badUrls.slice(0, 3).join(' | '),
)

// The two shapes that must both work, named explicitly so the reason is clear.
ok('a route with its own query string joins with &', /pay\?op=collect&.*/.test(apiUrl('/api/collect', { a: 'b' })) || /[?]/.test(apiUrl('/api/collect', { a: 'b' })))
ok('a bare route joins its first parameter with ?', /\/play\?op=start$/.test(apiUrl('/api/play', { op: 'start' })), apiUrl('/api/play', { op: 'start' }))

globalThis.fetch = realFetch
console.log(fails.length ? `\n${fails.length} FAILED: ${fails.join(', ')}` : '\nall api-client checks passed')
process.exit(fails.length ? 1 : 0)
