import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from '../lib/store'
import { sfx } from '../lib/sound'
import { limboPoint } from '../lib/fair'
import { money, mult } from '../lib/format'
import { gameById } from '../lib/games'
import { BetAmount, BetButton } from '../components/BetControls'
import { GameShell, PayoutRow } from '../components/GameShell'
import { IconFlame } from '../components/Icons'
import { MIN_BET } from '../lib/currency'

export function Limbo({ onBack, onFair }: { onBack: () => void; onFair: () => void }) {
  const game = gameById('limbo')!
  const { placeBet, settleBet, nextFloats, balance, sound, toast, flashLoss } = useStore()
  const [bet, setBet] = useState(MIN_BET)
  const [target, setTarget] = useState(2)
  const [running, setRunning] = useState(false)
  const [display, setDisplay] = useState(1)
  const [result, setResult] = useState<number | null>(null)
  const [history, setHistory] = useState<number[]>([3.42, 1.04, 22.1, 1.55, 6.02, 1.12, 1.88])
  const raf = useRef(0)

  const potential = Math.round(bet * target * 100) / 100
  const winChance = 99 / target

  const play = useCallback(async () => {
    if (running) return
    if (!(bet > 0)) return
    if (bet > balance) {
      toast({ kind: 'error', title: 'Insufficient balance', body: 'Lower your bet to continue.' })
      return
    }
    if (!placeBet('limbo', bet)) return
    sfx.place()
    setRunning(true)
    setResult(null)
    const [u] = await nextFloats(1)
    const point = limboPoint(u)
    const t0 = performance.now()
    const dur = 780
    const anim = () => {
      const t = Math.min(1, (performance.now() - t0) / dur)
      const eased = 1 - Math.pow(1 - t, 3)
      const shown = Math.exp(Math.log(point) * eased)
      setDisplay(Math.max(1, Math.min(point, Math.round(shown * 100) / 100)))
      if (sound && t < 1 && Math.random() > 0.86) sfx.tick()
      if (t < 1) {
        raf.current = requestAnimationFrame(anim)
      } else {
        setDisplay(point)
        setRunning(false)
        setResult(point)
        setHistory((h) => [point, ...h].slice(0, 18))
        const won = point >= target
        const payout = settleBet({
          game: 'limbo',
          wager: bet,
          multiplier: won ? target : 0,
          detail: `${mult(point)} result · target ${mult(target)}`,
        })
        if (!won) flashLoss()
        if (sound) {
          if (won) {
            if (target >= 10) sfx.bigwin()
            else sfx.win()
          } else sfx.lose()
        }
        if (won) toast({ kind: 'win', title: `Hit ${mult(point)}`, body: `+$UGX {money(payout)} won.` })
      }
    }
    raf.current = requestAnimationFrame(anim)
  }, [running, bet, balance, placeBet, nextFloats, target, settleBet, sound, toast])

  useEffect(() => () => cancelAnimationFrame(raf.current), [])

  const won = result !== null && result >= target
  const stateColor = result === null ? 'text-white' : won ? 'text-neon-lime' : 'text-rose-400'

  return (
    <GameShell
      game={game}
      onBack={onBack}
      onFair={onFair}
      aside={
        <div className="space-y-3.5">
          <BetAmount value={bet} onChange={setBet} disabled={running} />
          <div>
            <span className="label">Target multiplier <span className="num normal-case tracking-normal text-neon-lime">{mult(target)}</span></span>
            <div className="flex items-stretch gap-1.5 rounded-xl border border-white/10 bg-ink-900/80 p-1.5">
              <button type="button" onClick={() => setTarget((t) => Math.max(1.01, Math.round((t - 0.5) * 100) / 100))} className="h-9 w-9 rounded-lg bg-white/[0.05] text-slate-300 hover:bg-white/10">−</button>
              <input
                className="num flex-1 bg-transparent text-center text-lg font-bold text-white focus:outline-none"
                value={target}
                onChange={(e) => {
                  const n = parseFloat(e.target.value.replace(/[^0-9.]/g, ''))
                  if (Number.isFinite(n)) setTarget(Math.min(1000000, Math.max(1.01, Math.round(n * 100) / 100)))
                }}
              />
              <button type="button" onClick={() => setTarget((t) => Math.min(1000000, Math.round((t + 0.5) * 100) / 100))} className="h-9 w-9 rounded-lg bg-white/[0.05] text-slate-300 hover:bg-white/10">+</button>
            </div>
            <div className="mt-1.5 grid grid-cols-4 gap-1.5">
              {[1.5, 2, 5, 10].map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => { setTarget(v); sfx.click() }}
                  className={`num rounded-lg border py-1 text-[11px] font-bold transition ${
                    target === v ? 'border-neon-lime/60 bg-neon-lime/15 text-neon-lime' : 'border-white/[0.07] bg-white/[0.03] text-slate-300 hover:border-white/20'
                  }`}
                >
                  {v}×
                </button>
              ))}
            </div>
          </div>
          <BetButton onClick={() => void play()} loading={running} sub={`Win chance ${winChance.toFixed(2)}%`}>
            {running ? 'Rolling…' : 'Bet'}
          </BetButton>
          <div className="grid grid-cols-2 gap-2">
            <div className="panel-tight py-2 text-center">
              <p className="text-[9px] uppercase tracking-wider text-slate-500">Payout</p>
              <p className="num text-[13px] font-bold text-neon-lime">{money(potential)}</p>
            </div>
            <div className="panel-tight py-2 text-center">
              <p className="text-[9px] uppercase tracking-wider text-slate-500">Profit</p>
              <p className="num text-[13px] font-bold text-neon-cyan">{money(potential - bet)}</p>
            </div>
          </div>
          <div className="space-y-1.5">
            <PayoutRow label="House edge" value="1.0%" />
            <PayoutRow label="Max multiplier" value="1,000,000×" />
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
          <button type="button" onClick={() => void play()} disabled={running} className="btn-primary h-10 flex-1 !text-[13px]">
            {running ? 'Rolling…' : `Roll ${mult(target)}`}
          </button>
        </div>
      }
      footer={
        <div className="panel p-3.5">
          <p className="mb-2 text-[11px] font-bold uppercase tracking-[.14em] text-slate-400">Recent results</p>
          <div className="flex flex-wrap gap-1">
            {history.map((h, i) => (
              <span
                key={`${h}-${i}`}
                className={`num rounded-md px-1.5 py-0.5 text-[10px] font-bold ${
                  h >= 10 ? 'bg-neon-violet/20 text-neon-violet' : h >= 2 ? 'bg-neon-lime/15 text-neon-lime' : 'bg-white/[0.06] text-slate-400'
                }`}
              >
                {h >= 1000 ? `${(h / 1000).toFixed(1)}k×` : `${h.toFixed(2)}×`}
              </span>
            ))}
          </div>
        </div>
      }
    >
      <div className="px-2 py-10">
        <div className="relative mx-auto max-w-lg text-center">
          <div className="pointer-events-none absolute left-1/2 top-1/2 h-52 w-52 -translate-x-1/2 -translate-y-1/2 rounded-full bg-neon-lime/[0.09] blur-3xl" />
          <p className="relative text-[10.5px] font-bold uppercase tracking-[.24em] text-slate-500">
            {running ? 'Rolling' : result === null ? 'Set your target' : won ? 'Target reached' : 'Missed the target'}
          </p>
          <p
            className={`num relative mt-2 text-[64px] font-black leading-none tracking-tight sm:text-[86px] ${stateColor}`}
            style={{ textShadow: result === null ? 'none' : won ? '0 0 56px rgba(198,242,78,.5)' : '0 0 48px rgba(244,63,94,.35)' }}
          >
            {display.toFixed(2)}×
          </p>
          <div className="relative mt-3 inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1">
            <IconFlame size={12} className="text-gold" />
            <span className="num text-[11px] font-bold text-slate-300">Target {mult(target)}</span>
          </div>

          <div className="relative mx-auto mt-10 max-w-md">
            <div className="h-2 overflow-hidden rounded-full bg-white/[0.06]">
              <div
                className={`h-full rounded-full transition-all duration-500 ${won ? 'bg-gradient-to-r from-neon-cyan to-neon-lime' : 'bg-gradient-to-r from-neon-cyan/70 to-neon-violet/70'}`}
                style={{ width: `${Math.min(100, (Math.log(Math.max(1, display)) / Math.log(Math.max(2, target * 1.4))) * 100)}%` }}
              />
            </div>
            <div className="mt-3 flex justify-between text-[10px] text-slate-600">
              <span className="num">1.00×</span>
              <span className="num">{mult(target)}</span>
              <span className="num">{mult(Math.max(2, target * 1.4))}</span>
            </div>
          </div>
        </div>
      </div>
    </GameShell>
  )
}
