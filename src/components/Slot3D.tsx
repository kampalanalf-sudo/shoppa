import React, { useEffect, useMemo, useRef, useState } from 'react'
import { SYMBOLS, type Cell, type Grid, type SymbolId } from '../lib/slot'

/* ------------------------------------------------------------------ helpers */

const STRIP_LEN = 24

/** Deterministic-ish filler so reels look like a real strip before the spin. */
function fillStrip(seed: number): SymbolId[] {
  const pool: SymbolId[] = [
    'donut', 'key', 'cash', 'badge', 'diamond', 'donut', 'key',
    'cash', 'clyve', 'bonita', 'donut', 'key', 'badge',
    'cash', 'diamond', 'donut', 'key', 'clyve', 'bonita', 'wild',
    'donut', 'cash', 'scatter', 'key',
  ]
  return Array.from({ length: STRIP_LEN }, (_, i) => pool[(i + seed * 5) % pool.length])
}

/* ------------------------------------------------------------------ Siren (SVG) */

export function Siren({ size = 64, lit = false }: { size?: number; lit?: boolean }) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} className="drop-shadow-[0_0_18px_rgba(198,242,78,.55)]">
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
        <Siren size={92} lit />
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
    <span className={`relative grid place-items-center ${className}`}>
      <span className="absolute inset-[12%] rounded-full bg-[radial-gradient(circle,rgba(255,255,255,.14),transparent_70%)]" />
      <img
        src={meta.art}
        alt={meta.name}
        draggable={false}
        loading={priority ? 'eager' : 'lazy'}
        className="relative h-full w-full select-none object-contain drop-shadow-[0_6px_14px_rgba(0,0,0,.55)]"
      />
    </span>
  )
}

/* ------------------------------------------------------------------ 3D reel drum */

type ReelProps = {
  reel: number
  target: SymbolId[]
  spinning: boolean
  stopping: boolean
  highlight: boolean[]
  winCells: Set<string>
  delay: number
  /** css length of one face */
  face: number
  gap: number
  onSettled?: () => void
}

function Reel({ reel, target, spinning, stopping, highlight, winCells, delay, face, gap }: ReelProps) {
  const strip = useMemo(() => {
    const filler = fillStrip(reel + 3)
    // final 3 faces of the strip are always the landed symbols
    return [...filler.slice(0, STRIP_LEN - 3), ...target]
  }, [reel, target.join(',')])

  const [index, setIndex] = useState(strip.length - 3)
  const [transitioning, setTransitioning] = useState(false)
  const timeout = useRef<number>(0)

  // spin: jump repeatedly, then settle with a long eased transition
  useEffect(() => {
    if (!spinning) return
    setTransitioning(false)
    setIndex(strip.length - 3)
    let hops = 0
    const hop = () => {
      setIndex((i) => (i + 3) % strip.length)
      hops++
      if (hops < 14) {
        timeout.current = window.setTimeout(hop, 55 + hops * 6)
      } else {
        // settle
        setTransitioning(true)
        setIndex(strip.length - 3)
      }
    }
    timeout.current = window.setTimeout(hop, 20)
    return () => window.clearTimeout(timeout.current)
  }, [spinning, strip.length])

  const visible: { id: SymbolId; pos: number }[] = useMemo(() => {
    const out: { id: SymbolId; pos: number }[] = []
    for (let k = 0; k < 3; k++) {
      out.push({ id: strip[(index + k) % strip.length], pos: k - 1 })
    }
    return out
  }, [strip, index])

  const radius = (face + gap) / 1.15

  return (
    <div
      className="relative h-full flex-1"
      style={{ perspective: `${face * 3.2}px` }}
      aria-hidden
    >
      <div
        className="absolute inset-0"
        style={{
          transformStyle: 'preserve-3d',
          transform: `translateZ(-${radius}px) rotateX(0deg)`,
          transition: transitioning ? `transform ${900 + delay}ms cubic-bezier(.16,.84,.2,1)` : 'none',
        }}
      >
        {visible.map(({ id, pos }, k) => (
          <div
            key={`${reel}-${k}-${id}-${index}`}
            className="absolute left-0 right-0 grid place-items-center overflow-hidden rounded-[14%] border border-white/10"
            style={{
              height: `${face}px`,
              top: `calc(50% - ${face / 2}px)`,
              transform: `rotateX(${(pos * 180) / Math.PI * 0.62}deg) translateZ(${radius * 0.62}px) scale(0.94)`,
              background:
                'linear-gradient(180deg, rgba(38,46,66,.96) 0%, rgba(22,27,41,.98) 55%, rgba(15,19,30,1) 100%)',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,.10), inset 0 -14px 22px -14px rgba(0,0,0,.9)',
              opacity: k === 1 ? 1 : 0.72,
            }}
          >
            <SymbolFace id={id} priority className="h-[86%] w-[86%]" />
            {winCells.has(`${reel}-${k}`) && (
              <span className="pointer-events-none absolute inset-0 rounded-[14%] bg-[radial-gradient(circle,rgba(198,242,78,.32),transparent_70%)] ring-2 ring-inset ring-neon-lime/70" />
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ Cabinet */

export type Slot3DProps = {
  grid: Grid | null
  spinning: boolean
  stopping: boolean
  onSettled?: () => void
  winCells: Set<string>
  glow?: 'none' | 'win' | 'bigwin' | 'chase'
  className?: string
}

export function Slot3D({ grid, spinning, stopping, winCells, glow = 'none', className = '', onSettled }: Slot3DProps) {
  // fallback board before the first spin
  const fallback = useMemo<Grid>(
    () =>
      [0, 1, 2, 3, 4].map((reel) =>
        [0, 1, 2].map((row) => ({ id: fillStrip(reel + 1)[row + 2], reel, row })),
      ),
    [],
  )
  const board = grid ?? fallback
  const [face, setFace] = useState(92)
  const wrap = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const measure = () => {
      const w = wrap.current?.clientWidth ?? 600
      // 5 reels + gutters, capped so tall screens don't get giant faces
      const f = Math.max(52, Math.min(108, Math.floor((w - 56) / 5 / 1.02)))
      setFace(f)
    }
    measure()
    const ro = new ResizeObserver(measure)
    if (wrap.current) ro.observe(wrap.current)
    return () => ro.disconnect()
  }, [])

  const gap = Math.round(face * 0.12)

  return (
    <div className={`relative ${className}`}>
      {/* cabinet frame */}
      <div
        className="relative rounded-[26px] p-[10px] sm:p-[14px]"
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
          <div ref={wrap} className="relative px-2 py-2 sm:px-3 sm:py-3">
            <div className="flex gap-[3px] sm:gap-[5px]" style={{ perspective: '1200px' }}>
              {[0, 1, 2, 3, 4].map((reel) => (
                <Reel
                  key={reel}
                  reel={reel}
                  target={board[reel].map((c) => c.id)}
                  spinning={spinning}
                  stopping={stopping}
                  highlight={[false, false, false]}
                  winCells={winCells}
                  delay={reel * 110}
                  face={face}
                  gap={gap}
                />
              ))}
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
