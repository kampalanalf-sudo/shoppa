import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../lib/store'
import { sfx } from '../lib/sound'
import { money, mult } from '../lib/format'
import { gameById } from '../lib/games'
import { BetAmount, BetButton, useHotkey } from '../components/BetControls'
import { GameShell, PayoutRow } from '../components/GameShell'
import { IconShield } from '../components/Icons'

/**
 * Paytables are generated so that Σ P(bucket) × multiplier = 99% for every
 * (risk, rows) pair. Bucket k is reached with probability C(rows,k)/2^rows.
 */
const TABLES = {
  low: {
    label: 'Low',
    rows: {
      8: [2.02, 1.33, 1.05, 0.94, 0.91, 0.94, 1.05, 1.33, 2.02],
      12: [2.09, 1.55, 1.25, 1.08, 0.99, 0.96, 0.94, 0.96, 0.99, 1.08, 1.25, 1.55, 2.09],
      16: [2.12, 1.68, 1.4, 1.21, 1.1, 1.02, 0.98, 0.97, 0.96, 0.97, 0.98, 1.02, 1.1, 1.21, 1.4, 1.68, 2.12],
    } as Record<number, number[]>,
  },
  medium: {
    label: 'Medium',
    rows: {
      8: [10.14, 3.18, 1.27, 0.67, 0.52, 0.67, 1.27, 3.18, 10.14],
      12: [15.47, 6.56, 3.11, 1.67, 1.02, 0.72, 0.62, 0.72, 1.02, 1.67, 3.11, 6.56, 15.47],
      16: [20.52, 10.29, 5.51, 3.16, 1.95, 1.3, 0.94, 0.76, 0.68, 0.76, 0.94, 1.3, 1.95, 3.16, 5.51, 10.29, 20.52],
    } as Record<number, number[]>,
  },
  high: {
    label: 'High',
    rows: {
      8: [23.01, 4.93, 1.25, 0.4, 0.2, 0.4, 1.25, 4.93, 23.01],
      12: [69.35, 19.98, 6.26, 2.17, 0.84, 0.38, 0.24, 0.38, 0.84, 2.17, 6.26, 19.98, 69.35],
      16: [166.75, 58.71, 21.6, 8.34, 3.41, 1.49, 0.7, 0.37, 0.24, 0.37, 0.7, 1.49, 3.41, 8.34, 21.6, 58.71, 166.75],
    } as Record<number, number[]>,
  },
}

const binom = (n: number, k: number) => {
  let r = 1
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i
  return r
}

/** Exact table RTP under the binomial bucket distribution. */
export const tableRtp = (t: number[]) =>
  t.reduce((acc, m, k) => acc + (binom(t.length - 1, k) / 2 ** (t.length - 1)) * m, 0)

type Risk = keyof typeof TABLES
type Ball = { id: number; path: number[]; bucket: number; mult: number; wager: number }

const W = 620
const H = 330

export function Plinko({ onBack, onFair }: { onBack: () => void; onFair: () => void }) {
  const game = gameById('plinko')!
  const { placeBet, settleBet, nextFloats, balance, sound, flashLoss } = useStore()
  const [risk, setRisk] = useState<Risk>('medium')
  const [rows, setRows] = useState(12)
  const [bet, setBet] = useState(10)
  const [balls, setBalls] = useState<Ball[]>([])
  const [auto, setAuto] = useState(false)
  const [last, setLast] = useState<{ mult: number; payout: number } | null>(null)
  const idRef = useRef(0)

  const table = TABLES[risk].rows[rows]
  const stepX = W / (table.length + 1)
  const stepY = (H - 40) / rows

  const geometry = useMemo(() => {
    const pegs: { x: number; y: number; row: number }[] = []
    for (let r = 1; r <= rows; r++) {
      const count = r + 1
      for (let c = 0; c < count; c++) {
        pegs.push({ x: W / 2 + (c - r / 2) * stepX, y: 28 + (r - 1) * stepY, row: r })
      }
    }
    return pegs
  }, [rows, stepX, stepY])

  const drop = useCallback(async () => {
    if (bet > balance) {
      return
    }
    if (!placeBet('plinko', bet)) return
    sfx.place()
    const [u] = await nextFloats(1)
    // derive a Bernoulli path from the float's bits for visual variety
    const path: number[] = []
    let bits = u
    for (let i = 0; i < rows; i++) {
      bits = bits * 2
      path.push(bits >= 1 ? 1 : 0)
      if (bits >= 1) bits -= 1
    }
    const total = path.reduce((a, b) => a + b, 0)
    // Rejection-free unbiased mapping: the path sum is the bucket index.
    const bucket = Math.max(0, Math.min(table.length - 1, total))
    const id = ++idRef.current
    setBalls((b) => [...b.slice(-40), { id, path, bucket, mult: table[bucket], wager: bet }])
  }, [bet, balance, placeBet, nextFloats, rows, table])

  // resolve a ball once it lands (kept out of the state updater so React's
  // double-invocation in dev can never settle the same ball twice)
  const landedRef = useRef(new Set<number>())
  const ballsRef = useRef<Ball[]>([])
  ballsRef.current = balls

  const land = useCallback(
    (ballId: number) => {
      if (landedRef.current.has(ballId)) return
      const ball = ballsRef.current.find((b) => b.id === ballId)
      if (!ball) return
      landedRef.current.add(ballId)
      const payout = settleBet({
        game: 'plinko',
        wager: ball.wager,
        multiplier: ball.mult,
        detail: `${rows} rows · ${TABLES[risk].label} risk · ${mult(ball.mult)}`,
      })
      setLast({ mult: ball.mult, payout })
      if (sound) {
        if (ball.mult >= 1) sfx.win()
        else sfx.lose()
      }
      if (ball.mult < 1) {
        flashLoss()
      }
      setBalls((prev) => prev.filter((b) => b.id !== ballId))
    },
    [settleBet, rows, risk, sound, flashLoss],
  )

  useHotkey(drop)

  // autoplay
  useEffect(() => {
    if (!auto) return
    const iv = window.setInterval(() => void drop(), 700)
    return () => window.clearInterval(iv)
  }, [auto, drop])

  const reset = () => {
    setBalls([])
    setAuto(false)
  }

  return (
    <GameShell
      game={game}
      onBack={onBack}
      onFair={onFair}
      aside={
        <div className="space-y-3.5">
          <BetAmount value={bet} onChange={setBet} />
          <div>
            <span className="label">Risk</span>
            <div className="grid grid-cols-3 gap-1 rounded-xl bg-ink-900/80 p-1">
              {(Object.keys(TABLES) as Risk[]).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => { setRisk(r); sfx.click() }}
                  className={`rounded-lg py-1.5 text-[11.5px] font-bold transition ${
                    risk === r ? 'bg-white/[0.09] text-white' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {TABLES[r].label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <span className="label">Rows</span>
            <div className="grid grid-cols-3 gap-1 rounded-xl bg-ink-900/80 p-1">
              {[8, 12, 16].map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => { setRows(r); reset(); sfx.click() }}
                  className={`rounded-lg py-1.5 text-[11.5px] font-bold transition ${
                    rows === r ? 'bg-white/[0.09] text-white' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
          <BetButton onClick={() => void drop()} sub={`Max win ${mult(Math.max(...table))}`}>Drop ball</BetButton>
          <div className="flex items-center justify-between rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2">
            <span className="text-[11.5px] font-semibold text-slate-400">Auto drop</span>
            <button
              type="button"
              role="switch"
              aria-checked={auto}
              onClick={() => { setAuto((v) => !v); sfx.click() }}
              className={`relative h-5 w-9 rounded-full transition ${auto ? 'bg-neon-lime' : 'bg-white/15'}`}
            >
              <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${auto ? 'left-[18px]' : 'left-0.5'}`} />
            </button>
          </div>
          {last && (
            <div className={`animate-popIn rounded-xl border px-3 py-2 text-center ${last.mult >= 1 ? 'border-neon-lime/30 bg-neon-lime/10' : 'border-white/[0.07] bg-white/[0.02]'}`}>
              <p className="text-[10px] uppercase tracking-wider text-slate-500">Last drop</p>
              <p className={`num text-lg font-black ${last.mult >= 1 ? 'text-neon-lime' : 'text-slate-400'}`}>{mult(last.mult)}</p>
              <p className="num text-[11px] text-slate-400">{money(last.payout)} FB</p>
            </div>
          )}
          <div className="space-y-1.5">
            <PayoutRow label="Live table RTP" value={`${(tableRtp(table) * 100).toFixed(2)}%`} highlight />
            <PayoutRow label="Buckets" value={`${table.length}`} />
          </div>
        </div>
      }
      mobileAction={
        <div className="flex items-center gap-1.5">
          <div className="flex items-center gap-1 rounded-xl border border-white/10 bg-ink-900/90 px-2">
            <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500">Bet</span>
            <input
              inputMode="decimal"
              value={bet}
              onChange={(e) => setBet(Math.max(0, parseFloat(e.target.value.replace(/[^0-9.]/g, '')) || 0))}
              className="num w-16 bg-transparent py-2 text-center text-[13px] font-bold text-white focus:outline-none"
            />
            <span className="text-[9px] font-bold text-neon-lime/70">FB</span>
          </div>
          <button type="button" onClick={() => void drop()} className="btn-primary h-10 flex-1 !text-[13px]">
            Drop {mult(Math.max(...table))}
          </button>
        </div>
      }
    >
      <div className="flex items-center justify-between px-1 pb-2">
        <span className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[.14em] text-slate-500">
          <IconShield size={12} className="text-emerald-400" /> Provably fair · seeded
        </span>
        <span className="num text-[10.5px] text-slate-500">{rows} rows · {TABLES[risk].label} risk</span>
      </div>
      <LiveDrops />

      <div className="relative mx-auto w-full max-w-[680px]">
        <svg viewBox={`0 0 ${W} ${H + 46}`} className="w-full select-none" role="img" aria-label="Plinko board">
          <defs>
            <radialGradient id="ballGrad" cx="35%" cy="30%">
              <stop offset="0" stopColor="#f4ffd1" />
              <stop offset="0.45" stopColor="#c6f24e" />
              <stop offset="1" stopColor="#7dd31c" />
            </radialGradient>
            <radialGradient id="pegGrad" cx="34%" cy="28%">
              <stop offset="0" stopColor="#ffffff" />
              <stop offset="0.4" stopColor="#dfe7f5" />
              <stop offset="0.75" stopColor="#8b97ae" />
              <stop offset="1" stopColor="#4d5668" />
            </radialGradient>
            <radialGradient id="pegHalo" cx="50%" cy="50%">
              <stop offset="0" stopColor="#c6f24e" stopOpacity="0.5" />
              <stop offset="1" stopColor="#c6f24e" stopOpacity="0" />
            </radialGradient>
            <filter id="pegShadow" x="-60%" y="-60%" width="220%" height="220%">
              <feDropShadow dx="0" dy="1.4" stdDeviation="1.1" floodColor="#000" floodOpacity="0.55" />
            </filter>
            <filter id="ballShadow" x="-70%" y="-70%" width="240%" height="240%">
              <feDropShadow dx="0" dy="3" stdDeviation="2.4" floodColor="#000" floodOpacity="0.5" />
            </filter>
            {table.map((m, i) => (
              <linearGradient key={i} id={`bk${i}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={bucketColor(i, table.length, 1)} />
                <stop offset="1" stopColor={bucketColor(i, table.length, 0.62)} />
              </linearGradient>
            ))}
          </defs>

          {geometry.map((p, i) => (
            <circle key={`s${i}`} cx={p.x + 0.5} cy={p.y + 1.6} r={2.4} fill="#000" opacity={0.4} />
          ))}
          {geometry.map((p, i) => (
            <g key={i} filter="url(#pegShadow)">
              <circle cx={p.x} cy={p.y} r={4.6} fill="url(#pegHalo)" />
              <circle cx={p.x} cy={p.y} r={2.6} fill="url(#pegGrad)" />
              <circle cx={p.x - 0.75} cy={p.y - 0.85} r={0.62} fill="#fff" opacity={0.95} />
            </g>
          ))}

          {/* buckets */}
          {table.map((m, i) => {
            const x = W / 2 + (i - (table.length - 1) / 2) * stepX
            const y = 28 + rows * stepY + 6
            return (
              <g key={i}>
                <rect
                  x={x - stepX * 0.42}
                  y={y}
                  width={stepX * 0.84}
                  height={30}
                  rx={6}
                  fill={`url(#bk${i})`}
                  stroke="rgba(255,255,255,.35)"
                  strokeWidth={0.9}
                />
                {/* glossy top edge for a moulded-plastic look */}
                <rect
                  x={x - stepX * 0.42 + 1.4}
                  y={y + 1.4}
                  width={stepX * 0.84 - 2.8}
                  height={5}
                  rx={3}
                  fill="#fff"
                  opacity={0.22}
                />
                <text
                  x={x}
                  y={y + 19}
                  textAnchor="middle"
                  fontSize={stepX < 34 ? 8.5 : 10}
                  fontWeight={800}
                  fill="#0b0d15"
                  fontFamily="JetBrains Mono, monospace"
                >
                  {m >= 100 ? `${m}×` : `${m}×`}
                </text>
              </g>
            )
          })}

          {balls.map((b) => (
            <PlinkoBall
              key={b.id}
              ball={b}
              rows={rows}
              stepX={stepX}
              stepY={stepY}
              onLand={land}
            />
          ))}
        </svg>
      </div>

      <p className="mt-1 text-center text-[10px] text-slate-600">
        Space to drop · switch risk & rows to reshape the payout curve
      </p>
    </GameShell>
  )
}

/** Anonymised live-drops strip (mimics the social feed on BC.Game). */
function LiveDrops() {
  const drops = useMemo(
    () =>
      Array.from({ length: 12 }, (_, i) => {
        const r = Math.abs(Math.sin(i * 12.9898) * 43758.5453) % 1
        const m = r > 0.94 ? 20.5 : r > 0.82 ? 5.4 : r > 0.55 ? 1.9 : 0.5
        return { user: ['kd', 'zm', 'nu', 'ak', 'jr', 'to', 'ef', 'mw', 'sl', 'bb', 'cy', 'dn'][i], m }
      }),
    [],
  )
  return (
    <div className="mb-2 flex items-center gap-1.5 overflow-hidden">
      <span className="shrink-0 text-[9.5px] font-bold uppercase tracking-[.16em] text-slate-600">Live</span>
      <div className="flex min-w-0 flex-1 gap-1 overflow-hidden">
        {drops.map((d, i) => (
          <span
            key={i}
            className={`num shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-bold ${
              d.m >= 10 ? 'bg-neon-violet/20 text-neon-violet' : d.m >= 2 ? 'bg-neon-lime/15 text-neon-lime' : 'bg-white/[0.05] text-slate-500'
            }`}
          >
            {d.user} {d.m}×
          </span>
        ))}
      </div>
    </div>
  )
}

function bucketColor(i: number, len: number, alpha: number) {
  const edge = Math.abs(i - (len - 1) / 2) / ((len - 1) / 2)
  const r = Math.round(198 - edge * 90)
  const g = Math.round(242 - edge * 30)
  const b = Math.round(78 + edge * 120)
  return `rgba(${Math.max(40, r)},${Math.max(60, g)},${Math.min(255, b)},${alpha})`
}

function PlinkoBall({
  ball, rows, stepX, stepY, onLand,
}: {
  ball: Ball
  rows: number
  stepX: number
  stepY: number
  onLand: (id: number) => void
}) {
  const [pos, setPos] = useState({ x: W / 2, y: 6 })
  const soundRef = useRef(false)
  const { sound } = useStore()

  useEffect(() => {
    let row = 0
    let offset = 0
    let timer: number
    const tick = () => {
      if (row >= rows) {
        onLand(ball.id)
        return
      }
      offset += ball.path[row]
      const x = W / 2 + (offset - row / 2) * stepX
      const y = 28 + row * stepY
      setPos({ x, y })
      row++
      if (sound) sfx.peg(offset + row)
      timer = window.setTimeout(tick, Math.max(38, 92 - row * 3))
    }
    timer = window.setTimeout(tick, 60)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <g>
      {/* cast shadow on the board */}
      <ellipse cx={pos.x + 1.6} cy={pos.y + 5.2} rx={5.6} ry={2.4} fill="#000" opacity={0.4} />
      <g filter="url(#ballShadow)">
        <circle cx={pos.x} cy={pos.y} r={6.4} fill="url(#ballGrad)" />
      </g>
      {/* rim light + specular highlight make it read as a sphere */}
      <circle cx={pos.x} cy={pos.y} r={6.4} fill="none" stroke="#f4ffd1" strokeWidth={0.9} opacity={0.55} />
      <ellipse cx={pos.x - 2.2} cy={pos.y - 2.4} rx={2.1} ry={1.6} fill="#ffffff" opacity={0.8} transform={`rotate(-28 ${pos.x - 2.2} ${pos.y - 2.4})`} />
      <circle cx={pos.x + 1.8} cy={pos.y + 2.2} r={1.2} fill="#7dd31c" opacity={0.5} />
    </g>
  )
}
