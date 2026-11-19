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
 * True when a real backend is available. It always is now, unless a build
 * deliberately blanks the values, which is the point: `configured === false`
 * used to be an invisible failure mode rather than a choice.
 */
export const BACKEND_AVAILABLE = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY)
