import React, { useEffect, useMemo, useRef, useState } from 'react'
import type { SlotConfig, SlotSymbolDef, Grid } from '../lib/slots/engine'

/**
 * Generic 3D ways-slot board for the engine games.
 *
 * Same reel geometry as Bonni & Clyve (each row offset by face + gap so faces
 * never overlap), but symbols are drawn from a SlotSymbolDef so any game can
 * render without bespoke art.
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
          className="h-full w-full select-none object-cover"
        />
        {/* glass sheen so portraits sit in the same lighting as the tiles */}
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
      {/* bevel ring */}
      <span
        className="pointer-events-none absolute inset-[6%] rounded-[18%]"
        style={{
          border: `1px solid ${c}44`,
          boxShadow: `inset 0 1px 0 ${c}55, 0 0 14px -4px ${c}77`,
        }}
      />
      {/* specular streak */}
      <span
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'linear-gradient(145deg, rgba(255,255,255,.20) 0%, rgba(255,255,255,.04) 18%, transparent 40%)',
        }}
      />
      {/* embossed glyph, with a 3D drop shadow and a lit top edge */}
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
      {/* bottom contact shadow gives the tile physical depth */}
      <span
        className="pointer-events-none absolute inset-x-0 bottom-0"
        style={{
          height: '26%',
          background: 'linear-gradient(to top, rgba(0,0,0,.55), transparent)',
        }}
      />
    </span>
  )
}

function Reel({
  col, face, gap, spinning, delay, winCells, reel,
}: {
  col: { id: string }[]
  face: number
  gap: number
  spinning: boolean
  delay: number
  winCells: Set<string>
  reel: number
}) {
  const [offset, setOffset] = useState(0)
  const [settling, setSettling] = useState(false)

  useEffect(() => {
    if (!spinning) return
    setSettling(false)
    let hops = 0
    let t = 0
    const hop = () => {
      setOffset((o) => o + 1)
      hops++
      if (hops < 12) t = window.setTimeout(hop, 55 + hops * 7)
      else {
        setSettling(true)
        setOffset((o) => o + 1)
      }
    }
    t = window.setTimeout(hop, 20 + delay)
    return () => window.clearTimeout(t)
  }, [spinning, delay])

  const step = face + gap
  const stackH = face * col.length + gap * (col.length - 1)

  return (
    <div className="relative h-full flex-1" aria-hidden>
      <div
        className="absolute left-0 right-0 top-1/2"
        style={{ height: stackH, marginTop: -stackH / 2 }}
      >
        {col.map((cell, k) => (
          <div
            key={`${reel}-${k}-${cell.id}-${offset}`}
            className="absolute left-0 right-0 grid place-items-center overflow-hidden rounded-[16%] border border-white/10"
            style={{
              height: face,
              top: k * step,
              transform: `translateY(${settling ? 0 : 0}px)`,
              transition: settling ? `transform ${700 + delay}ms cubic-bezier(.16,.84,.2,1)` : 'none',
              background:
                'linear-gradient(180deg, rgba(38,46,66,.96) 0%, rgba(22,27,41,.98) 55%, rgba(15,19,30,1) 100%)',
              boxShadow:
                'inset 0 1px 0 rgba(255,255,255,.12), inset 0 -10px 16px -12px rgba(0,0,0,.9), 0 2px 6px -3px rgba(0,0,0,.7)',
            }}
          >
            <SymbolFace sym={cell as unknown as SlotSymbolDef} face={face} />
            {winCells.has(`${reel}-${k}`) && (
              <span className="pointer-events-none absolute inset-0 rounded-[16%] bg-[radial-gradient(circle,rgba(198,242,78,.34),transparent_70%)] ring-2 ring-inset ring-neon-lime/70" />
            )}
          </div>
        ))}
      </div>
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
            <div
              ref={wrap}
              className="flex w-full"
              style={{ gap: `${gap}px`, height: `${boardH}px` }}
            >
              {board.map((col, reel) => (
                <Reel
                  key={reel}
                  reel={reel}
                  col={col.map((c) => ({ ...c, ...symById[c.id] }))}
                  face={face}
                  gap={gap}
                  spinning={spinning}
                  delay={reel * 90}
                  winCells={winCells}
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
