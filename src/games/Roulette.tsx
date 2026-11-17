import React, { useCallback, useMemo, useRef, useState } from 'react'
import { useStore } from '../lib/store'
import { sfx } from '../lib/sound'
import { money, mult } from '../lib/format'
import { gameById } from '../lib/games'
import { BetAmount, BetButton } from '../components/BetControls'
import { GameShell, PayoutRow } from '../components/GameShell'

const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36])
const WHEEL = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26]

type BetKind = 'straight' | 'red' | 'black' | 'odd' | 'even' | 'low' | 'high' | 'dozen1' | 'dozen2' | 'dozen3'
type Placed = { kind: BetKind; n?: number; amount: number }

const colorOf = (n: number) => (n === 0 ? 'green' : RED.has(n) ? 'red' : 'black')
const PAYOUTS: Record<BetKind, number> = {
  straight: 36, red: 2, black: 2, odd: 2, even: 2, low: 2, high: 2, dozen1: 3, dozen2: 3, dozen3: 3,
}

export function Roulette({ onBack, onFair }: { onBack: () => void; onFair: () => void }) {
  const game = gameById('roulette')!
  const { placeBet, settleBet, nextFloats, balance, sound, toast, flashLoss } = useStore()
  const [bet, setBet] = useState(1000)
  const [bets, setBets] = useState<Placed[]>([])
  const [spinning, setSpinning] = useState(false)
  const [angle, setAngle] = useState(0)
  const [result, setResult] = useState<number | null>(null)
  const [history, setHistory] = useState<number[]>([17, 0, 32, 8, 26, 11])
  const timer = useRef<number>(0)

  const totalStake = bets.reduce((a, b) => a + b.amount, 0)

  const add = (kind: BetKind, n?: number) => {
    if (spinning) return
    const label = kind === 'straight' ? `#${n}` : kind
    const existing = bets.findIndex((b) => b.kind === kind && b.n === n)
    if (existing >= 0) {
      const copy = [...bets]
      copy[existing] = { ...copy[existing], amount: copy[existing].amount + bet }
      setBets(copy)
    } else {
      setBets((b) => [...b, { kind, n, amount: bet }])
    }
    sfx.click()
    if (!spinning) void label
  }

  const clear = () => { setBets([]); sfx.click() }

  const spin = useCallback(async () => {
    if (spinning || !bets.length) {
      if (!bets.length) toast({ kind: 'error', title: 'No bets placed', body: 'Tap the felt to place at least one bet.' })
      return
    }
    if (totalStake > balance) {
      toast({ kind: 'error', title: 'Insufficient balance', body: 'Reduce your stakes to continue.' })
      return
    }
    if (!placeBet('roulette', totalStake)) return
    sfx.place()
    setSpinning(true)
    setResult(null)
    const [u] = await nextFloats(1)
    const idx = Math.min(WHEEL.length - 1, Math.floor(u * WHEEL.length))
    const n = WHEEL[idx]
    const slot = 360 / WHEEL.length
    const targetCenter = idx * slot + slot / 2
    const turns = 5 + Math.floor(Math.random() * 2)
    const current = ((angle % 360) + 360) % 360
    const desired = (360 - targetCenter + 360) % 360
    const delta = turns * 360 + ((desired - current + 360) % 360)
    setAngle((a) => a + delta)
    sfx.spin()

    timer.current = window.setTimeout(() => {
      setSpinning(false)
      setResult(n)
      setHistory((h) => [n, ...h].slice(0, 12))
      let payout = 0
      for (const b of bets) {
        const won =
          (b.kind === 'straight' && b.n === n) ||
          (b.kind === 'red' && colorOf(n) === 'red') ||
          (b.kind === 'black' && colorOf(n) === 'black') ||
          (b.kind === 'odd' && n !== 0 && n % 2 === 1) ||
          (b.kind === 'even' && n !== 0 && n % 2 === 0) ||
          (b.kind === 'low' && n >= 1 && n <= 18) ||
          (b.kind === 'high' && n >= 19 && n <= 36) ||
          (b.kind === 'dozen1' && n >= 1 && n <= 12) ||
          (b.kind === 'dozen2' && n >= 13 && n <= 24) ||
          (b.kind === 'dozen3' && n >= 25 && n <= 36)
        if (won) payout += b.amount * PAYOUTS[b.kind]
      }
      const multiplier = totalStake ? Math.round((payout / totalStake) * 100) / 100 : 0
      const paid = settleBet({
        game: 'roulette',
        wager: totalStake,
        multiplier,
        detail: `Ball landed on ${n} ${colorOf(n)} · ${bets.length} bet${bets.length > 1 ? 's' : ''}`,
      })
      if (payout === 0) flashLoss()
      if (sound) {
        if (payout > 0) sfx.win()
        else sfx.lose()
      }
      if (payout > totalStake * 3) toast({ kind: 'win', title: `Straight up ${n}!`, body: `+${money(paid)} PX from ${bets.length} bets.` })
      setBets([])
    }, 4800)
  }, [spinning, bets, totalStake, balance, placeBet, nextFloats, angle, settleBet, sound, toast])

  const feltBtn = (label: React.ReactNode, kind: BetKind, n: number | undefined, accent: string, active: boolean, extra = '') => (
    <button
      type="button"
      onClick={() => add(kind, n)}
      disabled={spinning}
      className={`relative grid place-items-center rounded-md border text-[11px] font-bold transition disabled:opacity-60 ${accent} ${extra} ${
        active ? 'ring-2 ring-gold/70' : ''
      }`}
    >
      {label}
    </button>
  )

  const totalPotential = useMemo(
    () => bets.reduce((sum, b) => sum + b.amount * PAYOUTS[b.kind] * (b.kind === 'straight' ? 1 : 1), 0),
    [bets],
  )

  return (
    <GameShell
      game={game}
      onBack={onBack}
      onFair={onFair}
      aside={
        <div className="space-y-3.5">
          <BetAmount value={bet} onChange={setBet} disabled={spinning} label="Chip value" />
          <div className="flex items-center justify-between rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2">
            <span className="text-[11px] text-slate-500">Total stake</span>
            <span className="num text-[14px] font-bold text-white">{money(totalStake)} PX</span>
          </div>
          <BetButton onClick={() => void spin()} loading={spinning} disabled={!bets.length} sub={bets.length ? `${bets.length} bets · up to ${money(totalPotential)} PX` : 'Place bets on the felt'}>
            {spinning ? 'Spinning…' : 'Spin'}
          </BetButton>
          <button type="button" onClick={clear} disabled={!bets.length || spinning} className="btn-ghost w-full !py-2 !text-[12px]">
            Clear bets
          </button>
          {bets.length > 0 && (
            <div className="space-y-1">
              {bets.map((b, i) => (
                <div key={i} className="flex items-center justify-between rounded-lg bg-white/[0.03] px-2.5 py-1.5 text-[11px]">
                  <span className="capitalize text-slate-300">{b.kind === 'straight' ? `Number ${b.n}` : b.kind.replace(/(\d)/, ' $1')}</span>
                  <span className="num font-bold text-white">{money(b.amount)}</span>
                </div>
              ))}
            </div>
          )}
          <div className="space-y-1.5">
            <PayoutRow label="Straight up" value="36×" />
            <PayoutRow label="Even money" value="2×" />
            <PayoutRow label="House edge" value="2.7%" />
          </div>
          {result !== null && (
            <div className="animate-popIn rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-center">
              <p className="text-[10px] uppercase tracking-wider text-slate-500">Last result</p>
              <p className="num text-lg font-black text-white">
                {result} <span className={colorOf(result) === 'red' ? 'text-rose-400' : colorOf(result) === 'black' ? 'text-slate-400' : 'text-emerald-400'}>· {colorOf(result)}</span>
              </p>
            </div>
          )}
        </div>
      }
      mobileAction={
        <div className="flex items-center gap-1.5">
          <div className="flex items-center gap-1 rounded-xl border border-white/10 bg-ink-900/90 px-2">
            <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500">Chip</span>
            <input
              inputMode="decimal"
              value={bet}
              onChange={(e) => setBet(Math.max(0, parseFloat(e.target.value.replace(/[^0-9.]/g, '')) || 0))}
              className="num w-14 bg-transparent py-2 text-center text-[13px] font-bold text-white focus:outline-none"
            />
          </div>
          <button type="button" onClick={clear} disabled={!bets.length || spinning} className="btn-ghost h-10 !px-3 !text-[12px]">
            Clear
          </button>
          <button type="button" onClick={() => void spin()} disabled={spinning || !bets.length} className="btn-primary h-10 flex-1 !text-[13px]">
            {spinning ? 'Spinning…' : `Spin · ${money(totalStake)}`}
          </button>
        </div>
      }
      footer={
        <div className="panel p-3.5">
          <p className="mb-2 text-[11px] font-bold uppercase tracking-[.14em] text-slate-400">Recent numbers</p>
          <div className="flex flex-wrap gap-1">
            {history.map((n, i) => (
              <span
                key={i}
                className={`num grid h-6 w-6 place-items-center rounded-md text-[10.5px] font-bold text-white ${
                  colorOf(n) === 'red' ? 'bg-rose-600/80' : colorOf(n) === 'black' ? 'bg-ink-700' : 'bg-emerald-600/80'
                }`}
              >
                {n}
              </span>
            ))}
          </div>
        </div>
      }
    >
      <div className="grid gap-3 lg:grid-cols-[minmax(0,260px)_1fr]">
        {/* wheel */}
        <div className="relative mx-auto aspect-square w-full max-w-[240px]">
          <div className="absolute left-1/2 top-0 z-20 -translate-x-1/2">
            <div className="h-0 w-0 border-x-[8px] border-t-[13px] border-x-transparent border-t-white/80" />
          </div>
          <div className="absolute inset-0 rounded-full bg-gradient-to-br from-ink-700 to-ink-900 p-1.5 shadow-[0_0_0_1px_rgba(255,255,255,.08),0_20px_50px_-22px_#000]">
            <svg
              viewBox="0 0 200 200"
              className="h-full w-full"
              style={{ transform: `rotate(${angle}deg)`, transition: spinning ? 'transform 4.8s cubic-bezier(.1,.7,.08,1)' : 'none' }}
              role="img"
              aria-label="Roulette wheel"
            >
              {WHEEL.map((n, i) => {
                const slot = 360 / WHEEL.length
                const a0 = (i * slot - 90) * (Math.PI / 180)
                const a1 = ((i + 1) * slot - 90) * (Math.PI / 180)
                const r = 94
                const mid = ((i * slot + slot / 2) - 90) * (Math.PI / 180)
                const lx = 100 + r * 0.74 * Math.cos(mid)
                const ly = 100 + r * 0.74 * Math.sin(mid)
                const fill = n === 0 ? '#10b981' : RED.has(n) ? '#d92b4b' : '#1c2130'
                return (
                  <g key={i}>
                    <path
                      d={`M100,100 L${100 + r * Math.cos(a0)},${100 + r * Math.sin(a0)} A${r},${r} 0 0,1 ${100 + r * Math.cos(a1)},${100 + r * Math.sin(a1)} Z`}
                      fill={fill}
                      stroke="rgba(255,207,92,.35)"
                      strokeWidth={0.6}
                    />
                    <text
                      x={lx}
                      y={ly}
                      transform={`rotate(${i * slot + slot / 2}, ${lx}, ${ly})`}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fontSize={5.4}
                      fontWeight={700}
                      fill="#ffffff"
                      fontFamily="JetBrains Mono, monospace"
                    >
                      {n}
                    </text>
                  </g>
                )
              })}
              <circle cx="100" cy="100" r="34" fill="#0b0d15" stroke="rgba(255,207,92,.4)" strokeWidth="1.5" />
              <circle cx="100" cy="100" r="6" fill="url(#wheelHub)" />
              <defs>
                <radialGradient id="wheelHub" cx="40%" cy="35%">
                  <stop offset="0" stopColor="#fff6d0" /><stop offset="1" stopColor="#b8860b" />
                </radialGradient>
              </defs>
            </svg>
          </div>
        </div>

        {/* felt */}
        <div className="min-w-0">
          <div className="grid grid-cols-3 gap-1">
            <button
              type="button"
              onClick={() => add('straight', 0)}
              disabled={spinning}
              className={`col-span-3 rounded-md border border-emerald-500/40 bg-emerald-600/25 py-2 text-[12px] font-black text-emerald-200 transition hover:bg-emerald-600/40 ${bets.some((b) => b.n === 0) ? 'ring-2 ring-gold/70' : ''}`}
            >
              0
            </button>
            <div className="col-span-3 grid grid-cols-12 gap-1">
              {Array.from({ length: 36 }, (_, i) => i + 1).map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => add('straight', n)}
                  disabled={spinning}
                  className={`num h-8 rounded-md border text-[11px] font-bold text-white transition hover:brightness-125 ${
                    colorOf(n) === 'red' ? 'border-rose-400/20 bg-rose-600/70' : 'border-white/10 bg-ink-700'
                  } ${bets.some((b) => b.kind === 'straight' && b.n === n) ? 'ring-2 ring-gold/70' : ''}`}
                >
                  {n}
                </button>
              ))}
            </div>
            <div className="col-span-3 mt-1 grid grid-cols-6 gap-1">
              {feltBtn('1–18', 'low', undefined, 'border-white/10 bg-ink-700/80 py-2 text-slate-200', bets.some((b) => b.kind === 'low'))}
              {feltBtn('Even', 'even', undefined, 'border-white/10 bg-ink-700/80 py-2 text-slate-200', bets.some((b) => b.kind === 'even'))}
              {feltBtn(<span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-rose-500" />Red</span>, 'red', undefined, 'border-white/10 bg-ink-700/80 py-2 text-slate-200', bets.some((b) => b.kind === 'red'))}
              {feltBtn(<span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-slate-300" />Black</span>, 'black', undefined, 'border-white/10 bg-ink-700/80 py-2 text-slate-200', bets.some((b) => b.kind === 'black'))}
              {feltBtn('Odd', 'odd', undefined, 'border-white/10 bg-ink-700/80 py-2 text-slate-200', bets.some((b) => b.kind === 'odd'))}
              {feltBtn('19–36', 'high', undefined, 'border-white/10 bg-ink-700/80 py-2 text-slate-200', bets.some((b) => b.kind === 'high'))}
            </div>
            <div className="col-span-3 grid grid-cols-3 gap-1">
              {feltBtn('1st 12', 'dozen1', undefined, 'border-white/10 bg-ink-700/80 py-2 text-slate-200', bets.some((b) => b.kind === 'dozen1'))}
              {feltBtn('2nd 12', 'dozen2', undefined, 'border-white/10 bg-ink-700/80 py-2 text-slate-200', bets.some((b) => b.kind === 'dozen2'))}
              {feltBtn('3rd 12', 'dozen3', undefined, 'border-white/10 bg-ink-700/80 py-2 text-slate-200', bets.some((b) => b.kind === 'dozen3'))}
            </div>
          </div>

          {result !== null && (
            <div className="mt-3 flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
              <span className={`num grid h-10 w-10 place-items-center rounded-full text-[15px] font-black text-white ${
                colorOf(result) === 'red' ? 'bg-rose-600' : colorOf(result) === 'black' ? 'bg-ink-700 ring-1 ring-white/20' : 'bg-emerald-600'
              }`}>{result}</span>
              <div>
                <p className="text-[12px] font-bold text-white">{colorOf(result) === 'green' ? 'Zero — house wins' : `${colorOf(result)} ${result}`}</p>
                <p className="text-[10.5px] text-slate-500">{bets.length ? 'Bets settled' : 'Place new bets for the next spin'}</p>
              </div>
              <span className="ml-auto chip !border-white/[0.07] normal-case tracking-normal">
                {result === 0 ? '0×' : mult(PAYOUTS.straight)}
              </span>
            </div>
          )}
        </div>
      </div>
    </GameShell>
  )
}
