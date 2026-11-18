// Shared helpers for the /api routes.
//
// These routes run on Vercel's Node runtime and are plain `Request -> Response`
// handlers, so the same code works if this is ever ported to another host.

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

export function methodNotAllowed(): Response {
  return json({ error: 'method not allowed' }, 405)
}

export function preflight(): Response {
  return new Response(null, { status: 204, headers: CORS })
}

export async function readJson<T>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T
  } catch {
    return null
  }
}

// ---------------------------------------------------------------- Supabase ---
// Minimal REST client so the server routes have no extra runtime dependency.
// The service-role key stays on the server.

export function supabaseAdminConfig() {
  const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '')
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  return { url, key, ready: Boolean(url && key) }
}

export async function restRpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { url, key, ready } = supabaseAdminConfig()
  if (!ready) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured on the server.')
  const res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(args),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${fn} failed (${res.status}): ${text.slice(0, 300)}`)
  return (text ? JSON.parse(text) : null) as T
}

export async function restSelect<T>(path: string): Promise<T[]> {
  const { url, key, ready } = supabaseAdminConfig()
  if (!ready) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured on the server.')
  const res = await fetch(`${url}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' },
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`select failed (${res.status}): ${text.slice(0, 300)}`)
  return (text ? JSON.parse(text) : []) as T[]
}

export async function restPatch(path: string, patch: Record<string, unknown>): Promise<void> {
  const { url, key, ready } = supabaseAdminConfig()
  if (!ready) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured on the server.')
  const res = await fetch(`${url}/rest/v1/${path}`, {
    method: 'PATCH',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(patch),
  })
  if (!res.ok) throw new Error(`patch failed (${res.status}): ${(await res.text()).slice(0, 300)}`)
}

/** Resolve the caller from their Supabase access token. */
export async function requireUser(req: Request): Promise<{ id: string } | null> {
  const auth = req.headers.get('Authorization') || ''
  const token = auth.replace(/^Bearer\s+/i, '').trim()
  if (!token) return null
  const { url, key, ready } = supabaseAdminConfig()
  if (!ready) return null
  const res = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: key, Authorization: `Bearer ${token}` },
  })
  if (!res.ok) return null
  const user = (await res.json().catch(() => null)) as { id?: string } | null
  return user?.id ? { id: user.id } : null
}

/** Absolute public origin, used to build callback_url. */
export function publicOrigin(req: Request): string {
  const configured = (process.env.APP_URL || '').replace(/\/$/, '')
  if (configured) return configured
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL
  if (vercel) return `https://${vercel}`
  return new URL(req.url).origin
}

export function newOrderRef(prefix: string): string {
  const rand = crypto.randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${rand}`
}
