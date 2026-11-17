import React, { useCallback, useState } from 'react'
import { useStore } from '../lib/store'
import { sfx } from '../lib/sound'
import { money, mult } from '../lib/format'
import { gameById } from '../lib/games'
import { BetAmount, BetButton } from '../components/BetControls'
import { GameShell, PayoutRow } from '../components/GameShell'
import { IconDiamond } from '../components/Icons'

const LEVELS = 8
const houses = 0.99

const stepMult = (difficulty: 1 | 2 | 3) => (1 / (4 - difficulty)) * (1 / houses)

export function Tower({ onBack, onFair }: { onBack: () => void; onFair: () => void }) {
  const game = gameById('tower')!
  const { placeBet, settleBet, nextFloats, balance, sound, toast, flashLoss } = useStore()
  const [bet, setBet] = useState(10)
  const [difficulty, setDifficulty] = useState<1 | 2 | 3>(1)
  const [active, setActive] = useState(false)
  const [level, setLevel] = useState(0)
  const [safeSet, setSafeSet] = useState<Set<number>>(new Set())
  const [crashed, setCrashed] = useState<number | null>(null)
  const [picked, setPicked] = useState<number[]>([])
  const [busy, setBusy] = useState(false)

  // Easy: 4 tiles / 3 safe · Medium: 3 tiles / 2 safe · Hard: 2 tiles / 1 safe
  const cols = 5 - difficulty
  const levelMult = useCallback(
    (lv: number) => {
      const safe = cols - 1
      let m = houses
      for (let i = 0; i < lv; i++) m *= cols / safe
      return Math.round(Math.max(1, m) * 100) / 100
    },
    [cols, difficulty],
  )

  const currentMult = level === 0 ? 1 : levelMult(level)
  const nextMult = levelMult(level + 1)
  const potential = Math.round(bet * currentMult * 100) / 100

  const start = useCallback(async () => {
    if (!(bet > 0)) return
    if (bet > balance) {
      toast({ kind: 'error', title: 'Insufficient balance', body: 'Lower your bet to continue.' })
      return
    }
    if (!placeBet('tower', bet)) return
    sfx.place()
    setBusy(true)
    const floats = await nextFloats(LEVELS)
    const safe = new Set<number>()
    floats.forEach((u, i) => safe.add(Math.min(cols - 1, Math.floor(u * cols)) + i * cols))
    setSafeSet(safe)
    setLevel(0)
    setPicked([])
    setCrashed(null)
    setActive(true)
    setBusy(false)
  }, [bet, balance, placeBet, nextFloats, cols, toast])

  const pick = (i: number) => {
    if (!active || crashed !== null) return
    if (!safeSet.has(level * cols + i)) {
      setCrashed(level * cols + i)
      setActive(false)
      settleBet({ game: 'tower', wager: bet, multiplier: 0, detail: `Fell on floor ${level + 1}` })
      flashLoss()
      if (sound) sfx.bomb()
      return
    }
    setPicked((p) => [...p, level * cols + i])
    if (sound) sfx.gem()
    if (level + 1 >= LEVELS) {
      const pay = settleBet({ game: 'tower', wager: bet, multiplier: levelMult(LEVELS), detail: `Cleared all ${LEVELS} floors` })
      setLevel(LEVELS)
      setActive(false)
      if (sound) sfx.bigwin()
      toast({ kind: 'win', title: 'Tower cleared!', body: `+${money(pay)} FB — top floor reached.` })
    } else {
      setLevel((l) => l + 1)
    }
  }

  const cashout = () => {
    if (!active || level === 0) return
    const pay = settleBet({ game: 'tower', wager: bet, multiplier: currentMult, detail: `Climbed ${level} floors` })
    setActive(false)
    if (sound) {
      if (currentMult >= 5) sfx.bigwin()
      else sfx.cashout()
    }
    toast({ kind: 'win', title: `Cashed out ${mult(currentMult)}`, body: `+${money(pay)} FB secured.` })
  }

  const reset = () => { setActive(false); setCrashed(null); setPicked([]); setLevel(0) }

  return (
    <GameShell
      game={game}
      onBack={onBack}
      onFair={onFair}
      aside={
        <div className="space-y-3.5">
          <BetAmount value={bet} onChange={setBet} disabled={active} />
          <div>
            <span className="label">Difficulty</span>
            <div className="grid grid-cols-3 gap-1 rounded-xl bg-ink-900/80 p-1">
              {([1, 2, 3] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  disabled={active}
                  onClick={() => { setDifficulty(d); reset(); sfx.click() }}
                  className={`rounded-lg py-1.5 text-[11px] font-bold transition disabled:opacity-40 ${
                    difficulty === d ? 'bg-white/[0.09] text-white' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {d === 1 ? 'Easy' : d === 2 ? 'Medium' : 'Hard'}
                </button>
              ))}
            </div>
          </div>
          {active ? (
            <BetButton onClick={cashout} disabled={level === 0} sub={`${money(potential)} FB`}>
              Cash out {mult(currentMult)}
            </BetButton>
          ) : (
            <BetButton onClick={() => void start()} disabled={busy} sub={`Floor 1 pays ${mult(levelMult(1))}`}>
              {crashed !== null ? 'Try again' : 'Place bet'}
            </BetButton>
          )}
          <div className="grid grid-cols-3 gap-2 text-center">
            {[
              { l: 'Floor', v: `${Math.min(level, LEVELS)}/${LEVELS}`, c: 'text-white' },
              { l: 'Multiplier', v: mult(currentMult), c: 'text-neon-lime' },
              { l: 'Next', v: mult(nextMult), c: 'text-neon-cyan' },
            ].map((s) => (
              <div key={s.l} className="panel-tight py-2">
                <p className="text-[9px] uppercase tracking-wider text-slate-500">{s.l}</p>
                <p className={`num text-[12px] font-bold ${s.c}`}>{s.v}</p>
              </div>
            ))}
          </div>
          <div className="space-y-1.5">
            <PayoutRow label="Floors" value={String(LEVELS)} />
            <PayoutRow label="Tiles per floor" value={String(cols)} />
            <PayoutRow label="House edge" value="1.0%" />
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
          {active ? (
            <button type="button" onClick={cashout} disabled={level === 0} className="btn-danger h-10 flex-1 !text-[13px]">
              Cash out {mult(currentMult)}
            </button>
          ) : (
            <button type="button" onClick={() => void start()} disabled={busy} className="btn-primary h-10 flex-1 !text-[13px]">
              Place bet
            </button>
          )}
        </div>
      }
    >
      <div className="mx-auto flex max-w-[420px] flex-col-reverse gap-1.5 py-2">
        {Array.from({ length: LEVELS }, (_, fi) => {
          const locked = !active || crashed !== null || fi < level
          const isCrashedRow = crashed !== null && Math.floor(crashed / cols) === fi
          return (
            <div
              key={fi}
              className={`grid gap-1.5 rounded-xl border p-1.5 transition ${
                fi === level && active ? 'border-neon-lime/35 bg-neon-lime/[0.05]' : isCrashedRow ? 'border-rose-500/30 bg-rose-500/[0.06]' : 'border-white/[0.05] bg-white/[0.015]'
              }`}
              style={{ gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))`, perspective: "700px" }}
            >
              <span className="col-span-full flex items-center justify-between px-1 text-[9px] font-bold uppercase tracking-wider text-slate-600">
                <span>Floor {fi + 1}</span>
                <span className="num">{mult(levelMult(fi + 1))}</span>
              </span>
              {Array.from({ length: cols }, (_, ci) => {
                const idx = fi * cols + ci
                const isPicked = picked.includes(idx)
                const isSafeHidden = !active && crashed !== null && safeSet.has(idx) && !isPicked
                const isCrash = crashed === idx
                return (
                  <button
                    key={ci}
                    type="button"
                    onClick={() => pick(idx)}
                    disabled={locked || !active}
                    className={`relative h-11 rounded-lg border text-[10px] font-bold transition-all duration-200 ${
                      isPicked
                        ? 'border-neon-lime/60 bg-gradient-to-br from-neon-lime/30 to-neon-green/10 text-neon-lime'
                        : isCrash
                          ? 'border-rose-500/50 bg-rose-500/20'
                          : isSafeHidden
                            ? 'border-white/[0.06] bg-white/[0.02] opacity-60'
                            : fi >= level && active
                              ? 'border-white/[0.10] bg-gradient-to-b from-[#2b3449] via-[#1c2434] to-[#121926] text-slate-400 hover:border-neon-lime/50 hover:from-[#37425c] active:translate-y-[2px]'
                              : 'border-white/[0.06] bg-ink-800/50 text-slate-600'
                    }`}
                    style={{
                      transformStyle: 'preserve-3d',
                      boxShadow: isPicked
                        ? 'inset 0 2px 0 rgba(255,255,255,.35), inset 0 -3px 0 rgba(0,0,0,.45), 0 0 26px -4px rgba(198,242,78,.85), 0 6px 0 -1px #5d7d12'
                        : isCrash
                          ? 'inset 0 2px 0 rgba(255,255,255,.2), inset 0 -3px 0 rgba(0,0,0,.45), 0 6px 0 -1px #5c1327'
                          : fi >= level && active
                            ? 'inset 0 2px 0 rgba(255,255,255,.16), inset 0 -3px 0 rgba(0,0,0,.5), 0 5px 0 -1px #070b12, 0 10px 16px -8px rgba(0,0,0,.95)'
                            : 'inset 0 1px 0 rgba(255,255,255,.05)',
                    }}
                  >
                    {isPicked ? <IconDiamond size={16} className="mx-auto" /> : isCrash ? <span className="text-rose-300">💣</span> : isSafeHidden ? <IconDiamond size={12} className="mx-auto text-white/25" /> : '?'}
                  </button>
                )
              })}
            </div>
          )
        })}
      </div>
      <p className="mt-2 text-center text-[10px] text-slate-600">
        {crashed !== null ? 'Tower collapsed — start a new climb.' : active ? 'Pick one tile per floor. Cash out any time.' : 'Place a bet, then climb from the bottom floor.'}
      </p>
    </GameShell>
  )
}
