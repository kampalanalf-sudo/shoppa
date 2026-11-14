import React, { useCallback, useMemo, useState } from 'react'
import { useStore } from '../lib/store'
import { sfx } from '../lib/sound'
import { combination } from '../lib/fair'
import { money, mult } from '../lib/format'
import { gameById } from '../lib/games'
import { BetAmount, BetButton } from '../components/BetControls'
import { GameShell, PayoutRow } from '../components/GameShell'
import { IconDiamond } from '../components/Icons'

const GRID = 25
const houseEdge = 0.99

/**
 * Standard mines payout: 0.99 / P(surviving n picks)
 * P = Π (safeRemaining / tilesRemaining) — matches C(25-mines, picks) / C(25, picks).
 */
const multiplierFor = (mines: number, picks: number) => {
  if (picks <= 0) return 1
  let p = 1
  for (let i = 0; i < picks; i++) p *= (GRID - mines - i) / (GRID - i)
  if (p <= 0) return 0
  return Math.max(1, Math.round((houseEdge / p) * 100) / 100)
}

export function Mines({ onBack, onFair }: { onBack: () => void; onFair: () => void }) {
  const game = gameById('mines')!
  const { placeBet, settleBet, nextFloats, balance, sound, toast, flashLoss } = useStore()
  const [bet, setBet] = useState(10)
  const [mines, setMines] = useState(3)
  const [active, setActive] = useState(false)
  const [mineSet, setMineSet] = useState<Set<number>>(new Set())
  const [revealed, setRevealed] = useState<number[]>([])
  const [busted, setBusted] = useState<number[] | null>(null)
  const [busy, setBusy] = useState(false)

  const picks = revealed.length
  const currentMult = useMemo(() => multiplierFor(mines, picks), [mines, picks])
  const nextMult = useMemo(() => multiplierFor(mines, picks + 1), [mines, picks])
  const potential = Math.round(bet * currentMult * 100) / 100

  const start = useCallback(async () => {
    if (!(bet > 0)) return
    if (bet > balance) {
      toast({ kind: 'error', title: 'Insufficient balance', body: 'Lower your bet to continue.' })
      return
    }
    if (!placeBet('mines', bet)) return
    sfx.place()
    setBusy(true)
    // consume one float per shuffle step from the HMAC stream (unbiased Fisher–Yates)
    const raw = await nextFloats(GRID)
    const positions = Array.from({ length: GRID }, (_, i) => i)
    for (let i = positions.length - 1; i > 0; i--) {
      const j = Math.min(i, Math.floor(raw[i] * (i + 1)))
      ;[positions[i], positions[j]] = [positions[j], positions[i]]
    }
    setMineSet(new Set(positions.slice(0, mines)))
    setRevealed([])
    setBusted(null)
    setActive(true)
    setBusy(false)
  }, [bet, balance, placeBet, nextFloats, mines, toast])

  const pick = (i: number) => {
    if (!active || revealed.includes(i) || busted) return
    if (mineSet.has(i)) {
      setBusted([i])
      setActive(false)
      settleBet({ game: 'mines', wager: bet, multiplier: 0, detail: `${mines} mines · hit a mine on pick ${picks + 1}` })
      flashLoss()
      if (sound) sfx.bomb()
      return
    }
    setRevealed((r) => [...r, i])
    if (sound) sfx.gem()
  }

  const cashout = () => {
    if (!active || !picks) return
    const pay = settleBet({ game: 'mines', wager: bet, multiplier: currentMult, detail: `${mines} mines · ${picks} gems` })
    setActive(false)
    setBusted(null)
    if (sound) (currentMult >= 5 ? sfx.bigwin : sfx.cashout)()
    toast({ kind: 'win', title: `Cashed out ${mult(currentMult)}`, body: `+${money(pay)} FB secured.` })
  }

  const reset = () => {
    setActive(false)
    setBusted(null)
    setRevealed([])
  }

  return (
    <GameShell
      game={game}
      onBack={onBack}
      onFair={onFair}
      aside={
        <div className="space-y-3.5">
          <BetAmount value={bet} onChange={setBet} disabled={active} />
          <div>
            <span className="label">Mines <span className="normal-case tracking-normal text-slate-500">{mines}</span></span>
            <div className="grid grid-cols-4 gap-1">
              {[1, 3, 5, 10, 15, 20, 24].map((n) => (
                <button
                  key={n}
                  type="button"
                  disabled={active}
                  onClick={() => { setMines(n); reset(); sfx.click() }}
                  className={`num rounded-lg border py-1.5 text-[11.5px] font-bold transition disabled:opacity-40 ${
                    mines === n ? 'border-neon-violet/60 bg-neon-violet/15 text-neon-violet' : 'border-white/[0.07] bg-white/[0.03] text-slate-300 hover:border-white/20'
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          {active ? (
            <BetButton onClick={cashout} disabled={!picks} sub={`${money(potential)} FB`}>
              Cash out {mult(currentMult)}
            </BetButton>
          ) : (
            <BetButton onClick={() => void start()} disabled={busy} sub={`Next gem pays ${mult(nextMult)}`}>
              {busted ? 'Try again' : 'Place bet'}
            </BetButton>
          )}

          <div className="grid grid-cols-3 gap-2 text-center">
            {[
              { l: 'Gems', v: String(picks), c: 'text-neon-lime' },
              { l: 'Multiplier', v: mult(currentMult), c: 'text-white' },
              { l: 'Payout', v: money(potential, 0), c: 'text-neon-cyan' },
            ].map((s) => (
              <div key={s.l} className="panel-tight py-2">
                <p className="text-[9px] uppercase tracking-wider text-slate-500">{s.l}</p>
                <p className={`num text-[12px] font-bold ${s.c}`}>{s.v}</p>
              </div>
            ))}
          </div>

          <div className="space-y-1.5">
            <PayoutRow label="Grid" value="5 × 5" />
            <PayoutRow label="House edge" value="1.0%" />
            <PayoutRow label="Next multiplier" value={mult(nextMult)} highlight />
          </div>
          {picks > 0 && active && (
            <p className="text-center text-[10.5px] text-slate-500">
              Potential win <span className="num font-bold text-neon-lime">{money(potential)} FB</span>
            </p>
          )}
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
            <button type="button" onClick={cashout} disabled={!picks} className="btn-danger h-10 flex-1 !text-[13px]">
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
      <div className="mx-auto grid max-w-[520px] grid-cols-5 gap-1.5 sm:gap-2.5">
        {Array.from({ length: GRID }, (_, i) => {
          const shown = revealed.includes(i)
          const revealedMine = !active && mineSet.has(i) && !shown
          return (
            <button
              key={i}
              type="button"
              onClick={() => pick(i)}
              disabled={!active || shown}
              aria-label={`Tile ${i + 1}`}
              className={`group relative aspect-square rounded-xl border transition-all duration-200 ${
                shown
                  ? 'border-neon-lime/50 bg-gradient-to-br from-neon-lime/25 to-neon-green/10 shadow-glow'
                  : revealedMine
                    ? 'border-rose-500/40 bg-gradient-to-br from-rose-500/25 to-rose-900/20'
                    : 'border-white/[0.08] bg-gradient-to-b from-ink-700/80 to-ink-800 shadow-[inset_0_1px_0_rgba(255,255,255,.08),0_6px_14px_-8px_#000] hover:border-white/25 hover:from-ink-600/80'
              } ${active && !shown ? 'cursor-pointer active:scale-95' : ''}`}
            >
              <span className={`absolute inset-0 grid place-items-center transition ${
                shown || revealedMine ? 'scale-100 opacity-100' : 'scale-75 opacity-0 group-hover:scale-90 group-hover:opacity-25'
              }`}>
                {shown ? (
                  <IconDiamond size={26} className="text-neon-lime drop-shadow-[0_0_10px_rgba(198,242,78,.9)]" />
                ) : revealedMine ? (
                  <BombIcon />
                ) : (
                  <IconDiamond size={22} className="text-white/40" />
                )}
              </span>
              {!shown && !revealedMine && (
                <span className="absolute bottom-1 right-1.5 h-1 w-1 rounded-full bg-white/20" />
              )}
            </button>
          )
        })}
      </div>

      {busted && (
        <div className="mx-auto mt-3 max-w-[520px] animate-popIn rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-2.5 text-center">
          <p className="text-[12px] font-bold text-rose-300">Boom — you hit a mine.</p>
          <p className="text-[11px] text-slate-400">You banked {picks} gems before the blast. Place a new bet to go again.</p>
        </div>
      )}
      <p className="mt-3 text-center text-[10px] text-slate-600">Tap tiles to reveal gems · cash out any time to secure your multiplier</p>
    </GameShell>
  )
}

const BombIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ff8098" strokeWidth="1.8" strokeLinecap="round">
    <circle cx="10.5" cy="14" r="6" fill="rgba(255,128,152,.2)" />
    <path d="M15 9.5 17.5 7" />
    <path d="M17.5 7c1.6-.4 2.2-1.4 2-3 1.6.6 2.4 1.4 2.4 3.2" />
  </svg>
)
