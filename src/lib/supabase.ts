import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Browser Supabase client. Only the public anon key is used here — every
 * privileged operation goes through a SECURITY DEFINER function or an edge
 * function, so this key can safely ship in the bundle.
 *
 * If the two VITE_ vars are absent the app still boots in local-only mode:
 * `isBackendConfigured` is false and the UI hides anything that needs a server.
 */
const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() ?? ''
const anon = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() ?? ''

export const isBackendConfigured = Boolean(url && anon)

export const supabase: SupabaseClient | null = isBackendConfigured
  ? createClient(url, anon, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: 'pkce',
      },
    })
  : null

/** Subscribe to chat inserts. Returns an unsubscribe function. */
export function onChatMessage(handler: (row: ChatRow) => void): () => void {
  if (!supabase) return () => {}
  const channel = supabase
    .channel('chat-room')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'chat_messages' },
      (payload) => handler(payload.new as ChatRow),
    )
    .subscribe()
  return () => {
    void supabase.removeChannel(channel)
  }
}

/** Subscribe to gifts where the signed-in user is the recipient. */
export function onIncomingGift(handler: (row: GiftRow) => void): () => void {
  if (!supabase) return () => {}
  const channel = supabase
    .channel('gifts-in')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'gifts' },
      (payload) => handler(payload.new as GiftRow),
    )
    .subscribe()
  return () => {
    void supabase.removeChannel(channel)
  }
}

export type ChatRow = {
  id: number
  user_id: string
  body: string
  created_at: string
  gift_id?: string | null
  author?: { username: string; avatar_url?: string | null } | null
}

export type GiftRow = {
  id: string
  sender_id: string
  recipient_id: string
  amount_px: number
  note: string | null
  status: 'pending' | 'accepted' | 'declined' | 'expired'
  created_at: string
}

/**
 * Call an edge function with the current session attached. Throws a readable
 * error so callers can surface it in a toast.
 */
export async function callFunction<T>(name: string, body: unknown): Promise<T> {
  if (!supabase) throw new Error('Backend is not configured.')
  const { data: sessionData } = await supabase.auth.getSession()
  const token = sessionData.session?.access_token
  if (!token) throw new Error('Please sign in again.')

  const base = url.replace(/\/$/, '')
  const res = await fetch(`${base}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      apikey: anon,
    },
    body: JSON.stringify(body),
  })

  const json = (await res.json().catch(() => null)) as (T & { error?: string }) | null
  if (!res.ok) throw new Error(json?.error || `Request failed (${res.status})`)
  return json as T
}
