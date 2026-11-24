import React, { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { onSupportMessage } from '../lib/supabase'
import { IconChat, IconClose } from './Icons'

/**
 * The door to support, on every screen.
 *
 * WHY A FLOATING BUTTON AND NOT A PAGE
 *
 * A player with a broken session or a payment that did not arrive is not going
 * to hunt through a menu. Support that requires knowing a URL is support that is
 * not there. So there is one persistent control, and it carries an unread badge
 * when an agent has answered — that badge is what makes a reply discoverable
 * when the player is mid-game rather than staring at the chat.
 *
 * The badge is driven by the same realtime stream the chat itself uses, so it
 * costs one subscription rather than a poll.
 *
 * WHERE IT SITS, AND WHY THAT IS THE WHOLE PROBLEM
 *
 * The bottom-right corner is the most contested space in this app. On a phone
 * the bottom bar is always there, and a game puts its own action bar below the
 * reels. A button placed without accounting for that is not "floating", it is
 * overlapping. The layout is budgeted from the bottom edge up:
 *
 *   0-56      BottomBar (md:hidden), or the game action bar at 57-105
 *   128-176   Help        (this button, bottom-32 = 128px)
 *   80-128    mobile PX wallet button (App.tsx, bottom-20)
 *   16-64     ChatDock, xl and up only
 *
 * The Help button used to sit at bottom-[76px]. The PX button sits at bottom-20,
 * which is 80px with a height of 48 — so the two overlapped by 44 of 48 pixels
 * and Help won, being later in the DOM and on top. The wallet shortcut was
 * unreachable on a phone. Raising Help above the wallet keeps both.
 *
 * Deliberately hidden from the admin console: an admin has the handoff queue,
 * and a support bubble over a screen full of player data invites a mis-tap.
 */
export function SupportBubble({
  onOpen,
  hidden,
}: {
  onOpen: () => void
  hidden?: boolean
}) {
  const { user } = useAuth()
  const [unread, setUnread] = useState(0)
  const [conversationId, setConversationId] = useState<string | null>(null)

  // Find the live thread once. If there is one, watch it for replies.
  useEffect(() => {
    if (!user) return
    let alive = true
    void api<{ conversation: { id: string } | null }>('/api/support/start', {
      method: 'POST',
      body: { resume: true },
    })
      .then((b) => {
        if (alive && b.conversation) setConversationId(b.conversation.id)
      })
      // No thread, no badge. An error here must not put a red dot on the screen.
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [user])

  useEffect(() => {
    if (!conversationId) return
    return onSupportMessage(conversationId, (row) => {
      // A player's own message is not unread; an agent's or a system note is.
      if (row.author !== 'player') setUnread((n) => n + 1)
    })
  }, [conversationId])

  // Signed out, the button still renders: the person locked out of their account
  // is exactly who needs to reach support, and the Support page explains what to
  // do. Only the unread badge needs a signed-in player, and that is skipped.
  if (hidden) return null

  return (
    // bottom-32 on a phone clears both the game action bar (57-105px) and the
    // PX wallet button (80-128px). From sm up there is no bottom bar, so the
    // corner is free and the button drops to bottom-6.
    <button
      type="button"
      onClick={() => {
        setUnread(0)
        onOpen()
      }}
      aria-label={unread ? `Open support, ${unread} new` : 'Open support'}
      className="fixed bottom-32 right-4 z-30 flex h-12 items-center gap-2 rounded-full border border-white/10 bg-ink-850/95 px-4 text-[12.5px] font-bold text-white shadow-pop backdrop-blur-xl transition hover:border-neon-lime/40 sm:bottom-6"
    >
      <IconChat size={17} className="text-neon-lime" />
      Help
      {unread > 0 && (
        <span className="grid h-5 min-w-5 place-items-center rounded-full bg-neon-lime px-1 text-[10px] font-black text-black">
          {unread > 9 ? '9+' : unread}
        </span>
      )}
    </button>
  )
}

/**
 * A one-off notice at the top of the screen, used when support opens itself.
 *
 * Kept separate from the toast system because this must survive a re-render and
 * be dismissible — a toast that disappears in four seconds is not a good way to
 * tell someone a human is now looking at their payment.
 */
export function SupportNotice({
  text,
  onDismiss,
}: {
  text: string
  onDismiss: () => void
}) {
  const [gone, setGone] = useState(false)
  useEffect(() => setGone(false), [text])
  if (gone) return null
  return (
    <div className="mx-auto mb-2 flex w-full max-w-[760px] items-start gap-2 rounded-xl border border-neon-lime/25 bg-neon-lime/10 px-2.5 py-2">
      <IconChat size={13} className="mt-0.5 shrink-0 text-neon-lime" />
      <p className="flex-1 text-[11px] leading-relaxed text-white">{text}</p>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => {
          setGone(true)
          onDismiss()
        }}
        className="text-slate-400 hover:text-white"
      >
        <IconClose size={12} />
      </button>
    </div>
  )
}
