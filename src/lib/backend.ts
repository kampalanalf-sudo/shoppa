// src/lib/backend.ts
//
// Where the backend lives, in one place.
//
// These two values are the Supabase project URL and the *publishable* (anon)
// key. Neither is a secret: the anon key ships inside the browser bundle to
// every visitor by design, and every table behind it is guarded by row-level
// security. The genuinely secret keys — `service_role`, `DGATEWAY_API_KEY` — are
// read on the server only and never carry a `VITE_` prefix.
//
// Why the defaults exist: this app is deployed by two pipelines, and only one of
// them could be given the values by whoever set the project up. GitHub Pages
// built from `main` with no `VITE_*` set at all, so the bundle it published had
// no Supabase client in it — the live site ran local-only, with sign-up silently
// absent and no error on screen. Making the public defaults part of the source
// is what stops a pipeline from shipping an app whose login does not exist.
//
// The environment always wins, so pointing at another project (a rebuild, a
// staging database) needs only the two env vars and no code change.

/** Public project URL. Override with VITE_SUPABASE_URL. */
const DEFAULT_URL = 'https://dtroufrfavmjldtlprpn.supabase.co'

/** Public publishable key. Override with VITE_SUPABASE_ANON_KEY. */
const DEFAULT_ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR0cm91ZnJmYXZtamxkdGxwcnBuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTUwNDQyMTAsImV4cCI6MjExMDYyMDIxMH0.LIafhBin2Uy_tx4OWDtRu-DZ6fca3atMz9Ht-XUmf2s'

const env = import.meta.env as Record<string, string | undefined>
const pick = (v: string | undefined, fallback: string) => (v && v.trim() ? v.trim() : fallback)

export const SUPABASE_URL = pick(env.VITE_SUPABASE_URL, DEFAULT_URL)
export const SUPABASE_ANON_KEY = pick(env.VITE_SUPABASE_ANON_KEY, DEFAULT_ANON)

/**
 * Where the server routes live.
 *
 * They used to be Vercel functions at a relative `/api/*`. GitHub Pages is
 * static — it has no `/api`, and a relative path there returns the SPA's
 * index.html with a 200, so every call would fail while looking like it
 * succeeded. The routes now run as Supabase Edge Functions, so this is an
 * absolute origin.
 *
 * `/api/collect` maps to `functions/v1/pay?op=collect`; the callers still speak
 * in the old paths and `apiUrl()` translates, so the money code did not have to
 * be rewritten to move hosts. One mapping table, in one place, is easier to
 * keep honest than a dozen edited call sites.
 */
export const SUPABASE_FUNCTIONS_URL = `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1`

/** Vercel route -> Supabase Edge Function. Anything unlisted throws. */
export const ROUTES: Record<string, string> = {
  '/api/collect': 'pay?op=collect',
  '/api/disburse': 'pay?op=disburse',
  '/api/status': 'pay?op=status',
  '/api/session': 'pay?op=session',
  '/api/topup/claim': 'pay?op=claim',
  '/api/admin/health': 'admin-ops?op=health',
  '/api/admin/cashouts': 'admin-ops?op=cashouts',
  '/api/admin/audit': 'admin-ops?op=audit',
  '/api/admin/lookup': 'admin-ops?op=lookup',
  '/api/admin/players': 'admin-ops?op=players',
  '/api/admin/parked': 'admin-ops?op=parked',
  '/api/admin/actions': 'admin-ops?op=actions',
  '/api/support/agents': 'support?op=agents',
  '/api/support/thread': 'support?op=thread',
  '/api/support/calls': 'support?op=calls',
  '/api/support/start': 'support?op=start',
  '/api/support/send': 'support?op=send',
  '/api/support/close': 'support?op=close',
  '/api/feed/sports': 'feed-sports',
  '/api/feed/settle': 'feed-settle',
  '/api/feed/sync': 'feed-sync',
  '/api/play': 'play',
}

/**
 * Resolve an old `/api/...` path to its absolute Edge Function URL, carrying any
 * query string across. Throws on an unknown path rather than silently
 * requesting a page that will 200 with HTML.
 */
export function apiUrl(path: string, params?: Record<string, string>): string {
  const [bare, search] = path.split('?')
  const mapped = ROUTES[bare]
  if (!mapped) throw new Error(`No backend route for ${path}`)

  const qs = new URLSearchParams(search ?? '')
  for (const [k, v] of Object.entries(params ?? {})) qs.set(k, v)
  const tail = qs.toString()
  /*
   * The join is `?` when the route carries no query string of its own, and `&`
   * when it does.
   *
   * It used to be `&` unconditionally, which was correct for every route that
   * mapped to `pay?op=collect` and silently wrong for the two that map to a bare
   * function name: `/api/play` and `/api/feed/*`. `apiUrl('/api/play', {op:'start'})`
   * produced `…/functions/v1/play&op=start` — not a query string, part of the
   * PATH — so the function was never invoked, and every server-settled game
   * answered 404. That is why the whole arcade stopped starting.
   */
  const sep = tail ? (mapped.includes('?') ? '&' : '?') : ''
  return `${SUPABASE_FUNCTIONS_URL}/${mapped}${sep}${tail}`
}

/**
 * True when a real backend is available. It always is now, unless a build
 * deliberately blanks the values, which is the point: `configured === false`
 * used to be an invisible failure mode rather than a choice.
 */
export const BACKEND_AVAILABLE = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY)
