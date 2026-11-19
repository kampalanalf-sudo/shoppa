import React, { useEffect, useRef, useState } from 'react'
import { audioReady, sfx } from '../lib/sound'

/**
 * "NoKwaff Studios" launch ident.
 *
 * Shown once per app launch, over the boot screen, before the shell appears.
 * It is a *splash*, not a gate: it never blocks input and it removes itself even
 * if the animation somehow fails to fire. Three hard requirements, because this
 * runs on the critical path of every cold start:
 *
 *   - it must never delay the app by more than ~2.4s, total;
 *   - it must be skippable (tap anywhere) — a returning player opening the app
 *     to check a balance should not sit through a logo;
 *   - it must respect `prefers-reduced-motion`, in which case it is a short
 *     static card.
 *
 * The sound is deliberately *not* forced: browsers block audio until a gesture,
 * so `logoSting` is only attempted if the context is already unlocked (see
 * `sfx.unlockAttempted`). Silence is the correct default here.
 */

const SEEN_KEY = 'nokwaff.ident.seen'
const HOLD_MS = 2000
const OUT_MS = 420

export function StudioIdent({
  /** ms the ident holds before it starts leaving */
  holdMs = HOLD_MS,
  /** show it on every launch, not just the first of the session */
  alwaysShow = true,
  onDone,
}: {
  holdMs?: number
  alwaysShow?: boolean
  onDone?: () => void
}) {
  // Once per *session* (a tab or app launch), not once per device: the studio
  // mark is part of the brand, so it should appear on each cold start but must
  // not replay on every in-app navigation or hash change.
  const [visible, setVisible] = useState(() => {
    if (typeof window === 'undefined') return false
    if (!alwaysShow) return false
    try {
      if (window.sessionStorage.getItem(SEEN_KEY) === '1') return false
    } catch {
      /* private mode: show it */
    }
    return true
  })
  const [leaving, setLeaving] = useState(false)
  const doneRef = useRef(false)

  const finish = () => {
    if (doneRef.current) return
    doneRef.current = true
    // If the ident was silent because audio was still locked, a tap unlocks
    // it: give a short "hello" on the way out rather than nothing.
    try {
      if (!audioReady()) sfx.click()
    } catch {
      /* ignore */
    }
    setLeaving(true)
    window.setTimeout(() => {
      setVisible(false)
      try {
        window.sessionStorage.setItem(SEEN_KEY, '1')
      } catch {
        /* ignore */
      }
      onDone?.()
    }, OUT_MS)
  }

  useEffect(() => {
    if (!visible) return
    // Best effort only. Audio before a user gesture is blocked by every mobile
    // browser, so on a cold start this is silent — by design, and not a bug.
    // If the context is already unlocked (returning to the app in the same
    // session, or the ident replayed after a tap) the sting does play.
    try {
      if (audioReady()) sfx.logoSting()
    } catch {
      /* audio is never allowed to break the ident */
    }
    const t = window.setTimeout(finish, holdMs)
    return () => window.clearTimeout(t)
    // finish is stable for the lifetime of the mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, holdMs])

  if (!visible) return null

  return (
    <div
      className="fixed inset-0 z-[120] grid cursor-pointer place-items-center overflow-hidden bg-ink-950"
      onClick={finish}
      role="presentation"
      style={{ animation: leaving ? 'fbFadeOut .42s ease-in forwards' : undefined }}
    >
      {/* the mark's own light */}
      <div
        className="pointer-events-none absolute left-1/2 top-1/2 h-[120vmin] w-[120vmin] -translate-x-1/2 -translate-y-1/2 animate-[fbIdentGlow_2.4s_ease-in-out_infinite]"
        style={{
          background:
            'radial-gradient(circle at 50% 50%, rgba(198,242,78,.20) 0%, rgba(58,215,255,.09) 38%, transparent 68%)',
        }}
      />
      {/* a single sweep of light behind the wordmark */}
      <div
        className="pointer-events-none absolute inset-x-0 top-1/2 h-px -translate-y-1/2"
        style={{
          background:
            'linear-gradient(90deg, transparent, rgba(198,242,78,.5), rgba(58,215,255,.5), transparent)',
          animation: 'fbIdentRule .9s .12s cubic-bezier(.2,.8,.3,1) both',
        }}
      />

      <div className="relative px-6 text-center">
        <div
          className="mx-auto mb-5 grid h-16 w-16 place-items-center rounded-2xl border border-white/10"
          style={{
            background: 'linear-gradient(165deg, rgba(198,242,78,.18), rgba(58,215,255,.10))',
            boxShadow: '0 0 0 1px rgba(255,255,255,.06), 0 24px 60px -24px rgba(198,242,78,.9)',
            animation: 'fbCardIn .7s cubic-bezier(.16,1.1,.3,1) both',
          }}
          aria-hidden
        >
          {/* NoKwaff mark: two stacked strokes forming an N with a floating dot */}
          <svg viewBox="0 0 48 48" className="h-9 w-9">
            <defs>
              <linearGradient id="nokwaffMark" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#e7ff9b" />
                <stop offset=".55" stopColor="#c6f24e" />
                <stop offset="1" stopColor="#3ad7ff" />
              </linearGradient>
            </defs>
            <path
              d="M10 36V12l14 16V12M28 36h10"
              fill="none"
              stroke="url(#nokwaffMark)"
              strokeWidth="4.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle cx="38" cy="13" r="3.6" fill="#c6f24e" />
          </svg>
        </div>

        <h1
          className="font-display text-[26px] font-black uppercase leading-none text-white sm:text-4xl"
          style={{
            animation: 'fbIdentIn 1s cubic-bezier(.2,.8,.3,1) both',
            textShadow: '0 0 30px rgba(198,242,78,.45), 0 0 70px rgba(58,215,255,.25)',
          }}
        >
          NoKwaff
          <span className="ml-2 bg-gradient-to-r from-neon-lime to-neon-cyan bg-clip-text text-transparent">
            Studios
          </span>
        </h1>

        <p
          className="mt-3 text-[10px] font-bold uppercase tracking-[.34em] text-slate-500"
          style={{ animation: 'fbFadeIn .6s .5s both' }}
        >
          Kampala · Uganda
        </p>
      </div>

      <p className="absolute bottom-6 text-[9.5px] font-bold uppercase tracking-[.28em] text-slate-600">
        Tap to skip
      </p>
    </div>
  )
}
