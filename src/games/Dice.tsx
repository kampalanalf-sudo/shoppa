import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from '../lib/store'
import { sfx } from '../lib/sound'
import { diceRoll } from '../lib/fair'
import { money, mult } from '../lib/format'
import { gameById } from '../lib/games'
import { BetAmount, BetButton, useHotkey } from '../components/BetControls'
import { GameShell, PayoutRow } from '../components/GameShell'
import { Dice3D } from '../components/Dice3D'

const EDGE = 0.99

export function Dice({ onBack, onFair }: { onBack: () => void; onFair: () => void }) {
  const game = gameById('dice')!
  const { placeBet, settleBet, nextFloats, balance, sound, toast, flashLoss } = useStore()
  const [bet, setBet] = useState(1000)
  const [target, setTarget] = useState(50)
  const [mode, setMode] = useState<'over' | 'under'>('under')
  const [roll, setRoll] = useState<number | null>(null)
  const [rolling, setRolling] = useState(false)
  const [history, setHistory] = useState<{ v: number; win: boolean }[]>([])
  const [last, setLast] = useState<{ v: number; won: boolean; payout: number; mult: number } | null>(null)
  const spinRaf = useRef<number>(0)

  const winChance = mode === 'under' ? target : 100 - target
  const multVal = Math.round((EDGE / (winChance / 100)) * 100) / 100
  const potential = Math.round(bet * multVal * 100) / 100

  const play = useCallback(async () => {
    if (rolling) return
    if (!(bet > 0)) return
    if (bet > balance) {
      toast({ kind: 'error', title: 'Insufficient balance', body: 'Lower your bet to continue.' })
      return
    }
    if (!placeBet('dice', bet)) return
    sfx.place()
    setRolling(true)
    const [u] = await nextFloats(1)
    const result = diceRoll(u)
    const won = mode === 'under' ? result < target : result > target

    // animated rolling
    const t0 = performance.now()
    const anim = () => {
      const t = performance.now() - t0
      if (t < 620) {
        setRoll(Math.round(Math.random() * 9999) / 100)
        if (sound && Math.random() > 0.72) sfx.tick()
        spinRaf.current = requestAnimationFrame(anim)
      } else {
        setRoll(result)
        setRolling(false)
        const payout = settleBet({
          game: 'dice',
          wager: bet,
          multiplier: won ? multVal : 0,
          detail: `Rolled ${result.toFixed(2)} · ${mode} ${target}`,
        })
        setLast({ v: result, won, payout, mult: won ? multVal : 0 })
        setHistory((h) => [{ v: result, win: won }, ...h].slice(0, 16))
        if (won) { if (sound) sfx.win() } else { flashLoss(); if (sound) sfx.lose() }
      }
    }
    spinRaf.current = requestAnimationFrame(anim)
  }, [rolling, bet, balance, placeBet, nextFloats, mode, target, multVal, settleBet, sound, toast])

  useEffect(() => () => cancelAnimationFrame(spinRaf.current), [])
  useHotkey(() => void play())

  const bar = roll ?? 50
  const lower = mode === 'under' ? 0 : target
  const upper = mode === 'under' ? target : 100

  const marker = `range-${mode}-${target}`

  return (
    <GameShell
      game={game}
      onBack={onBack}
      onFair={onFair}
      aside={
        <div className="space-y-3.5">
          <BetAmount value={bet} onChange={setBet} disabled={rolling} />

          <div>
            <span className="label">Bet mode</span>
            <div className="grid grid-cols-2 gap-1 rounded-xl bg-ink-900/80 p-1">
              {(['under', 'over'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={`rounded-lg py-1.5 text-[11.5px] font-bold capitalize transition ${
                    mode === m ? 'bg-white/[0.09] text-white' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Roll {m}
                </button>
              ))}
            </div>
          </div>

          <div>
            <span className="label">Roll {mode} <span className="num normal-case tracking-normal text-neon-lime">{target.toFixed(2)}</span></span>
            <div className="grid grid-cols-3 gap-1.5">
              <button type="button" className="btn-ghost !py-1.5 !text-[11px]" onClick={() => setTarget((t) => Math.max(2, Math.round((t - 1) * 100) / 100))}>−1</button>
              <input
                className="field num !py-1.5 text-center !text-[12px]"
                value={target}
                onChange={(e) => {
                  const n = parseFloat(e.target.value.replace(/[^0-9.]/g, ''))
                  if (Number.isFinite(n)) setTarget(Math.min(98, Math.max(2, Math.round(n * 100) / 100)))
                }}
              />
              <button type="button" className="btn-ghost !py-1.5 !text-[11px]" onClick={() => setTarget((t) => Math.min(98, Math.round((t + 1) * 100) / 100))}>+1</button>
            </div>
          </div>

          <BetButton onClick={() => void play()} loading={rolling} sub={`Pays ${mult(multVal)} · ${money(potential)} PX`}>
            {rolling ? 'Rolling…' : 'Roll dice'}
          </BetButton>

          <div className="grid grid-cols-3 gap-2 text-center">
            {[
              { l: 'Win chance', v: `${winChance.toFixed(2)}%`, c: 'text-white' },
              { l: 'Payout', v: mult(multVal), c: 'text-neon-lime' },
              { l: 'Profit', v: money(potential - bet), c: 'text-neon-cyan' },
            ].map((s) => (
              <div key={s.l} className="panel-tight py-2">
                <p className="text-[9px] uppercase tracking-wider text-slate-500">{s.l}</p>
                <p className={`num text-[12px] font-bold ${s.c}`}>{s.v}</p>
              </div>
            ))}
          </div>
          <div className="space-y-1.5">
            <PayoutRow label="House edge" value="1.0%" />
            <PayoutRow label="Range" value={`${lower.toFixed(2)} – ${upper.toFixed(2)}`} />
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
            <span className="text-[9px] font-bold text-neon-lime/70">PX</span>
          </div>
          <button type="button" onClick={() => void play()} disabled={rolling} className="btn-primary h-10 flex-1 !text-[13px]">
            {rolling ? 'Rolling…' : `Roll ${mode} ${mult(multVal)}`}
          </button>
        </div>
      }
      footer={
        history.length ? (
          <div className="panel p-3.5">
            <p className="mb-2 text-[11px] font-bold uppercase tracking-[.14em] text-slate-400">Last rolls</p>
            <div className="flex flex-wrap gap-1">
              {history.slice(0, 12).map((h, i) => (
                <span key={i} className={`num rounded-md px-1.5 py-0.5 text-[10px] font-bold ${h.win ? 'bg-neon-lime/15 text-neon-lime' : 'bg-rose-500/15 text-rose-300'}`}>
                  {h.v.toFixed(2)}
                </span>
              ))}
            </div>
          </div>
        ) : undefined
      }
    >
      <div className="px-2 py-6">
        <div className="text-center">
          <p className={`num text-[56px] font-black leading-none transition-colors sm:text-[72px] ${
            rolling ? 'text-slate-400' : last ? (last.won ? 'text-neon-lime' : 'text-rose-400') : 'text-white'
          }`} style={{ textShadow: last && !rolling ? `0 0 44px ${last.won ? 'rgba(198,242,78,.5)' : 'rgba(244,63,94,.4)'}` : 'none' }}>
            {bar.toFixed(2)}
          </p>
          <p className="mt-1 text-[10.5px] font-bold uppercase tracking-[.2em] text-slate-500">
            {rolling ? 'Rolling…' : last ? (last.won ? `Won ${money(last.payout)} PX` : 'No win this time') : `Roll ${mode} ${target.toFixed(2)}`}
          </p>
        </div>

        {/* 3D die — face tracks the rolled value */}
        <div className="mt-2 flex items-end justify-center">
          <Dice3D
            value={last ? Math.min(6, Math.max(1, Math.floor(last.v / (100 / 6)) + 1)) : null}
            rolling={rolling}
            tumble={history.length}
          />
        </div>

        <div className="relative mt-8">
          {/* track */}
          <div className="relative h-3 w-full overflow-hidden rounded-full bg-white/[0.06]"
            style={{ boxShadow: 'inset 0 2px 4px rgba(0,0,0,.7), inset 0 -1px 0 rgba(255,255,255,.08)' }}>
            <div
              className="absolute inset-y-0 bg-gradient-to-r from-neon-lime/80 via-neon-green/60 to-neon-cyan/70 transition-all duration-300"
              style={{ left: `${lower}%`, width: `${Math.max(0, upper - lower)}%` }}
            />
            <div
              className="absolute inset-y-0 bg-gradient-to-r from-rose-500/15 to-rose-500/45 transition-all duration-300"
              style={
                mode === 'under'
                  ? { left: `${upper}%`, width: `${100 - upper}%` }
                  : { left: 0, width: `${lower}%` }
              }
            />
            <div
              className="absolute top-1/2 h-3 w-[3px] -translate-y-1/2 bg-white shadow-[0_0_12px_rgba(255,255,255,.9)]"
              style={{ left: `${target}%` }}
            />
          </div>

          {/* roll marker */}
          <div
            className={`absolute -top-2 z-10 transition-all duration-150 ${rolling ? '' : 'duration-500'}`}
            style={{ left: `${Math.min(99, Math.max(1, bar))}%`, transform: 'translateX(-50%)' }}
          >
            <div className={`grid h-7 w-7 place-items-center rounded-full border-2 text-[9px] font-black ${
              rolling ? 'border-slate-500 bg-ink-800 text-slate-400'
                : last?.won ? 'border-neon-lime bg-ink-900 text-neon-lime shadow-glow' : 'border-rose-400 bg-ink-900 text-rose-400'
            }`}>
              ●
            </div>
          </div>

          <div className="mt-4 flex justify-between text-[10px] text-slate-500">
            {[0, 25, 50, 75, 100].map((n) => (
              <span key={n} className="num">{n}</span>
            ))}
          </div>

          <div className="mt-4 flex items-center justify-center gap-2">
            <span className={`chip ${mode === 'under' ? '!border-neon-lime/30 !text-neon-lime' : ''}`}>
              0 – {target.toFixed(2)} win
            </span>
            <span className={`chip ${mode === 'over' ? '!border-neon-lime/30 !text-neon-lime' : ''}`}>
              {target.toFixed(2)} – 100 win
            </span>
          </div>
        </div>

        <div className="mt-8 grid grid-cols-3 gap-2">
          <div className="panel-tight p-2.5 text-center">
            <p className="text-[9px] uppercase tracking-wider text-slate-500">Roll under</p>
            <p className="num text-[13px] font-bold text-white">{target.toFixed(2)}</p>
          </div>
          <div className="panel-tight p-2.5 text-center">
            <p className="text-[9px] uppercase tracking-wider text-slate-500">Multiplier</p>
            <p className="num text-[13px] font-bold text-neon-lime">{mult(multVal)}</p>
          </div>
          <div className="panel-tight p-2.5 text-center">
            <p className="text-[9px] uppercase tracking-wider text-slate-500">Potential</p>
            <p className="num text-[13px] font-bold text-neon-cyan">{money(potential)}</p>
          </div>
        </div>
      </div>
    </GameShell>
  )
}
