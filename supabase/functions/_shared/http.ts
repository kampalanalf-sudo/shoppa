// supabase/functions/_shared/http.ts
//
// The three things every function needs and no function should redeclare:
// the CORS headers, a JSON response helper, and a trimmed env read.
//
// This module exists because they WERE redeclared. Each function carried its own
// `CORS`, `json` and `env`, and the shared gateway client carried another set.
// Flattening two copies of `const CORS` into one bundle is a duplicate
// declaration at best and a silently different header set at worst, so the
// definitions live here and the functions import them.
//
// Leaf module: no imports of its own, so the build script can inline it.

/**
 * One CORS block for every function.
 *
 * `x-dgateway-signature` is allowed everywhere even though only the webhooks
 * read it: a preflight that omits a header the browser sends makes the webhook
 * call fail with an opaque CORS error instead of a 401, and the header is not a
 * secret — the signature must still verify.
 */
export const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-dgateway-signature',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

/** A CORS-only 204, for the preflight the browser sends before a POST. */
export function preflight(): Response {
  return new Response(null, { status: 204, headers: CORS })
}

/** An env var, trimmed. Missing becomes '', never the string "undefined". */
export function readEnv(key: string): string {
  return (Deno.env.get(key) || '').trim()
}
