// src/lib/api.ts
//
// One place that calls the server routes, so session trouble is handled the same
// way everywhere.
//
// WHY THIS EXISTS
//
// The admin screens each carried their own `token()` that read
// `supabase.auth.getSession()` and returned the access token. `getSession()`
// reads localStorage and does NOT check expiry — an access token is valid for an
// hour, and a tab left open overnight keeps handing back the dead one. The
// request then reaches the function, which answers 401, and the page prints a
// red "Can't load players" box that looks exactly like a server failure.
//
// So: read the token, and on a 401 ask the client for a refresh (getSession()
// refreshes an expired token automatically when a refresh token is present) and
// retry once. If it is still 401, the session is genuinely gone and the caller
// gets a typed AuthExpiredError to show as "sign in again", not as a broken
// server.
//
// There is no silent retry beyond that. Retrying a 401 more than once cannot
// succeed, and retrying a POST would risk a second charge or a second credit, so
// the retry is limited to the exact case where the first request was rejected
// for authentication and therefore cannot have had an effect.
import { SUPABASE_ANON_KEY, apiUrl } from './backend'
import { supabase } from './supabase'

/** The session is gone (or never existed). Distinct from "the server failed". */
export class AuthExpiredError extends Error {
  constructor(message = 'Your session has expired. Please sign in again.') {
    super(message)
    this.name = 'AuthExpiredError'
  }
}

/** The server answered, but with an error it explained. */
export class ApiError extends Error {
  status: number
  code?: string
  constructor(message: string, status: number, code?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

type Opts = {
  method?: 'GET' | 'POST'
  body?: unknown
  params?: Record<string, string>
}

/**
 * Call one of our server routes by its old `/api/...` path.
 *
 * Throws AuthExpiredError when there is no usable session, ApiError when the
 * server explains a failure, and a plain Error only when the network itself
 * failed.
 */
export async function api<T>(path: string, opts: Opts = {}): Promise<T> {
  if (!supabase) throw new Error('Backend is not configured.')

  const url = apiUrl(path, opts.params)
  const method = opts.method ?? 'GET'

  const send = async (token: string | null) => {
    const headers: Record<string, string> = { apikey: SUPABASE_ANON_KEY }
    if (token) headers.Authorization = `Bearer ${token}`
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json'

    return fetch(url, {
      method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    })
  }

  // First attempt: whatever the client currently holds.
  const first = await supabase.auth.getSession()
  const token = first.data.session?.access_token ?? null
  if (!token) throw new AuthExpiredError()

  let res = await send(token)

  if (res.status === 401) {
    // The token was rejected. Ask the client to refresh — getSession() does that
    // when the access token has expired and a refresh token is still good — and
    // try exactly once more.
    const again = await supabase.auth.getSession()
    const fresh = again.data.session?.access_token
    if (fresh && fresh !== token) res = await send(fresh)
  }

  const body = (await res.json().catch(() => null)) as
    | (T & { error?: string; message?: string; code?: string })
    | null

  if (res.status === 401) {
    // A refresh token that is also dead means the session cannot be saved here;
    // drop it so the app shows the sign-in screen instead of a stale shell.
    await supabase.auth.signOut().catch(() => undefined)
    throw new AuthExpiredError()
  }

  if (!res.ok) {
    // The platform, not our code, answers when a function fails to start. It
    // uses `message` rather than `error`, so reading only `error` would turn the
    // one honest explanation available into a bare "Request failed (503)".
    // A BOOT_ERROR means the function never ran: no query was issued, so
    // nothing downstream -- the database included -- can be the cause.
    if (body?.code === 'BOOT_ERROR') {
      throw new ApiError(
        'The server function failed to start, so nothing was run. This is a deployment problem, not your data.',
        res.status,
        'BOOT_ERROR',
      )
    }
    throw new ApiError(
      body?.error || body?.message || `Request failed (${res.status})`,
      res.status,
      body?.code,
    )
  }

  // A 200 with an HTML body means the request hit a static host that has no such
  // route: the function is not deployed, or the path never mapped. Say that
  // rather than returning null and letting the caller render an empty table.
  if (body === null) {
    throw new ApiError(
      'The server returned something that is not JSON. The function may not be deployed yet.',
      res.status,
    )
  }

  return body as T
}

/**
 * One sentence for the operator, for any failure `api()` can throw.
 *
 * The point is that "your session expired" and "the server broke" must never
 * read the same on screen. An admin staring at a red box needs to know whether
 * to sign in again or to go and look at the server.
 */
export function describeApiError(e: unknown, fallback = 'That request failed.'): string {
  if (e instanceof AuthExpiredError) return e.message
  if (e instanceof ApiError) {
    // 401 is handled above, but a 403 means the account is real and not an admin.
    if (e.status === 403) return 'This account is not an admin.'
    if (e.status === 404) return 'The server route was not found. The function may not be deployed yet.'
    return e.message
  }
  if (e instanceof TypeError) {
    // fetch() rejects with TypeError when the request never happened at all.
    return 'Could not reach the server. Check your connection.'
  }
  return (e as Error)?.message || fallback
}
