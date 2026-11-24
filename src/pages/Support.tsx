import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../lib/auth'
import { api, describeApiError } from '../lib/api'
import { onSupportMessage } from '../lib/supabase'
import { IconChevronLeft, IconChat, IconInfo, IconRefresh, IconShield, IconUser } from '../components/Icons'

/**
 * Customer care, for players.
 *
 * Four automated agents answer: Naki (account), Odong (money), Amina (games) and
 * Grace (safety). Each one reads the player's real account through the server —
 * the browser never sends an account summary, because a client that could choose
 * its own facts would be a client that could lie to support.
 *
 * Two decisions worth keeping:
 *
 *   1. The screen says plainly that these are automated. An agent that pretends
 *      to be a person, and then passes you to one, reads as a bait-and-switch.
 *      Saying "automated" up front costs nothing and is the reason a handoff is
 *      believable when it happens.
 *
 *   2. A handoff is shown as a visible line in the transcript, written by the
 *      server. Without it the player is told "a human will look at this" and has
 *      no way to know whether anything actually happened.
 *
 * Read-only by design: nothing here can move money, and no agent can.
 */

type Agent = { id: string; display_name: string; role: string; scope: string }

type Msg = {
  id: number
  author: 'player' | 'agent' | 'system'
  agent_id: string | null
  body: string
  created_at: string
}

type Conversation = {
  id: string
  agent_id: string | null
  status: string
  needs_human: boolean
}

const SUGGESTIONS = [
  'I topped up but my balance did not change',
  'Why did my bet lose?',
  'I forgot my password',
  'I want to take a break',
]

export function Support({ onHome, onSignIn }: { onHome: () => void; onSignIn?: () => void }) {
  const { user } = useAuth()
  const [agents, setAgents] = useState<Agent[]>([])
  const [conv, setConv] = useState<Conversation | null>(null)
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [booting, setBooting] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const scroller = useRef<HTMLDivElement>(null)

  const byId = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents])

  const scroll = useCallback(() => {
    requestAnimationFrame(() => {
      const el = scroller.current
      if (el) el.scrollTop = el.scrollHeight
    })
  }, [])

  // Opening support means "carry on where we left off" if there is a live
  // thread. Without this a reload looked like a brand-new conversation and the
  // player had to say everything again — which is the thing that makes people
  // give up on support entirely.
  //
  // Neither call is fatal: failing to resume just shows the empty state, and
  // failing to load the agent list only costs the name in the header.
  useEffect(() => {
    let alive = true
    void Promise.allSettled([
      api<{ agents: Agent[] }>('/api/support/agents'),
      api<{ conversation: Conversation | null; messages: Msg[]; resumed: boolean }>(
        '/api/support/start',
        { method: 'POST', body: { resume: true } },
      ),
    ])
      .then(([agentsRes, threadRes]) => {
        if (!alive) return
        if (agentsRes.status === 'fulfilled') setAgents(agentsRes.value.agents ?? [])
        if (threadRes.status === 'fulfilled' && threadRes.value.conversation) {
          setConv(threadRes.value.conversation)
          setMsgs(threadRes.value.messages ?? [])
          scroll()
        }
      })
      .finally(() => {
        if (alive) setBooting(false)
      })
    return () => {
      alive = false
    }
  }, [scroll])

  // Live replies. The agent's answer already comes back in the POST response, so
  // this is for the cases the response cannot cover: a handoff line written by
  // the server, and an answer that arrives after the player navigated away and
  // back. Duplicates are dropped by id.
  useEffect(() => {
    if (!conv) return
    return onSupportMessage(conv.id, (row) => {
      setMsgs((m) => (m.some((x) => x.id === row.id) ? m : [...m, row as Msg]))
      scroll()
    })
  }, [conv, scroll])

  const send = useCallback(
    async (raw: string) => {
      const message = raw.trim()
      if (!message || busy || !user) return

      setBusy(true)
      setError(null)
      // Show the player's own words immediately. Waiting for a round trip before
      // their message appears makes a slow agent look like a broken app.
      const optimistic: Msg = {
        id: -Date.now(),
        author: 'player',
        agent_id: null,
        body: message,
        created_at: new Date().toISOString(),
      }
      setMsgs((m) => [...m, optimistic])
      setText('')
      scroll()

      try {
        if (!conv) {
          const body = await api<{ conversation: Conversation; messages: Msg[] }>(
            '/api/support/start',
            { method: 'POST', body: { message } },
          )
          setConv(body.conversation)
          // Replace the optimistic row with the server's copy so ids are real.
          setMsgs(body.messages ?? [])
        } else {
          const body = await api<{ messages: Msg[]; needs_human: boolean }>('/api/support/send', {
            method: 'POST',
            params: { id: conv.id },
            body: { message },
          })
          const known = new Set((body.messages ?? []).map((m) => m.id))
          setMsgs((m) => [
            ...m.filter((x) => !(x.id < 0 && known.size > 0)),
            ...(body.messages ?? []),
          ])
          if (body.needs_human) setConv((c) => (c ? { ...c, needs_human: true, status: 'handoff' } : c))
        }
      } catch (e) {
        // Put the words back in the box. Losing what a player typed is worse
        // than any error message.
        setText(message)
        setMsgs((m) => m.filter((x) => x.id !== optimistic.id))
        setError(describeApiError(e, 'Could not reach support. Try again.'))
      } finally {
        setBusy(false)
        scroll()
      }
    },
    [busy, conv, scroll, user],
  )

  const activeAgent = conv?.agent_id ? byId.get(conv.agent_id) : null

  return (
    <div className="mx-auto flex w-full max-w-[760px] flex-col px-4 py-6">
      <div className="mb-3 flex items-center gap-2">
        <button
          type="button"
          onClick={onHome}
          aria-label="Back to games"
          className="grid h-9 w-9 place-items-center rounded-xl border border-white/[0.07] bg-white/[0.03] text-slate-300 transition hover:bg-white/10"
        >
          <IconChevronLeft size={17} />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="text-[15px] font-bold text-white">Customer care</h1>
          <p className="truncate text-[10.5px] text-slate-500">
            {conv
              ? `Talking to ${activeAgent?.display_name ?? 'support'} · ${activeAgent?.role ?? 'general'}`
              : 'Four agents, each with their own area'}
          </p>
        </div>
        {msgs.length > 0 && (
          <button
            type="button"
            onClick={() => {
              // Close it on the server too. Clearing only the screen would look
              // like a new conversation, then resume would drag the old one back
              // the next time this screen opened — the worst of both.
              if (conv) void api('/api/support/close', { method: 'POST', params: { id: conv.id } }).catch(() => undefined)
              setConv(null)
              setMsgs([])
              setError(null)
            }}
            className="btn-ghost !px-2 !py-1 !text-[10.5px]"
          >
            <IconRefresh size={12} /> New
          </button>
        )}
      </div>

      {/* Said once, up front, so the handoff later is believable. */}
      <div className="mb-3 flex items-start gap-2 rounded-xl border border-white/[0.07] bg-white/[0.02] px-2.5 py-2">
        <IconInfo size={13} className="mt-0.5 shrink-0 text-slate-500" />
        <p className="text-[10.5px] leading-relaxed text-slate-400">
          These are automated agents. They can read your account to answer, but they cannot move
          money or change it — anything like that goes to a person, and you will see it noted here.
        </p>
      </div>

      <div
        ref={scroller}
        role="log"
        aria-live="polite"
        aria-label="Support conversation"
        className="min-h-[280px] flex-1 space-y-2 overflow-y-auto rounded-2xl border border-white/[0.06] bg-black/20 p-2.5"
      >
        {booting && <p className="py-8 text-center text-[12px] text-slate-500">Starting…</p>}

        {!booting && msgs.length === 0 && (
          <div className="py-6">
            <p className="mb-1 text-center text-[12.5px] font-bold text-white">
              What can we help with?
            </p>
            <p className="mb-3 text-center text-[10.5px] text-slate-500">
              Type your own question, or start with one of these.
            </p>
            <div className="mx-auto grid max-w-[460px] gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => void send(s)}
                  className="rounded-xl border border-white/[0.07] bg-white/[0.02] px-3 py-2 text-left text-[11.5px] text-slate-300 transition hover:border-neon-lime/40 hover:bg-white/[0.05]"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {msgs.map((m) => {
          const agent = m.agent_id ? byId.get(m.agent_id) : null
          if (m.author === 'system') {
            return (
              <p
                key={m.id}
                className="mx-auto w-fit rounded-full border border-amber-500/25 bg-amber-500/10 px-2.5 py-1 text-[10px] font-bold text-amber-200"
              >
                Passed to a human
              </p>
            )
          }

          const mine = m.author === 'player'
          return (
            <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] ${mine ? 'items-end' : 'items-start'} flex flex-col gap-0.5`}>
                {!mine && (
                  <span className="flex items-center gap-1 px-1 text-[9.5px] font-bold uppercase tracking-wide text-slate-500">
                    <IconShield size={9} />
                    {agent?.display_name ?? 'Support'}
                  </span>
                )}
                <div
                  className={`whitespace-pre-wrap rounded-2xl px-3 py-2 text-[12px] leading-relaxed ${
                    mine
                      ? 'rounded-br-md bg-neon-lime/15 text-white'
                      : 'rounded-bl-md border border-white/[0.07] bg-white/[0.04] text-slate-200'
                  }`}
                >
                  {m.body}
                </div>
              </div>
            </div>
          )
        })}

        {busy && (
          <div className="flex justify-start" aria-label={`${activeAgent?.display_name ?? 'Support'} is replying`}>
            <div className="flex items-center gap-1 rounded-2xl rounded-bl-md border border-white/[0.07] bg-white/[0.04] px-3 py-2">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="h-1.5 w-1.5 animate-pulse rounded-full bg-slate-400"
                  style={{ animationDelay: `${i * 150}ms` }}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {error && (
        <p className="mt-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 py-2 text-[11px] text-rose-200">
          {error}
        </p>
      )}

      {/* A signed-out visitor can reach this screen from the floating Help
          button. Sending used to do nothing at all here — no error, no prompt —
          which reads as a broken app rather than a locked door. Say it, and give
          them the one action that fixes it. */}
      {!user && (
        <div className="mt-2 flex items-center gap-2 rounded-xl border border-amber-500/25 bg-amber-500/10 px-2.5 py-2">
          <p className="flex-1 text-[11px] leading-relaxed text-amber-100">
            Sign in to chat with the agents — they read your account to answer, so
            they need to know who you are.
          </p>
          {onSignIn && (
            <button
              type="button"
              onClick={onSignIn}
              className="shrink-0 rounded-lg bg-neon-lime px-2.5 py-1.5 text-[11px] font-bold text-black"
            >
              Sign in
            </button>
          )}
        </div>
      )}

      <form
        className="mt-2 flex items-end gap-1.5"
        onSubmit={(e) => {
          e.preventDefault()
          void send(text)
        }}
      >
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void send(text)
            }
          }}
          rows={1}
          maxLength={4000}
          placeholder="Describe the problem…"
          className="max-h-32 min-h-[42px] flex-1 resize-none rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2.5 text-[12.5px] text-white placeholder:text-slate-500 focus:border-neon-lime/50 focus:outline-none"
        />
        <button
          type="submit"
          disabled={busy || !text.trim() || !user}
          className="grid h-[42px] w-[42px] shrink-0 place-items-center rounded-xl bg-neon-lime text-black transition disabled:opacity-40"
          aria-label="Send"
        >
          <IconChat size={17} />
        </button>
      </form>

      <p className="mt-2 flex items-center gap-1.5 text-[10px] text-slate-600">
        <IconUser size={10} />
        Never share your password or a one-time code with anyone, including support.
      </p>
    </div>
  )
}
