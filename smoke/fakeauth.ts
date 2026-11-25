// smoke/fakeauth.ts — a stand-in backend that reports a signed-IN player.
//
// This exists because the bluntest bug of this project shipped through an
// untested state. Every smoke test rendered the app signed out; a hook was
// added below the signed-out early return; React threw "Rendered more hooks
// than during the previous render" the moment a real player signed in, and the
// live site went blank. Nothing in the suite ever rendered the signed-in tree.
//
// The module is wired in by aliasing `src/lib/supabase` in vite.fakeauth.config,
// so the app code under test is completely unmodified.

const USER_ID = 'u-signed-in'

/** Auth change subscribers, so a test can drive a real sign-in transition. */
const authListeners: ((event: string, session: unknown) => void)[] = []

/** Fire a genuine SIGNED_IN, the same way Supabase does after a login. */
export function fireSignIn() {
  const session = { access_token: 'test-token', user: { id: USER_ID, email: 'player@example.com' } }
  authListeners.forEach((cb) => cb('SIGNED_IN', session))
}

export function fireSignOut() {
  authListeners.forEach((cb) => cb('SIGNED_OUT', null))
}

const SESSION = { access_token: 'test-token', user: { id: USER_ID, email: 'player@example.com' } }

// A profile good enough that the app does NOT divert to onboarding: it needs
// age_confirmed, a real username, and one that does not start with "player".
const ROWS: Record<string, unknown> = {
  profiles: {
    id: USER_ID,
    username: 'kampalanalf',
    display_name: 'Kampalanalf',
    avatar_url: null,
    phone: null,
    phone_verified: true,
    age_confirmed: true,
    suspended: false,
    is_admin: false,
  },
  wallets: {
    user_id: USER_ID,
    balance_px: 125_000,
    wagered_px: 0,
    won_px: 0,
    cashed_out_px: 0,
    gifted_out_px: 0,
    gifted_in_px: 0,
  },
}

/**
 * A chainable query builder. Supabase's API is thenable at every stage, so this
 * has to resolve whether it is awaited directly or after .maybeSingle().
 *
 * Every filter method returns `q`, so any chain the app writes resolves to the
 * table's rows. Listing the filters out one by one was a mistake: the first
 * version omitted `.gt`, and the sportsbook rendered "Couldn't load the board /
 * supabase.from(...).select(...).in(...).gt is not a function" — the app
 * reporting a broken fake rather than a broken page, which is exactly what its
 * error handling is supposed to do.
 */
const CHAIN = [
  'select', 'eq', 'neq', 'in', 'or', 'and', 'not', 'order', 'limit', 'range',
  'gte', 'gt', 'lte', 'lt', 'is', 'ilike', 'like', 'match', 'filter', 'contains',
  'containedBy', 'overlaps', 'textSearch', 'returns',
]

function builder(table: string) {
  const result = { data: ROWS[table] ?? null, error: null }
  const q: any = {}
  for (const m of CHAIN) q[m] = () => q
  q.maybeSingle = async () => result
  q.single = async () => result
  q.csv = async () => ({ data: '', error: null })
  q.insert = async () => ({ data: null, error: null })
  q.upsert = async () => ({ data: null, error: null })
  q.update = () => q
  q.delete = () => q
  q.then = (resolve: any) => resolve({ data: [], error: null })
  return q
}

const noopChannel = () => {
  const ch: any = { on: () => ch, subscribe: () => ch, unsubscribe: async () => ({}) }
  return ch
}

export const supabase: any = {
  auth: {
    getSession: async () => ({ data: { session: SESSION } }),
    getUser: async () => ({ data: { user: SESSION.user }, error: null }),
    onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
      authListeners.push(cb)
      return { data: { subscription: { unsubscribe() {} } } }
    },
    signInWithPassword: async () => ({ error: null }),
    signUp: async () => ({ error: null }),
    signInWithOAuth: async () => ({ error: null }),
    signOut: async () => ({ error: null }),
    resetPasswordForEmail: async () => ({ error: null }),
    updateUser: async () => ({ error: null }),
    setSession: async () => ({ error: null }),
    exchangeCodeForSession: async () => ({ error: null }),
    verifyOtp: async () => ({ error: null }),
    resend: async () => ({ error: null }),
  },
  from: (table: string) => builder(table),
  rpc: async () => ({ data: 15000, error: null }),
  channel: noopChannel,
  removeChannel: () => {},
  storage: {
    from: () => ({
      upload: async () => ({ data: null, error: null }),
      getPublicUrl: () => ({ data: { publicUrl: '' } }),
    }),
  },
}

export const isBackendConfigured = true
export const onChatMessage = () => () => {}
export const onSupportMessage = () => () => {}
export const onIncomingGift = () => () => {}
export type SupportMessageRow = Record<string, unknown>
export type ChatRow = Record<string, unknown>
export type GiftRow = Record<string, unknown>
