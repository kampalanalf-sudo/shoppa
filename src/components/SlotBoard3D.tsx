import React, { useEffect, useMemo, useRef, useState } from 'react'
import type { SlotConfig, SlotSymbolDef, Grid } from '../lib/slots/engine'
import { buildStrip, offsetAt, stopTimes, totalSpinMs, frameScale } from '../lib/reels'

/**
 * Generic 3D ways-slot board for the engine games.
 *
 * Spin motion is driven by ONE requestAnimationFrame loop for the whole board,
 * writing a transform straight onto each strip. Deliberately not React state
 * per frame: five reels re-rendering at 60fps would drop frames on a mid-range
 * Android, and a slot that stutters is worse than one that spins slower.
 */

/**
 * Deep-3D symbol tile.
 *
 * Portraits use generated art. Everything else is drawn as a layered vector
 * tile: bevelled edge, radial body gradient, specular streak, inset shadow and
 * an embossed glyph. Flat emoji alone read cheap next to the portraits, which
 * is what made the board look empty.
 */
export function SymbolFace({ sym, face }: { sym: SlotSymbolDef; face: number }) {
  if (sym.art) {
    return (
      <span className="relative h-full w-full">
        <img
          src={sym.art}
          alt={sym.name}
          draggable={false}
          // The strip moves under this image; decoding async keeps the first
          // frame from blocking while 15 portraits decode.
          decoding="async"
          className="h-full w-full select-none object-cover"
        />
        <span
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'linear-gradient(150deg, rgba(255,255,255,.22) 0%, rgba(255,255,255,.05) 26%, transparent 48%)',
          }}
        />
      </span>
    )
  }

  const c = sym.color
  return (
    <span
      className="relative grid h-full w-full place-items-center overflow-hidden"
      style={{
        background: [
          `radial-gradient(120% 90% at 50% 18%, ${c}55 0%, ${c}22 38%, transparent 72%)`,
          'linear-gradient(170deg, #2a3245 0%, #1a2132 46%, #101724 100%)',
        ].join(','),
        boxShadow: [
          'inset 0 2px 0 rgba(255,255,255,.16)',
          'inset 0 -6px 12px -6px rgba(0,0,0,.9)',
          `inset 0 0 22px -8px ${c}88`,
        ].join(','),
      }}
    >
      <span
        className="pointer-events-none absolute inset-[6%] rounded-[18%]"
        style={{
          border: `1px solid ${c}44`,
          boxShadow: `inset 0 1px 0 ${c}55, 0 0 14px -4px ${c}77`,
        }}
      />
      <span
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'linear-gradient(145deg, rgba(255,255,255,.20) 0%, rgba(255,255,255,.04) 18%, transparent 40%)',
        }}
      />
      <span
        className="relative select-none"
        style={{
          fontSize: face * 0.46,
          lineHeight: 1,
          filter: `drop-shadow(0 4px 5px rgba(0,0,0,.75)) drop-shadow(0 0 10px ${c}66)`,
          textShadow: `0 1px 0 ${c}aa, 0 -1px 0 rgba(0,0,0,.6)`,
        }}
      >
        {sym.glyph}
      </span>
      <span
        className="pointer-events-none absolute inset-x-0 bottom-0"
        style={{ height: '26%', background: 'linear-gradient(to top, rgba(0,0,0,.55), transparent)' }}
      />
    </span>
  )
}

type ReelProps = {
  reel: number
  target: string[]
  pool: string[]
  symById: Record<string, SlotSymbolDef>
  face: number
  gap: number
  /** bump this to start a spin */
  spinToken: number
  /** ms from spin start until this reel stops */
  stopMs: number
  /** total spin length, so the settle can be positioned */
  totalMs: number
  winCells: Set<string>
  reducedMotion: boolean
  /** the board's spin state, so the first frame is already in motion */
  boardSpinning: boolean
}

/**
 * One drum.
 *
 * During the spin the strip is translated by a rAF-driven offset and slightly
 * blurred in the direction of travel, which is what sells speed. On stop the
 * blur drops to zero and the strip lands exactly on its window.
 */
function Reel({
  reel, target, pool, symById, face, gap, spinToken, stopMs, totalMs, winCells,
  reducedMotion, boardSpinning,
}: ReelProps) {
  const strip = useRef<HTMLDivElement>(null)
  const [spinning, setSpinning] = useState(false)
  const step = face + gap

  const { cells, height, landing } = useMemo(() => {
    const s = buildStrip(target, pool, step)
    return { cells: s.cells, height: s.height, landing: s.height - target.length * step }
  }, [target, pool, step])

  useEffect(() => {
    if (spinToken === 0) return
    const el = strip.current
    if (!el) return

    // Reduced motion: land immediately, no travel. Still communicate the spin
    // by the win highlight afterwards.
    if (reducedMotion) {
      el.style.transform = `translate3d(0,${-landing}px,0)`
      setSpinning(false)
      return
    }

    setSpinning(true)
    const start = performance.now()
    let raf = 0
    let done = false

    const tick = (now: number) => {
      const t = now - start
      const off = offsetAt(t, totalMs, landing)
      el.style.transform = `translate3d(0,${-off}px,0)`

      if (t >= stopMs && !done) {
        // land exactly, kill the blur, and stop this reel's loop
        done = true
        el.style.transform = `translate3d(0,${-landing}px,0)`
        setSpinning(false)
        return
      }
      raf = requestAnimationFrame(tick)
    }

    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [spinToken, stopMs, totalMs, landing, reducedMotion])

  return (
    <div className="relative h-full flex-1 overflow-hidden" aria-hidden>
      <div
        ref={strip}
        className="absolute left-0 right-0 top-0 will-change-transform"
        style={{
          height,
          transform: `translate3d(0,${-landing}px,0)`,
          // A blur only while moving. `backface-visibility` keeps the layer
          // promoted so the transform stays on the compositor.
          filter: (spinning || (boardSpinning && !reducedMotion)) ? 'blur(1.1px)' : 'none',
          backfaceVisibility: 'hidden',
          // Motion blur is a function of speed; the animation is ease-out so a
          // constant blur is a fair approximation and far cheaper than tracking
          // velocity every frame.
          transition: 'filter 120ms linear',
        }}
      >
        {cells.map((cell) => {
          const sym = symById[cell.symId]
          if (!sym) return null
          return (
            <div
              key={cell.index}
              className="absolute left-0 right-0 grid place-items-center overflow-hidden rounded-[16%] border border-white/10"
              style={{
                height: face,
                top: cell.y,
                background:
                  'linear-gradient(180deg, rgba(38,46,66,.96) 0%, rgba(22,27,41,.98) 55%, rgba(15,19,30,1) 100%)',
                boxShadow:
                  'inset 0 1px 0 rgba(255,255,255,.12), inset 0 -10px 16px -12px rgba(0,0,0,.9), 0 2px 6px -3px rgba(0,0,0,.7)',
              }}
            >
              <SymbolFace sym={sym} face={face} />
            </div>
          )
        })}
      </div>

      {/* win highlight is drawn as a fixed overlay so it cannot scroll away */}
      {!spinning &&
        target.map((_, row) =>
          winCells.has(`${reel}-${row}`) ? (
            <span
              key={row}
              className="pointer-events-none absolute left-0 right-0 rounded-[16%] bg-[radial-gradient(circle,rgba(198,242,78,.34),transparent_70%)] ring-2 ring-inset ring-neon-lime/70"
              style={{ top: row * step, height: face }}
            />
          ) : null,
        )}
    </div>
  )
}

export type SlotBoard3DProps = {
  config: SlotConfig
  grid: Grid | null
  spinning: boolean
  winCells: Set<string>
  glow?: 'none' | 'win' | 'omen' | 'free'
  className?: string
}

export function SlotBoard3D({
  config, grid, spinning, winCells, glow = 'none', className = '',
}: SlotBoard3DProps) {
  const symById = useMemo(() => {
    const m: Record<string, SlotSymbolDef> = {}
    for (const s of config.symbols) m[s.id] = s
    return m
  }, [config])

  const pool = useMemo(() => config.symbols.map((s) => s.id), [config])

  const fallback = useMemo<Grid>(
    () =>
      Array.from({ length: config.reels }, (_, reel) =>
        Array.from({ length: config.rows }, (_, row) => ({
          id: config.symbols[(reel * 3 + row) % config.symbols.length].id,
          reel,
          row,
        })),
      ),
    [config],
  )

  const board = grid ?? fallback

  // Per-reel landing symbols. Held across the spin so the strip does not
  // reshuffle mid-flight: the result must be committed before the reels start,
  // which is also what makes the outcome honest.
  const [targets, setTargets] = useState<string[][]>(() => board.map((col) => col.map((c) => c.id)))
  useEffect(() => {
    setTargets(board.map((col) => col.map((c) => c.id)))
    // board identity changes once per spin
  }, [board])

  const [face, setFace] = useState(56)
  const [gap, setGap] = useState(3)
  const wrap = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const measure = () => {
      const el = wrap.current
      if (!el) return
      const rowW = el.clientWidth || 0
      if (rowW <= 0) return
      const g = rowW < 420 ? 3 : 5
      const f = Math.max(28, Math.min(140, Math.floor((rowW - g * (config.reels - 1)) / config.reels)))
      setGap(g)
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
  }, [config.reels])

  // Reduced motion: the OS setting is a real accessibility need, and a screen
  // that spins at speed for some players is unpleasant or worse.
  const reducedMotion = useMemo(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  }, [])

  const scale = frameScale(config.reels, config.rows)
  const stops = useMemo(
    () => stopTimes(config.reels).map((ms) => Math.round(ms * scale)),
    [config.reels, scale],
  )
  const totalMs = useMemo(() => Math.round(totalSpinMs(config.reels) * scale), [config.reels, scale])

  // A spin is identified by a monotonically increasing token so a reel can
  // restart even if it was already at rest.
  const [spinToken, setSpinToken] = useState(0)
  const wasSpinning = useRef(false)
  useEffect(() => {
    if (spinning && !wasSpinning.current) {
      wasSpinning.current = true
      setSpinToken((n) => n + 1)
    } else if (!spinning && wasSpinning.current) {
      wasSpinning.current = false
    }
  }, [spinning])

  const boardH = face * config.rows + gap * (config.rows - 1)

  const glowBg =
    glow === 'omen'
      ? 'radial-gradient(circle at 50% 50%, rgba(255,92,120,.30), transparent 70%)'
      : glow === 'free'
        ? 'radial-gradient(circle at 50% 50%, rgba(58,215,255,.22), transparent 70%)'
        : 'radial-gradient(circle at 50% 50%, rgba(198,242,78,.18), transparent 70%)'

  return (
    <div className={`relative ${className}`}>
      <div
        className="relative rounded-[16px] p-[5px] sm:rounded-[24px] sm:p-[12px]"
        style={{
          background: 'linear-gradient(160deg,#2b3b2c 0%,#16241c 30%,#0d1612 70%,#22301f 100%)',
          boxShadow:
            '0 0 0 1px rgba(255,255,255,.10), 0 0 0 5px rgba(18,26,20,.9), 0 0 0 6px rgba(198,242,78,.16), 0 34px 70px -40px #000',
        }}
      >
        <div
          className="relative overflow-hidden rounded-[12px] sm:rounded-[18px]"
          style={{
            background: 'linear-gradient(180deg,#0a0f14 0%,#070b10 100%)',
            boxShadow: 'inset 0 0 0 1px rgba(198,242,78,.18), inset 0 18px 40px -20px rgba(0,0,0,.95)',
          }}
        >
          {glow !== 'none' && (
            <div className="pointer-events-none absolute inset-0 z-20 rounded-[12px]" style={{ background: glowBg }} />
          )}

          <div className="relative px-1 py-1 sm:px-3 sm:py-3">
            <div ref={wrap} className="flex w-full" style={{ gap: `${gap}px`, height: `${boardH}px` }}>
              {targets.map((target, reel) => (
                <Reel
                  key={reel}
                  reel={reel}
                  target={target}
                  pool={pool}
                  symById={symById}
                  face={face}
                  gap={gap}
                  spinToken={spinToken}
                  stopMs={stops[reel] ?? totalMs}
                  totalMs={totalMs}
                  winCells={winCells}
                  reducedMotion={reducedMotion}
                  boardSpinning={spinning}
                />
              ))}
            </div>

            {/* glass + scanlines */}
            <div
              className="pointer-events-none absolute inset-0"
              style={{
                background:
                  'linear-gradient(180deg, rgba(255,255,255,.10) 0%, transparent 22%, transparent 74%, rgba(255,255,255,.05) 88%, rgba(0,0,0,.55) 100%)',
                boxShadow: 'inset 0 0 60px rgba(0,0,0,.75), inset 0 0 0 1px rgba(255,255,255,.06)',
              }}
            />
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
    </div>
  )
}
