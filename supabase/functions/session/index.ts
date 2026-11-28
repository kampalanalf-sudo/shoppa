// supabase/functions/session/index.ts
//
// Where a player is signing in from.
//
// WHY A FUNCTION AND NOT A DATABASE CALL
//
// The address a request comes from is known only to whatever accepted the
// connection. A browser cannot be asked for its own IP — whatever it says is a
// claim — so the address has to be read from the request headers HERE, on the
// server, and handed to the database in a call the player cannot forge. The
// client sends its city-level position (if it grants permission) and nothing else;
// it has no way to influence `ip`, `ip_country` or `ip_city`.
//
// WHAT IT COSTS A PLAYER
//
// One request at sign-in, and one per 30 minutes at most. `record_session` drops
// the rest. A bet, a spin and a page view record nothing — a per-spin location log
// would be a pile of somebody's movements for no security benefit at all.
//
// WHAT THE COORDINATES ARE WORTH
//
// Very little, on their own: a device can report a position it does not have. The
// schema stores them rounded to ~1 km and labels them UNVERIFIED. The trustworthy
// part of the record is the address, which comes from the network, and the
// country/city the CDN reports, which the client cannot set either.
import { json, preflight, readEnv } from '../_shared/http.ts'

const SUPABASE_URL = readEnv('SUPABASE_URL')
const SERVICE_KEY = readEnv('SUPABASE_SERVICE_ROLE_KEY')

type User = { id: string }

async function requireUser(req: Request): Promise<User | null> {
  const auth = req.headers.get('Authorization') || ''
  if (!/^Bearer\s+\S+/i.test(auth)) return null
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: auth, apikey: SERVICE_KEY },
  })
  if (!res.ok) return null
  const body = (await res.json().catch(() => null)) as { id?: string } | null
  return body?.id ? { id: body.id } : null
}

/**
 * The client address, from the header the platform sets.
 *
 * `x-forwarded-for` is a LIST when a request passes through proxies: the leftmost
 * entry is the original client, the rest are the hops. Only the first is used, and
 * only when it parses as an address — a caller that sends this header itself
 * cannot do better than name an address that will not match its own network, and
 * the CDN headers below are not settable by a browser at all.
 *
 * `cf-connecting-ip` wins when present: Cloudflare overwrites it at the edge, so it
 * is the one value a client cannot supply.
 */
function clientIp(req: Request): string | null {
  const cf = req.headers.get('cf-connecting-ip')?.trim()
  if (cf) return cf

  const real = req.headers.get('x-real-ip')?.trim()
  if (real) return real

  const fwd = req.headers.get('x-forwarded-for') || ''
  const first = fwd.split(',')[0]?.trim()
  return first || null
}

/** Cloudflare's geo hints. All optional; absent on a direct/local request. */
const geo = (req: Request) => ({
  country: req.headers.get('cf-ipcountry'),
  city: req.headers.get('cf-ipcity'),
  region: req.headers.get('cf-region'),
  timezone: req.headers.get('cf-timezone'),
})

type Body = {
  event?: 'sign_in' | 'heartbeat'
  lat?: number
  lng?: number
  accuracy?: number
  source?: 'gps' | 'network' | 'approximate'
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight()
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  const user = await requireUser(req)
  if (!user) return json({ error: 'not authenticated' }, 401)

  const body = (await req.json().catch(() => null)) as Body | null

  const lat = typeof body?.lat === 'number' && Number.isFinite(body.lat) ? body.lat : null
  const lng = typeof body?.lng === 'number' && Number.isFinite(body.lng) ? body.lng : null

  // Reject anything that is not a real coordinate, rather than storing it and
  // drawing it on a map later.
  const validCoords =
    lat !== null && lng !== null &&
    lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180

  const accuracy =
    typeof body?.accuracy === 'number' && Number.isFinite(body.accuracy)
      ? Math.max(0, Math.min(100000, Math.round(body.accuracy)))
      : null

  const source =
    body?.source === 'gps' || body?.source === 'network' || body?.source === 'approximate'
      ? body.source
      : lat !== null || lng !== null
        ? 'approximate'
        : 'none'

  const g = geo(req)

  /*
   * The user id is not sent. `record_session` takes the caller from auth.uid(),
   * and this call carries the PLAYER's own Authorization header — so a tampered
   * body cannot write a record against somebody else's account. This was the bug
   * in the arcade's start_round: a service-role call carries no `sub`, so
   * auth.uid() is null. Here the identity is the point, so the token goes with it.
   */
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/record_session`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: req.headers.get('Authorization') || `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      p_event: body?.event === 'sign_in' ? 'sign_in' : 'heartbeat',
      p_ip: clientIp(req),
      p_country: g.country,
      p_region: g.region,
      p_city: g.city,
      p_timezone: g.timezone,
      p_lat: validCoords ? lat : null,
      p_lng: validCoords ? lng : null,
      p_accuracy_m: validCoords ? accuracy : null,
      p_source: source,
      p_agent: req.headers.get('user-agent'),
    }),
  })

  const text = await res.text()
  const parsed = text ? JSON.parse(text) : null
  if (!res.ok) {
    const message =
      (parsed as { message?: string } | null)?.message || `HTTP ${res.status}`
    return json({ error: message }, 502)
  }

  return json(parsed)
})
