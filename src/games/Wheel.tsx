import React, { useCallback, useMemo, useRef, useState } from 'react'
import { useStore } from '../lib/store'
import { sfx } from '../lib/sound'
import { money, mult } from '../lib/format'
import { gameById } from '../lib/games'
import { BetAmount, BetButton, useHotkey } from '../components/BetControls'
import { GameShell, PayoutRow } from '../components/GameShell'
import { MIN_BET } from '../lib/currency'

/**
 * Fortune Wheel — 80 physical slices with an audited layout.
 *
 * The layout and the slice ORDER now come from `_shared/games.ts`, which the
 * server uses to settle. They used to be duplicated here, and a duplicate is a
 * wheel that can pay a multiplier the board never showed. One table, two users.
 * EV = 0.99 exactly (99% RTP).
 */
import { WHEEL_SEGMENTS } from '../../supabase/functions/_shared/games'

const SLICES: number[] = [...WHEEL_SEGMENTS]

const COLOR = (m: number) => {
  if (m === 0) return '#333b50'
  if (m === 0.5) return '#78839d'
  if (m === 1.2) return '#b6ee3f'
  if (m === 1.5) return '#2ee6a8'
  if (m === 2) return '#3ad7ff'
  if (m === 3) return '#a06bff'
  return '#ffcf5c'
}

export const WHEEL_RTP = SLICES.reduce((a, m) => a + m, 0) / SLICES.length

const SEG = 360 / SLICES.length

export function Wheel({ onBack, onFair }: { onBack: () => void; onFair: () => void }) {
  const game = gameById('wheel')!
  const { playGame, balance, sound, toast, flashLoss } = useStore()
  const [bet, setBet] = useState(MIN_BET)
  const [spinning, setSpinning] = useState(false)
  const [angle, setAngle] = useState(0)
  const [last, setLast] = useState<number | null>(null)
  const [history, setHistory] = useState<number[]>([1.2, 0, 2, 1.5, 0.4, 0, 3, 0, 1.2])
  const timer = useRef<number>(0)

  const potential = useMemo(() => Math.round(bet * 5 * 100) / 100, [bet])
  const payoutTable = useMemo(() => {
    const counts = new Map<number, number>()
    for (const m of SLICES) counts.set(m, (counts.get(m) ?? 0) + 1)
    return [...counts.entries()].filter(([m]) => m > 0).sort((a, b) => a[0] - b[0])
  }, [])

  const spin = useCallback(async () => {
    if (spinning) return
    if (!(bet > 0)) return
    if (bet > balance) {
      toast({ kind: 'error', title: 'Insufficient balance', body: 'Lower your bet to continue.' })
      return
    }
    sfx.place()
    setSpinning(true)
    // The player picks nothing and the browser decides nothing: the request is
    // only the stake, and the slice comes back from the server.
    let settled: Awaited<ReturnType<typeof playGame>>
    try {
      settled = await playGame('wheel', bet, {})
    } catch (e) {
      setSpinning(false)
      toast({ kind: 'error', title: 'Bet refused', body: (e as Error).message })
      return
    }
    const idx = Number(settled.payload.index ?? 0)
    const m = settled.multiplier
    const targetCenter = idx * SEG + SEG / 2
    const turns = 6 + Math.floor(Math.random() * 2)
    const current = ((angle % 360) + 360) % 360
    const desired = (360 - targetCenter + 360) % 360
    const delta = turns * 360 + ((desired - current + 360) % 360)
    setAngle((a) => a + delta)
    sfx.spin()

    timer.current = window.setTimeout(() => {
      setSpinning(false)
      setLast(idx)
      setHistory((h) => [m, ...h].slice(0, 16))
      const payout = settled.payout
      if (sound) {
        if (m >= 5) sfx.bigwin()
        else if (m > 0) sfx.win()
        else sfx.lose()
      }
      if (m === 0) flashLoss()
      if (m >= 3) toast({ kind: 'win', title: `Wheel jackpot ${mult(m)}!`, body: `${money(payout)} paid out.` })
    }, 5400)
  }, [spinning, bet, balance, playGame, angle, sound, toast, flashLoss])

  useHotkey(() => void spin())
  const landed = last !== null ? SLICES[last] : null

  return (
    <GameShell
      game={game}
      onBack={onBack}
      onFair={onFair}
      aside={
        <div className="space-y-3.5">
          <BetAmount value={bet} onChange={setBet} disabled={spinning} />
          <BetButton onClick={() => void spin()} loading={spinning} sub={`Max win $UGX {money(potential)}`}>
            {spinning ? 'Spinning…' : 'Spin wheel'}
          </BetButton>
          {landed !== null && (
            <div className={`animate-popIn rounded-xl border px-3 py-2 text-center ${
              landed > 0 ? 'border-neon-lime/30 bg-neon-lime/10' : 'border-white/[0.07] bg-white/[0.02]'
            }`}>
              <p className="text-[10px] uppercase tracking-wider text-slate-500">Landed on</p>
              <p className={`num text-xl font-black ${landed > 0 ? 'text-neon-lime' : 'text-slate-400'}`}>
                {landed > 0 ? mult(landed) : 'No win'}
              </p>
            </div>
          )}
          <div>
            <p className="mb-1.5 text-[11px] font-bold uppercase tracking-[.14em] text-slate-400">Payout table</p>
            <div className="grid grid-cols-3 gap-1">
              {payoutTable.map(([m, n]) => (
                <div key={m} className="flex flex-col items-center rounded-lg border border-white/[0.06] bg-white/[0.02] py-1">
                  <span className="num text-[11px] font-bold" style={{ color: COLOR(m) }}>{mult(m)}</span>
                  <span className="text-[9px] text-slate-500">{((n / SLICES.length) * 100).toFixed(1)}%</span>
                </div>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <PayoutRow label="Slices" value={String(SLICES.length)} />
            <PayoutRow label="Exact RTP" value={`${(WHEEL_RTP * 100).toFixed(2)}%`} highlight />
            <PayoutRow label="Losing slices" value={`${SLICES.filter((m) => m === 0).length} / ${SLICES.length}`} />
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
            <span className="text-[9px] font-bold text-neon-lime/70">UGX</span>
          </div>
          <button type="button" onClick={() => void spin()} disabled={spinning} className="btn-primary h-10 flex-1 !text-[13px]">
            {spinning ? 'Spinning…' : 'Spin wheel'}
          </button>
        </div>
      }
      footer={
        <div className="panel p-3.5">
          <p className="mb-2 text-[11px] font-bold uppercase tracking-[.14em] text-slate-400">Previous spins</p>
          <div className="flex flex-wrap gap-1">
            {history.map((h, i) => (
              <span key={i} className={`num rounded-md px-1.5 py-0.5 text-[10px] font-bold ${h > 0 ? 'bg-neon-lime/15 text-neon-lime' : 'bg-white/[0.06] text-slate-400'}`}>
                {h > 0 ? `${h}×` : '–'}
              </span>
            ))}
          </div>
        </div>
      }
    >
      <div className="relative mx-auto aspect-square w-full max-w-[420px] py-3" style={{ perspective: '1100px' }}>
        <div
          className="pointer-events-none absolute inset-x-6 bottom-1 h-10 rounded-[50%] opacity-70"
          style={{ background: 'radial-gradient(ellipse at center, rgba(198,242,78,.28), transparent 72%)', filter: 'blur(12px)' }}
        />
        <div className="absolute left-1/2 top-0 z-20 -translate-x-1/2">
          <div className="h-0 w-0 border-x-[11px] border-t-[18px] border-x-transparent border-t-neon-lime drop-shadow-[0_0_10px_rgba(198,242,78,.9)]" />
        </div>

        <div
          className="absolute inset-3 rounded-full p-[6px]"
          style={{
            transform: 'rotateX(16deg)',
            transformStyle: 'preserve-3d',
            background: 'conic-gradient(from 210deg, #3a4560, #131a28 25%, #46536f 50%, #101623 75%, #3a4560)',
            boxShadow:
              '0 0 0 1px rgba(255,255,255,.12), 0 30px 70px -26px #000, 0 12px 0 -3px #0a0f19, inset 0 2px 0 rgba(255,255,255,.18)',
          }}
        >
          <svg
            viewBox="0 0 200 200"
            className="h-full w-full"
            style={{ transform: `rotate(${angle}deg)`, transition: spinning ? 'transform 5.4s cubic-bezier(.12,.72,.1,1)' : 'none' }}
            role="img"
            aria-label="Fortune wheel"
          >
            <defs>
              <radialGradient id="wheelHub" cx="40%" cy="35%">
                <stop offset="0" stopColor="#fff6d0" /><stop offset="0.5" stopColor="#ffcf5c" /><stop offset="1" stopColor="#b8860b" />
              </radialGradient>
            </defs>
            {SLICES.map((m, i) => {
              const a0 = (i * SEG - 90 - SEG / 2) * (Math.PI / 180)
              const a1 = ((i + 1) * SEG - 90 - SEG / 2) * (Math.PI / 180)
              const r = 93
              const x0 = 100 + r * Math.cos(a0)
              const y0 = 100 + r * Math.sin(a0)
              const x1 = 100 + r * Math.cos(a1)
              const y1 = 100 + r * Math.sin(a1)
              const mid = (i * SEG + SEG / 2 - 90 - SEG / 2) * (Math.PI / 180)
              const lx = 100 + r * 0.7 * Math.cos(mid)
              const ly = 100 + r * 0.7 * Math.sin(mid)
              return (
                <g key={i}>
                  <path
                    d={`M100,100 L${x0},${y0} A${r},${r} 0 0,1 ${x1},${y1} Z`}
                    fill={COLOR(m)}
                    stroke="rgba(8,9,15,.5)"
                    strokeWidth={0.6}
                  />
                  {m > 0 && (
                    <text
                      x={lx}
                      y={ly}
                      transform={`rotate(${i * SEG}, ${lx}, ${ly})`}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fontSize={m >= 10 ? 5.4 : 6}
                      fontWeight={800}
                      fill="#0b0d15"
                      fontFamily="JetBrains Mono, monospace"
                    >
                      {m}×
                    </text>
                  )}
                </g>
              )
            })}
            <circle cx="100" cy="100" r="19" fill="url(#wheelHub)" stroke="rgba(0,0,0,.35)" strokeWidth="1.5" />
            <circle cx="100" cy="100" r="7" fill="#0b0d15" opacity="0.5" />
          </svg>
          <div
            className="pointer-events-none absolute inset-[6px] rounded-full"
            style={{
              background: 'radial-gradient(circle at 32% 22%, rgba(255,255,255,.28), rgba(255,255,255,.05) 26%, transparent 52%)',
              boxShadow: 'inset 0 0 42px 10px rgba(0,0,0,.55), inset 0 1px 0 rgba(255,255,255,.35)',
            }}
          />
        </div>

        <div className="pointer-events-none absolute inset-3 rounded-full" style={{ transform: 'rotateX(16deg)' }}>
          {Array.from({ length: 24 }, (_, i) => {
            const a = (i / 24) * Math.PI * 2
            return (
              <span
                key={i}
                className="absolute h-1.5 w-1.5 rounded-full"
                style={{
                  left: `${50 + 49.4 * Math.cos(a)}%`,
                  top: `${50 + 49.4 * Math.sin(a)}%`,
                  background: spinning ? (i % 2 ? '#c6f24e' : '#3ad7ff') : 'rgba(255,255,255,.18)',
                  boxShadow: spinning ? '0 0 8px rgba(198,242,78,.9)' : 'none',
                  animation: spinning ? `pulseGlow 1.1s ${i * 0.05}s ease-in-out infinite` : 'none',
                }}
              />
            )
          })}
        </div>
      </div>
    </GameShell>
  )
}
