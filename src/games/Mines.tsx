import React, { useCallback, useMemo, useRef, useState } from 'react'
import { useStore } from '../lib/store'
import { sfx } from '../lib/sound'
import { combination } from '../lib/fair'
import { revealCell, startBoardRound, type Reveal } from '../lib/play'
import { MINE_GRID, minesMultiplier } from '../../supabase/functions/_shared/games'
import { money, mult } from '../lib/format'
import { gameById } from '../lib/games'
import { BetAmount, BetButton } from '../components/BetControls'
import { GameShell, PayoutRow } from '../components/GameShell'
import { IconDiamond } from '../components/Icons'
import { MIN_BET } from '../lib/currency'

const GRID = MINE_GRID

/**
 * The payout table, from the module the SERVER settles with.
 *
 * It used to be a local copy. A copy is a table that can drift, and drift here
 * means the board shows one multiplier while the server pays another — the bug
 * the wheel shipped on its first pass.
 */
const multiplierFor = minesMultiplier

export function Mines({ onBack, onFair }: { onBack: () => void; onFair: () => void }) {
  const game = gameById('mines')!
  const { balance, sound, toast, flashLoss, finishRound, syncBalance } = useStore()
  const [bet, setBet] = useState(MIN_BET)
  const [mines, setMines] = useState(3)
  const [active, setActive] = useState(false)
  /**
   * The open round and what the SERVER has confirmed.
   *
   * There is deliberately no local minefield: the layout stays on the server, so
   * `busted` and `gems` are the only truth this component holds. Before this,
   * the whole board was built in the browser from floats it had generated, which
   * is why a modified client could walk it.
   */
  const openRef = useRef<{ round: string; nonce: number; server_hash: string } | null>(null)
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
    setBusy(true)
    try {
      const started = await startBoardRound('mines', Math.round(bet), { mines })
      openRef.current = { round: String(started.round), nonce: started.nonce, server_hash: started.server_hash }
      sfx.place()
      setRevealed([])
      setBusted(null)
      setActive(true)
    } catch (e) {
      toast({ kind: 'error', title: 'Bet refused', body: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }, [bet, balance, mines, toast])

  const pick = async (i: number) => {
    const open = openRef.current
    if (!active || !open || revealed.includes(i) || busted) return
    try {
      const res: Reveal = await revealCell(open.round, i)
      if (res.busted) {
        setBusted(res.mines_at ?? [i])
        setActive(false)
        openRef.current = null
        syncBalance()
        flashLoss()
        if (sound) sfx.bomb()
        return
      }
      setRevealed(res.picks ?? [])
      if (sound) sfx.gem()
    } catch (e) {
      toast({ kind: 'error', title: 'That pick failed', body: (e as Error).message })
    }
  }

  const cashout = async () => {
    const open = openRef.current
    if (!active || !open || !picks) return
    try {
      const res = await revealCell(open.round, 0, true)
      openRef.current = null
      setActive(false)
      setBusted(null)
      syncBalance()
      if (sound) (currentMult >= 5 ? sfx.bigwin : sfx.cashout)()
      toast({ kind: 'win', title: `Cashed out ${mult(res.multiplier ?? currentMult)}`, body: `+UGX ${money(res.payout ?? 0)} secured.` })
    } catch (e) {
      toast({ kind: 'error', title: 'Cash-out failed', body: (e as Error).message })
    }
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
            <BetButton onClick={cashout} disabled={!picks} sub={`$UGX {money(potential)}`}>
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
              { l: 'Payout', v: money(potential), c: 'text-neon-cyan' },
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
              Potential win <span className="num font-bold text-neon-lime">UGX {money(potential)}</span>
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
            <span className="text-[9px] font-bold text-neon-lime/70">UGX</span>
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
      <div className="mx-auto grid max-w-[520px] grid-cols-5 gap-1.5 sm:gap-2.5" style={{ perspective: "900px" }}>
        {Array.from({ length: GRID }, (_, i) => {
          const shown = revealed.includes(i)
          // After a bust the server sends the full layout, because the round is
          // already closed and the reveal can no longer help anyone.
          const revealedMine = !active && (busted ?? []).includes(i) && !shown
          return (
            <div
              key={i}
              className={`flip3d aspect-square ${shown || revealedMine ? 'is-revealed' : ''} ${active && !shown ? 'cursor-pointer' : ''}`}
              onClick={() => pick(i)}
              role="button"
              tabIndex={active && !shown ? 0 : -1}
              aria-label={`Tile ${i + 1}`}
              aria-disabled={!active || shown}
              onKeyDown={(e) => {
                if ((e.key === 'Enter' || e.key === ' ') && active && !shown) { e.preventDefault(); pick(i) }
              }}
            >
              <div className="flip3d-inner rounded-xl">
                {/* face-down: embossed 3D plate */}
                <div
                  className={`flip3d-face border border-white/[0.09] rounded-xl transition-all duration-200 ${
                    active ? 'hover:border-neon-lime/40 hover:brightness-125' : ''
                  }`}
                  style={{
                    background:
                      'linear-gradient(155deg, #2a3348 0%, #1a2132 42%, #131a28 62%, #202a3d 100%)',
                    boxShadow:
                      'inset 0 1px 0 rgba(255,255,255,.14), inset 0 -2px 3px rgba(0,0,0,.6), 0 8px 16px -10px rgba(0,0,0,.95)',
                  }}
                >
                  <span className="absolute inset-[14%] rounded-md border border-white/[0.05]" />
                  <IconDiamond size={20} className="text-white/[0.13]" />
                  <span className="absolute bottom-1 right-1.5 h-1 w-1 rounded-full bg-white/25 shadow-[0_0_6px_rgba(255,255,255,.5)]" />
                </div>
                {/* face-up: gem or bomb */}
                <div
                  className={`flip3d-face flip3d-back rounded-xl border ${
                    shown ? 'border-neon-lime/60' : 'border-rose-500/50'
                  }`}
                  style={{
                    background: shown
                      ? 'radial-gradient(circle at 40% 30%, rgba(198,242,78,.42), rgba(30,44,20,.95) 70%)'
                      : 'radial-gradient(circle at 40% 30%, rgba(255,80,110,.42), rgba(46,14,22,.95) 70%)',
                    boxShadow: shown
                      ? 'inset 0 1px 0 rgba(255,255,255,.3), 0 0 26px -4px rgba(198,242,78,.75)'
                      : 'inset 0 1px 0 rgba(255,255,255,.2), 0 0 26px -4px rgba(255,80,110,.7)',
                  }}
                >
                  {shown ? (
                    <IconDiamond size={30} className="text-neon-lime drop-shadow-[0_0_12px_rgba(198,242,78,1)]" />
                  ) : (
                    <BombIcon />
                  )}
                </div>
              </div>
            </div>
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
