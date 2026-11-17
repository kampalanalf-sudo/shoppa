import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../lib/store'
import { sfx } from '../lib/sound'
import { money, mult } from '../lib/format'
import { gameById } from '../lib/games'
import { BetAmount, BetButton, useHotkey } from '../components/BetControls'
import { GameShell, PayoutRow } from '../components/GameShell'
import { Slot3D, SymbolFace, Siren } from '../components/Slot3D'
import {
  MAX_WIN, REELS, ROWS, SYMBOLS, buildGrid, resolve, type Grid, type SlotOutcome, type SymbolId,
} from '../lib/slot'
import { IconBolt, IconFlame, IconTrophy } from '../components/Icons'

const PAY_ROWS: SymbolId[] = ['wild', 'bonita', 'clyve', 'diamond', 'badge', 'cash', 'key', 'donut']

export function BonniClyve({ onBack, onFair }: { onBack: () => void; onFair: () => void }) {
  const game = gameById('bonni')!
  const { placeBet, settleBet, nextFloats, balance, toast, sound } = useStore()

  const [bet, setBet] = useState(1000)
  const [grid, setGrid] = useState<Grid | null>(null)
  const [spinning, setSpinning] = useState(false)
  const [outcome, setOutcome] = useState<SlotOutcome | null>(null)
  const [winCells, setWinCells] = useState<Set<string>>(new Set())
  const [glow, setGlow] = useState<'none' | 'win' | 'bigwin' | 'chase'>('none')
  const [lastWin, setLastWin] = useState(0)
  const [freeSpins, setFreeSpins] = useState(0)
  const [autoLeft, setAutoLeft] = useState(0)
  const [history, setHistory] = useState<number[]>([4.2, 0, 12.5, 2.1, 0, 8.4])
  const timers = useRef<number[]>([])

  const clearTimers = () => {
    timers.current.forEach((t) => window.clearTimeout(t))
    timers.current = []
  }
  useEffect(() => clearTimers, [])

  const schedule = (fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms))
  }

  const spinOnce = useCallback(
    async (stake: number, free = false) => {
      if (!free) {
        if (!(stake > 0)) return false
        if (stake > balance) {
          toast({ kind: 'error', title: 'Insufficient balance', body: 'Lower your bet to continue.' })
          return false
        }
        if (!placeBet('bonni', stake)) return false
      }
      sfx.place()
      setSpinning(true)
      setGlow('none')
      setWinCells(new Set())
      setOutcome(null)

      const floats = await nextFloats(REELS * ROWS)
      const next = buildGrid(floats)

      // reels lock in one after another (3 -> 0 ms)
      schedule(() => {
        setGrid(next)
      }, 120)

      schedule(() => {
        const res = resolve(next)
        setSpinning(false)
        setOutcome(res)
        setLastWin(res.totalMultiplier)
        setHistory((h) => [res.totalMultiplier, ...h].slice(0, 14))

        const cells = new Set<string>()
        res.wins.forEach((w) =>
          w.cells.forEach((c) => {
            // winning cell positions: match the displayed row of that symbol
            cells.add(`${c.reel}-${c.row}`)
          }),
        )
        // only highlight cells that are actually part of the ways run
        const lit = new Set<string>()
        res.wins.forEach((w) => {
          w.cells.forEach((c) => {
            const cell = next[c.reel]?.[c.row]
            if (cell && (cell.id === w.symbol || cell.id === 'wild')) lit.add(`${c.reel}-${c.row}`)
          })
        })
        setWinCells(lit)

        const paid = res.totalMultiplier > 0 && !free
          ? settleBet({
              game: 'bonni',
              wager: stake,
              multiplier: res.totalMultiplier,
              detail: `${res.wins.length ? res.wins[0].symbol.toUpperCase() : 'no line'} · ${res.totalMultiplier}× ${res.chase ? '· CHASE' : ''}`,
            })
          : free && res.totalMultiplier > 0
            ? settleBet({ game: 'bonni', wager: 0, multiplier: 0, detail: 'free spin', silent: true })
            : 0

        if (res.totalMultiplier > 0) {
          setGlow(res.totalMultiplier >= 40 ? 'bigwin' : 'win')
          if (sound) (res.totalMultiplier >= 40 ? sfx.bigwin : sfx.win)()
        } else if (sound) sfx.lose()

        if (res.chase) {
          setGlow('chase')
          setFreeSpins(res.freeSpins)
          toast({ kind: 'win', title: 'Chase mode!', body: `3 sirens — ${res.freeSpins} free spins unlocked.` })
        }
        void paid
      }, 1650)

      return true
    },
    [balance, placeBet, nextFloats, settleBet, sound, toast],
  )

  const spin = useCallback(() => {
    if (spinning) return
    void spinOnce(bet)
  }, [spinning, spinOnce, bet])

  useHotkey(spin)

  // free-spin round runs itself
  useEffect(() => {
    if (freeSpins <= 0 || spinning) return
    const t = window.setTimeout(() => {
      setFreeSpins((n) => n - 1)
      void spinOnce(bet, true)
    }, 1500)
    return () => window.clearTimeout(t)
  }, [freeSpins, spinning, bet, spinOnce])

  // autoplay
  useEffect(() => {
    if (autoLeft <= 0 || spinning || freeSpins > 0) return
    const t = window.setTimeout(() => {
      setAutoLeft((n) => n - 1)
      void spinOnce(bet)
    }, 1900)
    return () => window.clearTimeout(t)
  }, [autoLeft, spinning, freeSpins, bet, spinOnce])

  const topWin = outcome?.wins[0]
  const potential = Math.round(bet * MAX_WIN * 100) / 100

  return (
    <GameShell
      game={game}
      onBack={onBack}
      onFair={onFair}
      aside={
        <div className="space-y-3.5">
          <BetAmount value={bet} onChange={setBet} disabled={spinning} />

          <BetButton
            onClick={spin}
            disabled={spinning || freeSpins > 0}
            loading={spinning}
            sub={freeSpins > 0 ? `${freeSpins} free spins left` : `${REELS}×${ROWS} · 243 ways`}
          >
            {spinning ? 'Spinning…' : freeSpins > 0 ? 'Chase mode' : 'Spin'}
          </BetButton>

          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              disabled={spinning}
              onClick={() => { setAutoLeft(10); sfx.click() }}
              className="btn-ghost !py-2 !text-[11.5px]"
            >
              <IconBolt size={13} /> Auto ×10
            </button>
            <button
              type="button"
              disabled={spinning}
              onClick={() => { setAutoLeft(0); setFreeSpins(0); sfx.click() }}
              className="btn-ghost !py-2 !text-[11.5px]"
            >
              Stop
            </button>
          </div>

          {/* win readout */}
          <div
            className={`rounded-xl border px-3 py-2.5 text-center transition ${
              lastWin >= 40
                ? 'border-gold/40 bg-gold/10'
                : lastWin > 0
                  ? 'border-neon-lime/30 bg-neon-lime/10'
                  : 'border-white/[0.07] bg-white/[0.02]'
            }`}
          >
            <p className="text-[9.5px] font-bold uppercase tracking-[.16em] text-slate-500">
              {spinning ? 'Spinning' : freeSpins > 0 ? 'Free spins' : 'Last spin'}
            </p>
            <p
              className={`num text-2xl font-black leading-tight ${
                lastWin >= 40 ? 'text-gold' : lastWin > 0 ? 'text-neon-lime' : 'text-slate-500'
              }`}
            >
              {spinning ? '—' : lastWin > 0 ? `${mult(lastWin)}` : 'No win'}
            </p>
            {topWin && !spinning && (
              <p className="truncate text-[10.5px] text-slate-400">
                {SYMBOLS[topWin.symbol].name} · {topWin.reels} reels · {topWin.ways} ways
              </p>
            )}
            {freeSpins > 0 && (
              <p className="mt-1 inline-flex items-center gap-1 rounded-full bg-neon-cyan/15 px-2 py-0.5 text-[10px] font-bold text-neon-cyan">
                <IconBolt size={10} /> {freeSpins} FREE
              </p>
            )}
          </div>

          {/* jackpot ladder */}
          <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-2.5">
            <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[.14em] text-slate-400">
              <IconTrophy size={11} className="text-gold" /> Jackpots
            </p>
            <div className="grid grid-cols-2 gap-1">
              {[
                ['Mini', '25×', '#8bff5a'],
                ['Minor', '120×', '#3ad7ff'],
                ['Major', '750×', '#a06bff'],
                ['Grand', '5,000×', '#ffcf5c'],
              ].map(([n, v, c]) => (
                <div key={n} className="rounded-lg bg-black/25 px-2 py-1">
                  <p className="text-[9px] uppercase tracking-wider text-slate-500">{n}</p>
                  <p className="num text-[11.5px] font-bold" style={{ color: c }}>{v}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <PayoutRow label="Ways to win" value="243" />
            <PayoutRow label="Theoretical RTP" value={game.rtp} highlight />
            <PayoutRow label="Max win" value={game.maxWin} />
          </div>
        </div>
      }
      footer={
        <div className="panel p-3.5">
          <p className="mb-2 text-[11px] font-bold uppercase tracking-[.14em] text-slate-400">Paytable (× total bet, per way)</p>
          <div className="space-y-1">
            {PAY_ROWS.map((id) => {
              const s = SYMBOLS[id]
              return (
                <div key={id} className="flex items-center gap-2 rounded-lg px-1 py-1 transition hover:bg-white/[0.04]">
                  <SymbolFace id={id} className="h-6 w-6 shrink-0" />
                  <span className="min-w-0 flex-1 truncate text-[11px] text-slate-300">{s.name}</span>
                  <span className="num shrink-0 text-[10px] text-slate-500">
                    {s.pay?.[0]}× · {s.pay?.[1]}× · {s.pay?.[2]}×
                  </span>
                </div>
              )
            })}
            <div className="flex items-center gap-2 rounded-lg border-t border-white/[0.06] px-1 pt-1.5">
              <Siren size={22} />
              <span className="min-w-0 flex-1 truncate text-[11px] text-slate-300">3+ Sirens</span>
              <span className="num shrink-0 text-[10px] text-neon-cyan">8 free spins</span>
            </div>
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
          <button type="button" onClick={spin} disabled={spinning || freeSpins > 0} className="btn-primary h-10 flex-1 !text-[13px]">
            {spinning ? 'Spinning…' : freeSpins > 0 ? `${freeSpins} free spins` : 'Spin'}
          </button>
        </div>
      }
    >
      {/* marquee */}
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1">
        <div className="flex items-center gap-2">
          <span className="rounded-md bg-gradient-to-r from-neon-lime to-neon-green px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-ink-950">
            3 × 5 · 243 ways
          </span>
          <span className="hidden items-center gap-1 text-[10px] text-slate-500 sm:flex">
            <IconFlame size={11} className="text-gold" /> Scatters pay on totals · 3 sirens = Chase mode
          </span>
        </div>
        <div className="flex items-center gap-1">
          {history.slice(0, 8).map((h, i) => (
            <span
              key={i}
              className={`num rounded px-1.5 py-0.5 text-[9.5px] font-bold ${
                h >= 20 ? 'bg-gold/20 text-gold' : h > 0 ? 'bg-neon-lime/15 text-neon-lime' : 'bg-white/[0.05] text-slate-500'
              }`}
            >
              {h > 0 ? `${h}×` : '–'}
            </span>
          ))}
        </div>
      </div>

      {/* on phones break out of the shell's px-3 so the board is full-bleed */}
      <div className="-mx-3 w-auto sm:mx-auto sm:w-full sm:max-w-[720px]">
        <Slot3D
          grid={grid}
          spinning={spinning}
          stopping={!spinning}
          winCells={winCells}
          glow={glow}
        />
      </div>

      {/* feature strips */}
      <div className="mx-auto mt-3 grid max-w-[720px] grid-cols-2 gap-2">
        <div className="flex items-center gap-2.5 rounded-xl border border-white/[0.07] bg-gradient-to-r from-neon-lime/[0.10] to-transparent p-2.5">
          <img src={SYMBOLS.wild.art} alt="" className="h-9 w-9 object-contain" />
          <div className="min-w-0">
            <p className="truncate text-[11.5px] font-bold text-white">Bribe Wild</p>
            <p className="truncate text-[10px] text-slate-500">Substitutes for every paying symbol</p>
          </div>
        </div>
        <div className="flex items-center gap-2.5 rounded-xl border border-white/[0.07] bg-gradient-to-r from-neon-cyan/[0.10] to-transparent p-2.5">
          <Siren size={36} />
          <div className="min-w-0">
            <p className="truncate text-[11.5px] font-bold text-white">Chase Mode</p>
            <p className="truncate text-[10px] text-slate-500">3+ sirens → 8 free spins</p>
          </div>
        </div>
      </div>

      <p className="mt-2 text-center text-[10px] text-slate-600">
        Space to spin · reels lock left to right · every outcome is HMAC-SHA256 verifiable
      </p>
      <p className="mt-1 text-center text-[9.5px] text-slate-700">
        Demo slot · characters are fictional caricatures · 18+
      </p>
      <span className="sr-only">Max win {money(potential)} PX</span>
    </GameShell>
  )
}
