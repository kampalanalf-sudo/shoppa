import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { SUPABASE_URL as url, SUPABASE_ANON_KEY as anon, BACKEND_AVAILABLE } from './backend'

/**
 * Browser Supabase client. Only the public publishable key is used here — every
 * privileged operation goes through a SECURITY DEFINER function or an edge
 * function, so this key can safely ship in the bundle.
 *
 * The URL and key resolve through `src/lib/backend.ts`, which carries the public
 * defaults. They used to be read straight off `import.meta.env`, which meant a
 * pipeline that forgot to set them published a bundle with no client at all and
 * no sign-in, silently. Set the two `VITE_` vars to point at another project.
 */
export const isBackendConfigured = BACKEND_AVAILABLE

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

/**
 * Subscribe to new messages in one support thread.
 *
 * RLS applies to the realtime stream, so this only ever receives rows from the
 * conversation it was given — a player cannot subscribe their way into someone
 * else's thread.
 *
 * Filtered by conversation rather than by user because a thread can be answered
 * while the player is on another screen, and the filter is also what keeps the
 * stream quiet: one thread's inserts, not every message in the system.
 */
export function onSupportMessage(
  conversationId: string,
  handler: (row: SupportMessageRow) => void,
): () => void {
  if (!supabase) return () => {}
  const channel = supabase
    .channel(`support-${conversationId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'support_messages',
        filter: `conversation_id=eq.${conversationId}`,
      },
      (payload) => handler(payload.new as SupportMessageRow),
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

export type SupportMessageRow = {
  id: number
  conversation_id: string
  author: 'player' | 'agent' | 'system'
  agent_id: string | null
  body: string
  created_at: string
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
