import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../lib/auth'
import { onChatMessage, supabase, type ChatRow, type GiftRow } from '../lib/supabase'
import { money } from '../lib/format'
import { sfx } from '../lib/sound'
import { IconClose, IconChat, IconBolt } from './Icons'

type Msg = ChatRow & { sending?: boolean }

const GST = [1000, 5000, 10000]

/**
 * Live chat room with peer-to-peer UGX gifting.
 *
 * Money moves only through the send_gift / claim_gift / refund_gift RPCs, so
 * the sender's balance is debited at send time and the recipient's is credited
 * on claim. A declined or withdrawn gift returns to the sender.
 */
export function ChatRoom({ onClose }: { onClose: () => void }) {
  const { user, profile, wallet, configured } = useAuth()
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [giftTo, setGiftTo] = useState<{ id: string; name: string } | null>(null)
  const [giftAmount, setGiftAmount] = useState(1000)
  const [giftNote, setGiftNote] = useState('')
  const [incoming, setIncoming] = useState<GiftRow[]>([])
  const [tick, setTick] = useState(0)
  const scroller = useRef<HTMLDivElement>(null)

  const balance = wallet?.balance_px ?? 0

  // initial page of history
  useEffect(() => {
    if (!supabase) return
    let alive = true
    void supabase
      .from('chat_messages')
      .select('id,user_id,body,created_at,gift_id')
      .order('created_at', { ascending: false })
      .limit(60)
      .then(({ data }) => {
        if (alive && data) setMsgs([...(data as Msg[])].reverse())
      })
    return () => {
      alive = false
    }
  }, [])

  // live inserts
  useEffect(() => {
    if (!configured) return
    const off = onChatMessage((row) => {
      setMsgs((m) => (m.some((x) => x.id === row.id) ? m : [...m, row]))
    })
    return off
  }, [configured])

  // pending gifts addressed to me
  useEffect(() => {
    const client = supabase
    if (!client || !user) return
    let alive = true
    const load = () =>
      void client
        .from('gifts')
        .select('*')
        .eq('recipient_id', user.id)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .then(({ data }) => {
          if (alive && data) setIncoming(data as GiftRow[])
        })
    load()
    const t = window.setInterval(load, 15000)
    return () => {
      alive = false
      window.clearInterval(t)
    }
  }, [user, tick])

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' })
  }, [msgs.length])

  const send = useCallback(async () => {
    const body = text.trim()
    if (!body || !supabase || !user) return
    setBusy(true)
    setError(null)
    setText('')
    const { error: err } = await supabase.from('chat_messages').insert({ user_id: user.id, body })
    if (err) setError(err.message)
    sfx.click()
    setBusy(false)
  }, [text, user])

  const doGift = useCallback(async () => {
    if (!supabase || !giftTo) return
    setBusy(true)
    setError(null)
    try {
      const { error: err } = await supabase.rpc('send_gift', {
        p_recipient: giftTo.id,
        p_amount_px: Math.round(giftAmount),
        p_note: giftNote.trim() || null,
      })
      if (err) throw new Error(err.message)
      sfx.win()
      // announce it in the room so the gift is visible to everyone
      await supabase.from('chat_messages').insert({
        user_id: user!.id,
        body: `🎁 sent UGX ${money(giftAmount)} to ${giftTo.name}${giftNote.trim() ? ` — ${giftNote.trim()}` : ''}`,
      })
      setGiftTo(null)
      setGiftNote('')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }, [giftTo, giftAmount, giftNote, user])

  const claim = useCallback(async (id: string) => {
    if (!supabase) return
    setBusy(true)
    try {
      const { error: err } = await supabase.rpc('claim_gift', { p_gift: id })
      if (err) throw new Error(err.message)
      sfx.bigwin()
      setTick((n) => n + 1)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }, [])

  const decline = useCallback(async (id: string) => {
    if (!supabase) return
    setBusy(true)
    try {
      const { error: err } = await supabase.rpc('refund_gift', { p_gift: id })
      if (err) throw new Error(err.message)
      setTick((n) => n + 1)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }, [])

  const canAfford = giftAmount > 0 && giftAmount <= balance

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-4">
      <div className="flex h-[92vh] w-full max-w-[460px] animate-popIn flex-col overflow-hidden rounded-t-2xl border border-white/10 bg-ink-850/98 shadow-pop sm:h-[80vh] sm:rounded-2xl">
        {/* header */}
        <div className="flex items-center justify-between border-b border-white/[0.07] px-3.5 py-2.5">
          <div className="flex items-center gap-2">
            <IconChat size={16} className="text-neon-lime" />
            <span className="text-[13px] font-bold text-white">Live Room</span>
            <span className="chip !px-2 !py-0.5 !text-[10px] normal-case tracking-normal">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
              live
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="num rounded-md bg-neon-lime/10 px-2 py-0.5 text-[11px] font-bold text-neon-lime">
              UGX {money(balance)}
            </span>
            <button type="button" onClick={onClose} aria-label="Close chat" className="text-slate-500 hover:text-white">
              <IconClose size={16} />
            </button>
          </div>
        </div>

        {/* incoming gifts */}
        {incoming.length > 0 && (
          <div className="space-y-1.5 border-b border-white/[0.07] bg-gold/[0.06] px-3 py-2">
            {incoming.map((g) => (
              <div key={g.id} className="flex items-center gap-2 rounded-lg border border-gold/30 bg-gold/10 px-2 py-1.5">
                <span className="text-[14px]">🎁</span>
                <div className="min-w-0 flex-1">
                  <p className="text-[11.5px] font-bold text-gold">
                    UGX {money(g.amount_px)} gift
                  </p>
                  {g.note && <p className="truncate text-[10px] text-slate-400">{g.note}</p>}
                </div>
                <button
                  type="button"
                  onClick={() => void claim(g.id)}
                  disabled={busy}
                  className="rounded-md bg-gold px-2 py-1 text-[10.5px] font-black text-ink-950 disabled:opacity-50"
                >
                  Claim
                </button>
                <button
                  type="button"
                  onClick={() => void decline(g.id)}
                  disabled={busy}
                  className="rounded-md border border-white/15 px-2 py-1 text-[10.5px] font-bold text-slate-400 disabled:opacity-50"
                >
                  Return
                </button>
              </div>
            ))}
          </div>
        )}

        {/* messages */}
        <div ref={scroller} className="flex-1 space-y-2 overflow-y-auto px-3.5 py-3">
          {msgs.length === 0 && (
            <p className="py-10 text-center text-[12px] text-slate-600">
              {configured ? 'No messages yet — say hello.' : 'Chat needs the backend configured.'}
            </p>
          )}
          {msgs.map((m, i) => {
            const mine = m.user_id === user?.id
            return (
              <div key={m.id ?? i} className={`text-[12.5px] leading-relaxed ${mine ? 'text-right' : ''}`}>
                <div className={`inline-flex max-w-[85%] flex-col ${mine ? 'items-end' : 'items-start'}`}>
                  <div className="mb-0.5 flex items-center gap-1">
                    <span className={`text-[10.5px] font-bold ${mine ? 'text-neon-lime' : 'text-neon-cyan'}`}>
                      {mine ? profile?.username ?? 'you' : 'player'}
                    </span>
                    {m.user_id !== user?.id && (
                      <button
                        type="button"
                        onClick={() => {
                          setGiftTo({ id: m.user_id, name: 'player' })
                          setError(null)
                        }}
                        className="rounded bg-gold/15 px-1 text-[9px] font-bold uppercase text-gold hover:bg-gold/25"
                        title="Send a gift"
                      >
                        gift
                      </button>
                    )}
                    <span className="text-[9px] text-slate-600">
                      {new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <p
                    className={`rounded-xl px-2.5 py-1.5 text-left ${
                      mine ? 'bg-neon-lime/15 text-neon-lime' : 'bg-white/[0.05] text-slate-300'
                    }`}
                  >
                    {m.body}
                  </p>
                </div>
              </div>
            )
          })}
        </div>

        {error && (
          <div className="border-t border-rose-500/20 bg-rose-500/10 px-3 py-1.5 text-[11px] text-rose-200">{error}</div>
        )}

        {/* gift composer */}
        {giftTo && (
          <div className="border-t border-gold/25 bg-gold/[0.07] px-3 py-2.5">
            <div className="mb-1.5 flex items-center justify-between">
              <p className="text-[11px] font-bold text-gold">Gift UGX to {giftTo.name}</p>
              <button type="button" onClick={() => setGiftTo(null)} className="text-slate-500 hover:text-white">
                <IconClose size={13} />
              </button>
            </div>
            <div className="mb-1.5 flex gap-1">
              {GST.map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => setGiftAmount(g)}
                  className={`num flex-1 rounded-md border px-1.5 py-1 text-[11px] font-bold transition ${
                    giftAmount === g
                      ? 'border-gold bg-gold/20 text-gold'
                      : 'border-white/10 bg-white/[0.03] text-slate-400'
                  }`}
                >
                  {money(g)}
                </button>
              ))}
              <input
                inputMode="decimal"
                value={giftAmount}
                onChange={(e) => setGiftAmount(Math.max(0, Math.round(Number(e.target.value.replace(/[^0-9]/g, '')) || 0)))}
                className="num w-[70px] rounded-md border border-white/10 bg-ink-900 px-1.5 py-1 text-center text-[11px] font-bold text-white focus:outline-none"
              />
            </div>
            <input
              value={giftNote}
              onChange={(e) => setGiftNote(e.target.value.slice(0, 140))}
              placeholder="Add a note (optional)"
              className="field mb-1.5 !py-1.5 !text-[11.5px]"
            />
            <button
              type="button"
              onClick={() => void doGift()}
              disabled={busy || !canAfford}
              className="w-full rounded-lg bg-gold py-2 text-[12px] font-black text-ink-950 disabled:opacity-40"
            >
                                  {canAfford ? `Send UGX ${money(giftAmount)}` : 'Not enough balance'}
            </button>
            <p className="mt-1 text-center text-[9.5px] text-slate-600">
              Gifts are real money and are credited to the recipient's balance.
            </p>
          </div>
        )}

        {/* composer */}
        <div className="flex gap-1.5 border-t border-white/[0.07] p-2.5">
          <input
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, 500))}
            onKeyDown={(e) => e.key === 'Enter' && void send()}
            placeholder={user ? 'Say something…' : 'Sign in to chat'}
            disabled={!user}
            className="field !py-2 !text-[12px]"
          />
          <button
            type="button"
            onClick={() => void send()}
            disabled={busy || !user || !text.trim()}
            className="btn-primary !px-3 !py-2 !text-[12px]"
          >
            <IconBolt size={13} />
          </button>
        </div>
      </div>
    </div>
  )
}
