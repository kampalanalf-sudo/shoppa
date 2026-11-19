import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { SYMBOLS, ROWS, type Cell, type Grid, type SymbolId } from '../lib/slot'
import {
  buildSpinStrip,
  spinPlan,
  restOffsetPx,
  stripHeightPx,
  SPIN_BLUR,
  SPIN_EASE,
  NUDGE_EASE,
  NUDGE_TRANSFORM,
  START_TRANSFORM,
  restTransform,
} from '../lib/reels'

/* ------------------------------------------------------------------ helpers */

const FILLER: SymbolId[] = [
  'donut', 'key', 'cash', 'badge', 'diamond', 'donut', 'key',
  'cash', 'clyve', 'bonita', 'donut', 'key', 'badge',
  'cash', 'diamond', 'donut', 'key', 'clyve', 'bonita', 'wild',
  'donut', 'cash', 'scatter', 'key',
]

/** Deterministic filler so reels look like a real strip before the spin. */
function fillStrip(seed: number): SymbolId[] {
  return Array.from({ length: FILLER.length }, (_, i) => FILLER[(i + seed * 5) % FILLER.length])
}

/* ------------------------------------------------------------------ Siren (SVG) */

export function Siren({ size = 64, lit = false }: { size?: number | string; lit?: boolean }) {
  return (
    <svg viewBox="0 0 100 100" width={typeof size === 'number' ? size : undefined} height={typeof size === 'number' ? size : undefined} className={`drop-shadow-[0_0_18px_rgba(198,242,78,.55)] ${typeof size === 'string' ? size : ''}`}>
      <defs>
        <linearGradient id="sirenBase" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#4b5566" /><stop offset="1" stopColor="#1d2331" />
        </linearGradient>
        <linearGradient id="sirenLens" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#eaffb0" /><stop offset=".45" stopColor="#c6f24e" /><stop offset="1" stopColor="#7dd31c" />
        </linearGradient>
        <radialGradient id="sirenGlow" cx="50%" cy="45%">
          <stop offset="0" stopColor="rgba(198,242,78,.85)" /><stop offset="1" stopColor="rgba(198,242,78,0)" />
        </radialGradient>
      </defs>
      <ellipse cx="50" cy="46" rx="46" ry="42" fill="url(#sirenGlow)" opacity={lit ? 1 : 0.55}>
        {lit && <animate attributeName="opacity" values="0.35;1;0.35" dur="1.1s" repeatCount="indefinite" />}
      </ellipse>
      <ellipse cx="50" cy="78" rx="34" ry="7" fill="url(#sirenBase)" />
      <rect x="24" y="66" width="52" height="12" rx="5" fill="url(#sirenBase)" stroke="rgba(255,255,255,.18)" strokeWidth="1" />
      <path d="M27 66c0-16 10-30 23-30s23 14 23 30Z" fill="url(#sirenLens)" stroke="rgba(255,255,255,.35)" strokeWidth="1.2" />
      <path d="M32 62c1.5-12 8-24 18-26" fill="none" stroke="rgba(255,255,255,.7)" strokeWidth="3" strokeLinecap="round" opacity=".55" />
      <rect x="18" y="64" width="64" height="4" rx="2" fill="#8b93a5" opacity=".7" />
    </svg>
  )
}

/* ------------------------------------------------------------------ Symbol face */

export function SymbolFace({
  id, className = '', priority = false,
}: { id: SymbolId; className?: string; priority?: boolean }) {
  const meta = SYMBOLS[id]
  if (id === 'siren') {
    return (
      <span className={`grid place-items-center ${className}`}>
        <Siren size="h-full w-full" lit />
      </span>
    )
  }
  if (id === 'scatter') {
    // scatter is drawn so it reads as a glowing "3×" burst without needing art
    return (
      <span className={`relative grid place-items-center ${className}`}>
        <span className="absolute inset-0 rounded-full bg-[radial-gradient(circle,rgba(58,215,255,.55),transparent_65%)] blur-[2px]" />
        <svg viewBox="0 0 100 100" className="relative h-[74%] w-[74%]">
          <defs>
            <linearGradient id="scatFace" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#bff6ff" /><stop offset=".5" stopColor="#3ad7ff" /><stop offset="1" stopColor="#1a7fa8" />
            </linearGradient>
          </defs>
          <polygon points="50,4 61,36 96,36 68,57 79,92 50,71 21,92 32,57 4,36 39,36" fill="url(#scatFace)" stroke="rgba(255,255,255,.55)" strokeWidth="1.5" />
          <circle cx="50" cy="55" r="21" fill="rgba(6,18,26,.6)" stroke="rgba(255,255,255,.5)" strokeWidth="1.2" />
          <text x="50" y="62" textAnchor="middle" fontSize="21" fontWeight="900" fill="#eafcff" fontFamily="JetBrains Mono, monospace">3×</text>
        </svg>
      </span>
    )
  }
  return (
    <span className={`relative grid place-items-center overflow-hidden ${className}`}>
      {/* inner glow + rim so each symbol reads as a solid 3D piece */}
      <span className="absolute inset-0 bg-[radial-gradient(circle_at_50%_30%,rgba(198,242,78,.16),transparent_68%)]" />
      <img
        src={meta.art}
        alt={meta.name}
        draggable={false}
        loading={priority ? 'eager' : 'lazy'}
        className="relative h-full w-full select-none object-cover drop-shadow-[0_8px_18px_rgba(0,0,0,.6)]"
      />
      {/* specular sheen across the top-left of the tile */}
      <span
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'linear-gradient(148deg, rgba(255,255,255,.24) 0%, rgba(255,255,255,.06) 22%, transparent 44%)',
        }}
      />
      {/* contact shadow at the base */}
      <span
        className="pointer-events-none absolute inset-x-0 bottom-0"
        style={{ height: '22%', background: 'linear-gradient(to top, rgba(0,0,0,.5), transparent)' }}
      />
    </span>
  )
}

/* ------------------------------------------------------------------ 3D reel drum */

type ReelProps = {
  reel: number
  /** symbols the drum is showing right now, top to bottom */
  current: SymbolId[]
  /** symbols it must land on */
  next: SymbolId[]
  face: number
  gap: number
  /** bumped once per spin */
  spinToken: number
  /** the whole board's plan, so every drum shares one clock */
  stopMs: number
  delayMs: number
  nudgeMs: number
  travelMs: number
  winCells: Set<string>
  reducedMotion: boolean
}

/**
 * One drum.
 *
 * The strip starts on the symbols the player is already looking at, so the spin
 * is a continuation of the visible board rather than a swap. Motion is a single
 * accelerated CSS transition: the compositor runs it independent of the main
 * thread, so settling the round cannot stall the drums mid-flight.
 */
function Reel({
  reel, current, next, face, gap, spinToken, stopMs, delayMs, nudgeMs, travelMs,
  winCells, reducedMotion,
}: ReelProps) {
  const stripRef = useRef<HTMLDivElement>(null)
  const [moving, setMoving] = useState(false)
  const [landed, setLanded] = useState(false)
  const step = face + gap

  const stripKey = `${current.join(',')}|${next.join(',')}`
  const strip = useMemo(
    () => buildSpinStrip(current, next, FILLER, { travelFaces: 10, rows: ROWS }),
    // stripKey is the content identity of both windows
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stripKey],
  )
  const height = stripHeightPx(strip.length, face, gap)
  const offset = restOffsetPx(strip.length, ROWS, step)

  // Transform and transition are written to the node, never declared in JSX:
  // a React re-render (there are several per spin, from `moving`/`landed`)
  // would otherwise rewrite the style attribute mid-flight and cancel the
  // travel. This is the one place where imperative DOM is the correct answer.
  //
  // Layout effects run before paint, so the snap-to-rest below is never
  // visible: the sequence effect immediately overwrites it with the start
  // transform, which shows exactly the symbols that were already on screen.
  useLayoutEffect(() => {
    const el = stripRef.current
    if (!el) return
    el.style.transition = 'none'
    el.style.transform = restTransform(offset)
  }, [stripKey, offset])

  useLayoutEffect(() => {
    if (spinToken === 0) return
    const el = stripRef.current
    if (!el) return

    if (reducedMotion) {
      el.style.transition = 'none'
      el.style.transform = restTransform(offset)
      setMoving(false)
      setLanded(true)
      return
    }

    // Start exactly where the drum already is: no jump, ever.
    el.style.transition = 'none'
    el.style.transform = START_TRANSFORM
    setMoving(false)
    setLanded(false)

    let cancelled = false
    const timers: number[] = []

    // 1. pull back
    timers.push(window.setTimeout(() => {
      if (cancelled) return
      el.style.transition = `transform ${nudgeMs}ms ${NUDGE_EASE}`
      el.style.transform = NUDGE_TRANSFORM
      setMoving(true)
    }, delayMs))

    // 2. launch out of the nudge into the full travel. Reading offsetHeight
    //    forces a style recalc so the browser cannot batch the nudge and the
    //    travel into a single paint and drop the nudge entirely.
    timers.push(window.setTimeout(() => {
      if (cancelled) return
      void el.offsetHeight
      el.style.transition = `transform ${travelMs}ms ${SPIN_EASE}`
      el.style.transform = restTransform(offset)
    }, delayMs + nudgeMs))

    // 3. at rest
    timers.push(window.setTimeout(() => {
      if (cancelled) return
      el.style.transition = 'none'
      el.style.transform = restTransform(offset)
      setMoving(false)
      setLanded(true)
    }, stopMs))

    return () => {
      cancelled = true
      timers.forEach((t) => window.clearTimeout(t))
    }
  }, [spinToken, offset, delayMs, nudgeMs, travelMs, stopMs, reducedMotion])

  const stackH = face * ROWS + gap * (ROWS - 1)

  return (
    <div
      className="relative h-full flex-1"
      style={{ perspective: `${face * 4}px` }}
      aria-hidden
    >
      <div
        className="absolute left-0 right-0 top-1/2 overflow-hidden"
        style={{ height: stackH, marginTop: -stackH / 2 }}
      >
        <div
          ref={stripRef}
          className="absolute left-0 right-0 top-0 will-change-transform"
          style={{
            height,
            // Blur tracks travel only; a resting drum is always sharp.
            filter: moving ? SPIN_BLUR : 'none',
            transition: 'filter 120ms linear',
            backfaceVisibility: 'hidden',
          }}
        >
          {strip.map((f, k) => {
            const id = f.symId as SymbolId
            if (!SYMBOLS[id]) return null
            return (
              <div
                key={f.key}
                className="absolute left-0 right-0 grid place-items-center overflow-hidden rounded-[16%] border border-white/10"
                style={{
                  height: face,
                  top: k * step,
                  background:
                    'linear-gradient(180deg, rgba(38,46,66,.96) 0%, rgba(22,27,41,.98) 55%, rgba(15,19,30,1) 100%)',
                  boxShadow:
                    'inset 0 1px 0 rgba(255,255,255,.12), inset 0 -10px 16px -12px rgba(0,0,0,.9), 0 2px 6px -3px rgba(0,0,0,.7)',
                }}
              >
                <SymbolFace id={id} priority={k < ROWS} className="h-full w-full" />
              </div>
            )
          })}
        </div>

        {/* win highlight sits in the window, not on the moving strip */}
        {landed &&
          next.map((_, row) =>
            winCells.has(`${reel}-${row}`) ? (
              <span
                key={row}
                className="pointer-events-none absolute left-0 right-0 rounded-[16%] bg-[radial-gradient(circle,rgba(198,242,78,.32),transparent_70%)] ring-2 ring-inset ring-neon-lime/70"
                style={{ top: row * step, height: face }}
              />
            ) : null,
          )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ Cabinet */

export type Slot3DProps = {
  grid: Grid | null
  spinning: boolean
  /**
   * Bumped by the game at the exact moment the outcome has been committed to
   * `grid`. The drums start their travel on this, never on `spinning` — the
   * outcome must exist before a drum moves, or a drum would have no target.
   */
  spinKey: number
  stopping: boolean
  onSettled?: () => void
  winCells: Set<string>
  glow?: 'none' | 'win' | 'bigwin' | 'chase'
  className?: string
}

export function Slot3D({ grid, spinning, spinKey, winCells, glow = 'none', className = '' }: Slot3DProps) {
  // fallback board before the first spin
  const fallback = useMemo<Grid>(
    () =>
      [0, 1, 2, 3, 4].map((reel) =>
        [0, 1, 2].map((row) => ({ id: fillStrip(reel + 1)[row + 2], reel, row })),
      ),
    [],
  )
  const board = grid ?? fallback

  // The symbols each drum is currently sitting on. This is the anchor for the
  // next spin: the strip starts here, so nothing jumps when the spin begins.
  const [shown, setShown] = useState<SymbolId[][]>(() =>
    board.map((col) => col.map((c) => c.id)),
  )

  // Start small and let the observer size the board: guessing a large default
  // produces an oversized board on the first paint on a phone.
  const [face, setFace] = useState(56)
  const wrap = useRef<HTMLDivElement>(null)

  // The reel row is measured directly (it has no padding), so the face is the
  // largest whole pixel value that lets 5 reels + 4 gutters fill it exactly.
  useEffect(() => {
    const measure = () => {
      const el = wrap.current
      if (!el) return
      const rowW = el.clientWidth || 0
      if (rowW <= 0) return
      const g = rowW < 400 ? 3 : 5
      const f = Math.max(30, Math.min(150, Math.floor((rowW - g * 4) / 5)))
      setFace(f)
    }
    measure()
    const ro = new ResizeObserver(measure)
    if (wrap.current) ro.observe(wrap.current)
    window.addEventListener('orientationchange', measure)
    return () => {
      ro.disconnect()
      window.removeEventListener('orientationchange', measure)
    }
  }, [])

  const gap = face < 90 ? 3 : 5
  const boardH = face * ROWS + gap * (ROWS - 1)

  const reducedMotion = useMemo(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  }, [])

  const plan = useMemo(() => spinPlan(5), [])

  // Freeze the symbols each drum is spinning FROM, and the ones it lands ON,
  // at the moment the game publishes an outcome. Both are captured together in
  // one render, so a drum can never start without knowing its target.
  const [flight, setFlight] = useState<{ from: SymbolId[][]; to: SymbolId[][] } | null>(null)
  useEffect(() => {
    if (spinKey === 0) return
    setFlight({
      from: shown,
      to: board.map((col) => col.map((c) => c.id)),
    })
    // spinKey only: `shown` and `board` are read at that instant by design.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spinKey])

  // The board has landed: what is on screen is now the resting board.
  useEffect(() => {
    if (spinning) return
    setShown(board.map((col) => col.map((c) => c.id)))
    setFlight(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board, spinning])

  const from = flight?.from ?? shown
  const to = flight?.to ?? board.map((col) => col.map((c) => c.id))

  return (
    <div className={`relative ${className}`}>
      {/* cabinet frame */}
      <div
        className="relative rounded-[16px] p-[5px] sm:rounded-[26px] sm:p-[14px]"
        style={{
          background: 'linear-gradient(160deg,#2b3b2c 0%,#16241c 30%,#0d1612 70%,#22301f 100%)',
          boxShadow:
            '0 0 0 1px rgba(255,255,255,.10), 0 0 0 6px rgba(18,26,20,.9), 0 0 0 7px rgba(198,242,78,.16), 0 40px 80px -40px #000',
        }}
      >
        {/* inner gold bezel */}
        <div
          className="relative overflow-hidden rounded-[18px]"
          style={{
            background: 'linear-gradient(180deg,#0a0f14 0%,#070b10 100%)',
            boxShadow: 'inset 0 0 0 1px rgba(198,242,78,.18), inset 0 18px 40px -20px rgba(0,0,0,.95)',
          }}
        >
          {/* glow state */}
          {glow !== 'none' && (
            <div
              className={`pointer-events-none absolute inset-0 z-20 rounded-[18px] ${
                glow === 'chase' ? 'animate-pulseGlow' : ''
              }`}
              style={{
                background:
                  glow === 'bigwin'
                    ? 'radial-gradient(circle at 50% 50%, rgba(255,207,92,.28), transparent 68%)'
                    : glow === 'chase'
                      ? 'radial-gradient(circle at 50% 50%, rgba(58,215,255,.20), transparent 70%)'
                      : 'radial-gradient(circle at 50% 50%, rgba(198,242,78,.16), transparent 70%)',
              }}
            />
          )}

          {/* reels */}
          <div className="relative px-1 py-1 sm:px-3 sm:py-3">
            <div
              ref={wrap}
              className="flex w-full"
              style={{ perspective: '1200px', gap: `${gap}px`, height: `${boardH}px` }}
            >
              {[0, 1, 2, 3, 4].map((reel) => {
                const p = plan.reels[reel]
                return (
                  <Reel
                    key={reel}
                    reel={reel}
                    current={(from[reel] ?? []).map((id) => id as SymbolId)}
                    next={(to[reel] ?? []).map((id) => id as SymbolId)}
                    face={face}
                    gap={gap}
                    spinToken={spinKey}
                    stopMs={p.stopMs}
                    delayMs={p.delayMs}
                    nudgeMs={p.nudgeMs}
                    travelMs={p.travelMs}
                    winCells={winCells}
                    reducedMotion={reducedMotion}
                  />
                )
              })}
            </div>

            {/* glass + scanlines over the drums */}
            <div
              className="pointer-events-none absolute inset-0"
              style={{
                background:
                  'linear-gradient(180deg, rgba(255,255,255,.10) 0%, transparent 22%, transparent 74%, rgba(255,255,255,.05) 88%, rgba(0,0,0,.55) 100%)',
                boxShadow: 'inset 0 0 60px rgba(0,0,0,.75), inset 0 0 0 1px rgba(255,255,255,.06)',
              }}
            />
            {/* moving specular sheen while spinning */}
            {spinning && (
              <div
                className="pointer-events-none absolute inset-0 animate-shimmer"
                style={{
                  background:
                    'linear-gradient(105deg, transparent 30%, rgba(198,242,78,.10) 45%, rgba(255,255,255,.16) 50%, rgba(198,242,78,.10) 55%, transparent 70%)',
                  backgroundSize: '300% 100%',
                }}
              />
            )}
          </div>
        </div>
      </div>

      {/* cabinet feet */}
      <div className="mx-auto flex w-[86%] justify-between px-2">
        <span className="h-2 w-10 rounded-b-[6px] bg-gradient-to-b from-[#1b2a1e] to-transparent" />
        <span className="h-2 w-10 rounded-b-[6px] bg-gradient-to-b from-[#1b2a1e] to-transparent" />
      </div>
    </div>
  )
}
