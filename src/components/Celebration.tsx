import React, { useEffect, useMemo, useRef, useState } from 'react'
import { sfx } from '../lib/sound'
import { money } from '../lib/format'

/**
 * Celebration layers.
 *
 * Everything here is CSS-animation driven rather than JS per frame: a burst of
 * 60+ confetti pieces re-rendering React at 60fps would drop frames on a
 * mid-range Android, and the particles are decorative — they must never cost
 * the player a spin frame. Each piece gets its own duration/delay/rotation via
 * inline custom properties, so one keyframe set animates all of them.
 *
 * All layers are `pointer-events-none` and respect `prefers-reduced-motion`.
 */

const reducedMotion = () => {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** Deterministic pseudo-random so a re-render cannot reshuffle a burst. */
const rng = (seed: number) => {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

type Piece = {
  id: number
  left: number
  delay: number
  duration: number
  drift: number
  spin: number
  size: number
  color: string
  round: boolean
}

const CONFETTI_COLORS = ['#c6f24e', '#8bff5a', '#3ad7ff', '#ffcf5c', '#a06bff', '#ff4fa3', '#ffffff']

/**
 * Falling confetti. `count` pieces, spread across the full width, with a
 * horizontal drift and a spin so the burst has depth instead of reading as a
 * single curtain.
 */
export function Confetti({ count = 70, seed = 7, duration = 2600 }: { count?: number; seed?: number; duration?: number }) {
  const quiet = useMemo(reducedMotion, [])
  const pieces = useMemo<Piece[]>(() => {
    const rand = rng(seed)
    return Array.from({ length: count }, (_, id) => ({
      id,
      left: rand() * 100,
      delay: rand() * (duration * 0.35),
      duration: duration * (0.65 + rand() * 0.6),
      drift: (rand() - 0.5) * 220,
      spin: 360 + rand() * 900,
      size: 5 + rand() * 8,
      color: CONFETTI_COLORS[Math.floor(rand() * CONFETTI_COLORS.length)],
      round: rand() > 0.72,
    }))
  }, [count, seed, duration])

  if (quiet) return null

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {pieces.map((p) => (
        <span
          key={p.id}
          className="absolute top-0 block"
          style={
            {
              left: `${p.left}%`,
              width: p.size,
              height: p.round ? p.size : p.size * 0.45,
              background: p.color,
              borderRadius: p.round ? '999px' : '2px',
              opacity: 0,
              animation: `fbFall ${p.duration}ms cubic-bezier(.25,.6,.4,1) ${p.delay}ms forwards`,
              '--fb-drift': `${p.drift}px`,
              '--fb-spin': `${p.spin}deg`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  )
}

/** Coins raining in behind a payout, slower and heavier than confetti. */
export function CoinRain({ count = 16, seed = 21, duration = 2400 }: { count?: number; seed?: number; duration?: number }) {
  const quiet = useMemo(reducedMotion, [])
  const coins = useMemo(() => {
    const rand = rng(seed)
    return Array.from({ length: count }, (_, id) => ({
      id,
      left: 4 + rand() * 92,
      delay: rand() * (duration * 0.5),
      duration: duration * (0.7 + rand() * 0.7),
      drift: (rand() - 0.5) * 120,
      size: 14 + rand() * 12,
      spin: 240 + rand() * 540,
    }))
  }, [count, seed, duration])

  if (quiet) return null

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {coins.map((c) => (
        <span
          key={c.id}
          className="absolute top-0 grid place-items-center rounded-full"
          style={
            {
              left: `${c.left}%`,
              width: c.size,
              height: c.size,
              background: 'radial-gradient(circle at 35% 30%, #fff3c4, #ffcf5c 45%, #b8860b 100%)',
              boxShadow: '0 0 12px rgba(255,207,92,.65), inset 0 -2px 3px rgba(0,0,0,.35)',
              fontSize: c.size * 0.55,
              lineHeight: 1,
              color: '#7a5a00',
              opacity: 0,
              animation: `fbCoinDrop ${c.duration}ms cubic-bezier(.3,.5,.45,1) ${c.delay}ms forwards`,
              '--fb-drift': `${c.drift}px`,
              '--fb-spin': `${c.spin}deg`,
            } as React.CSSProperties
          }
        >
          PX
        </span>
      ))}
    </div>
  )
}

/**
 * Rising light rays behind a headline. Cheap: six conic wedges rotating once.
 */
export function LightRays({ color = '198,242,78' }: { color?: string }) {
  const quiet = useMemo(reducedMotion, [])
  if (quiet) return null
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      <div
        className="absolute left-1/2 top-1/2 h-[160vmax] w-[160vmax] -translate-x-1/2 -translate-y-1/2 animate-[fbSpin_18s_linear_infinite] opacity-40"
        style={{
          background: `conic-gradient(from 0deg, transparent 0deg, rgba(${color},.16) 6deg, transparent 14deg, transparent 30deg, rgba(${color},.13) 36deg, transparent 44deg, transparent 60deg, rgba(${color},.10) 66deg, transparent 74deg, transparent 360deg)`,
          maskImage: 'radial-gradient(circle, rgba(0,0,0,.9) 0%, rgba(0,0,0,.35) 45%, transparent 70%)',
          WebkitMaskImage: 'radial-gradient(circle, rgba(0,0,0,.9) 0%, rgba(0,0,0,.35) 45%, transparent 70%)',
        }}
      />
    </div>
  )
}

/**
 * A floating banner that keeps a free-spin round visible while it runs: how
 * many spins are left, and a pulse each time one is consumed. Without this the
 * player only knows they are in free spins from a number in the bet bar.
 */
export function FreeSpinHud({
  left,
  total,
  /** bumped by the game on every spin so the pulse retriggers */
  tick = 0,
  label = 'Free spins',
}: {
  left: number
  total?: number
  tick?: number
  label?: string
}) {
  if (left <= 0) return null
  const pct = total && total > 0 ? Math.max(0, Math.min(1, left / total)) : null
  return (
    <div
      className="pointer-events-none absolute left-1/2 top-2 z-30 -translate-x-1/2"
      role="status"
      aria-live="polite"
    >
      <div
        key={tick}
        className="flex items-center gap-2 rounded-full border border-neon-cyan/45 bg-ink-950/85 px-3 py-1.5 shadow-[0_0_30px_-6px_rgba(58,215,255,.85)] backdrop-blur-md"
        style={{ animation: 'fbPop .42s cubic-bezier(.16,1.1,.3,1) both' }}
      >
        <span className="relative grid h-4 w-4 place-items-center">
          <span className="absolute inset-0 animate-[pulseGlow_1.6s_ease-in-out_infinite] rounded-full bg-neon-cyan/40" />
          <span className="relative h-1.5 w-1.5 rounded-full bg-neon-cyan" />
        </span>
        <span className="text-[9.5px] font-black uppercase tracking-[.2em] text-neon-cyan/80">{label}</span>
        <span className="num text-sm font-black text-white">{left}</span>
        {total != null && (
          <span className="num text-[9.5px] font-bold text-slate-500">/{total}</span>
        )}
        {pct != null && (
          <span className="ml-0.5 h-1 w-10 overflow-hidden rounded-full bg-white/10">
            <span
              className="block h-full rounded-full bg-gradient-to-r from-neon-cyan to-neon-lime transition-[width] duration-500"
              style={{ width: `${pct * 100}%` }}
            />
          </span>
        )}
      </div>
    </div>
  )
}

/**
 * A compact burst anchored to a game panel. Where `Celebration` blocks the
 * screen (correct for free spins), this is for an ordinary sized win: coins and
 * confetti behind the result, no interruption to play.
 */
export function WinBurst({
  show,
  multiplier,
  seed = 9,
  big = false,
}: {
  show: boolean
  multiplier: number
  seed?: number
  big?: boolean
}) {
  const quiet = useMemo(reducedMotion, [])
  if (!show || quiet) return null
  return (
    <div className="pointer-events-none absolute inset-0 z-30 overflow-hidden" aria-hidden>
      <LightRays color={big ? '255,207,92' : '198,242,78'} />
      <Confetti count={big ? 70 : 34} seed={seed} duration={big ? 2800 : 2000} />
      {big && <CoinRain count={12} seed={seed + 3} />}
      <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 text-center">
        <span
          className={`num inline-block text-4xl font-black sm:text-5xl ${
            big ? 'text-gold' : 'text-neon-lime'
          }`}
          style={{
            animation: 'fbPop .5s cubic-bezier(.16,1.1,.3,1) both',
            textShadow: big
              ? '0 0 30px rgba(255,207,92,.8), 0 0 80px rgba(255,207,92,.35)'
              : '0 0 30px rgba(198,242,78,.8), 0 0 80px rgba(198,242,78,.3)',
          }}
        >
          {`${multiplier}×`}
        </span>
      </div>
    </div>
  )
}

/**
 * A number that counts up. Used for payouts so the amount reads as *earned*
 * rather than just appearing — the single cheapest way to make a win feel
 * bigger. Starts from 0 every time `value` changes.
 */
export function CountUp({
  value,
  duration = 900,
  className = '',
  format = (n: number) => money(n),
}: {
  value: number
  duration?: number
  className?: string
  format?: (n: number) => string
}) {
  const [shown, setShown] = useState(value)
  const from = useRef(0)
  const raf = useRef(0)

  useEffect(() => {
    if (reducedMotion()) {
      setShown(value)
      return
    }
    const start = performance.now()
    const a = from.current
    const b = value
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration)
      // ease-out cubic: fast count, settles on the exact figure
      const eased = 1 - Math.pow(1 - p, 3)
      setShown(a + (b - a) * eased)
      if (p < 1) raf.current = requestAnimationFrame(tick)
      else from.current = b
    }
    raf.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf.current)
  }, [value, duration])

  return <span className={`num tabular-nums ${className}`}>{format(shown)}</span>
}

/**
 * Full-screen celebration card.
 *
 * Used for a free-spin trigger and for a big win inside free spins. Deliberately
 * blocking for a couple of seconds: this is the moment the player is playing
 * for, and the reels do not start the next round until it clears.
 */
export function Celebration({
  kind = 'freespins',
  title,
  subtitle,
  amount,
  spins,
  onDone,
  holdMs = 2600,
}: {
  kind?: 'freespins' | 'bigwin' | 'mega'
  title: string
  subtitle?: string
  amount?: number
  spins?: number
  onDone?: () => void
  holdMs?: number
}) {
  const quiet = useMemo(reducedMotion, [])
  const [leaving, setLeaving] = useState(false)

  useEffect(() => {
    const out = window.setTimeout(() => setLeaving(true), quiet ? 400 : holdMs)
    const done = window.setTimeout(() => onDone?.(), quiet ? 500 : holdMs + 380)
    return () => {
      window.clearTimeout(out)
      window.clearTimeout(done)
    }
  }, [onDone, holdMs, quiet])

  const palette =
    kind === 'freespins'
      ? { ring: 'rgba(58,215,255,.55)', glow: '58,215,255', text: 'text-neon-cyan', label: 'Free spins' }
      : kind === 'mega'
        ? { ring: 'rgba(255,207,92,.6)', glow: '255,207,92', text: 'text-gold', label: 'Mega win' }
        : { ring: 'rgba(198,242,78,.55)', glow: '198,242,78', text: 'text-neon-lime', label: 'Big win' }

  return (
    <div
      className="fixed inset-0 z-[70] grid place-items-center overflow-hidden bg-ink-950/80 backdrop-blur-md"
      style={{ animation: leaving ? 'fbFadeOut .38s ease-in forwards' : 'fbFadeIn .2s ease-out both' }}
      role="status"
      aria-live="polite"
    >
      <LightRays color={palette.glow} />
      {kind === 'freespins' ? <Confetti count={90} seed={13} /> : <CoinRain count={22} seed={5} />}
      {kind !== 'freespins' && <Confetti count={60} seed={31} />}

      <div
        className="relative mx-4 w-full max-w-md rounded-3xl border px-6 py-7 text-center backdrop-blur-xl"
        style={{
          borderColor: palette.ring,
          background: 'linear-gradient(165deg, rgba(20,24,36,.96), rgba(11,13,21,.98))',
          boxShadow: `0 0 0 1px rgba(255,255,255,.06), 0 0 80px -20px rgba(${palette.glow},.65), 0 40px 90px -40px #000`,
          animation: quiet ? undefined : 'fbCardIn .55s cubic-bezier(.16,1.1,.3,1) both',
        }}
      >
        <p className={`text-[10.5px] font-black uppercase tracking-[.34em] ${palette.text}`}>
          {palette.label}
        </p>

        {amount != null && (
          <p className="mt-2 text-4xl font-black leading-none text-white glow-text sm:text-5xl">
            <CountUp value={amount} duration={1100} />
            <span className="ml-1 text-lg font-bold text-slate-400">PX</span>
          </p>
        )}

        <h2
          className={`mt-2 font-display text-2xl font-black uppercase tracking-tight text-white sm:text-3xl ${
            quiet ? '' : 'animate-[fbPop_.5s_.12s_cubic-bezier(.16,1.1,.3,1)_both]'
          }`}
        >
          {title}
        </h2>
        {subtitle && <p className="mt-1.5 text-[12.5px] leading-snug text-slate-400">{subtitle}</p>}

        {spins != null && (
          <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-neon-cyan/40 bg-neon-cyan/10 px-4 py-1.5">
            <span className="text-[10px] font-bold uppercase tracking-[.18em] text-neon-cyan/70">
              Spins
            </span>
            <span className="num text-xl font-black text-neon-cyan">{spins}</span>
          </div>
        )}

        {onDone && (
          <button
            type="button"
            onClick={onDone}
            className="mt-5 w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2 text-[11.5px] font-bold uppercase tracking-[.16em] text-slate-300 transition hover:bg-white/[0.08] hover:text-white"
          >
            Continue
          </button>
        )}
      </div>
    </div>
  )
}

/**
 * Plays the celebration cue for a given kind. Kept next to the visual so the
 * two can never drift apart.
 */
export function celebrationSound(kind: 'freespins' | 'bigwin' | 'mega') {
  if (kind === 'freespins') {
    sfx.freespinFanfare()
    window.setTimeout(() => sfx.freespinBed(1.6), 220)
  } else {
    sfx.bigwin()
    window.setTimeout(() => sfx.coinShower(kind === 'mega' ? 10 : 6), 300)
  }
}
