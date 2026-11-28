import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../lib/store'
import { sfx } from '../lib/sound'
import { money, mult } from '../lib/format'
import { gameById } from '../lib/games'
import { useHotkey } from '../components/BetControls'
import { PlayBar } from '../components/PlayBar'
import { GameShell, PayoutRow } from '../components/GameShell'
import { Slot3D, SymbolFace, Siren } from '../components/Slot3D'
import {
  MAX_WIN, REELS, ROWS, SYMBOLS, buildGrid, resolve, type Grid, type SlotOutcome, type SymbolId,
} from '../lib/slot'
import { IconBolt, IconFlame, IconTrophy } from '../components/Icons'
import { spinPlan } from '../lib/reels'
import { Celebration, celebrationSound, FreeSpinHud } from '../components/Celebration'
import { MIN_BET } from '../lib/currency'
import type { Grid as BonniGrid } from '../lib/slot'

const PAY_ROWS: SymbolId[] = ['wild', 'bonita', 'clyve', 'diamond', 'badge', 'cash', 'key', 'donut']

export function BonniClyve({ onBack, onFair }: { onBack: () => void; onFair: () => void }) {
  const game = gameById('bonni')!
  const { placeBet, settleBet, nextFloats, balance, toast, sound, mode, playGame } = useStore()

  const [bet, setBet] = useState(MIN_BET)
  const [grid, setGrid] = useState<Grid | null>(null)
  const [spinning, setSpinning] = useState(false)
  const [outcome, setOutcome] = useState<SlotOutcome | null>(null)
  const [winCells, setWinCells] = useState<Set<string>>(new Set())
  const [glow, setGlow] = useState<'none' | 'win' | 'bigwin' | 'chase'>('none')
  const [lastWin, setLastWin] = useState(0)
  const [freeSpins, setFreeSpins] = useState(0)
  // total awarded this round, so the HUD can show a progress bar
  const [freeTotal, setFreeTotal] = useState(0)
  // running total won during the free-spin round
  const freeWon = useRef(0)
  const [autoLeft, setAutoLeft] = useState(0)
  const [history, setHistory] = useState<number[]>([4.2, 0, 12.5, 2.1, 0, 8.4])
  // Bumped the instant an outcome is published, so the drums start their travel
  // against a board that already has a target.
  const [spinKey, setSpinKey] = useState(0)
  // What, if anything, is being celebrated right now. A free-spin trigger or a
  // big win inside free spins takes over the screen for a couple of seconds.
  const [party, setParty] = useState<{
    kind: 'freespins' | 'bigwin' | 'mega'
    title: string
    subtitle?: string
    amount?: number
    spins?: number
  } | null>(null)
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
      sfx.spinStart()
      sfx.place()
      setSpinning(true)
      setGlow('none')
      setWinCells(new Set())
      setOutcome(null)

      /*
       * A PAID spin is decided by the server.
       *
       * It returns the grid and the multiplier together, so the drums land on
       * symbols that have already been paid. Free spins keep the local path:
       * they are extra spins on a round that was already settled, and they pay
       * nothing that was not paid for.
       */
      let next: BonniGrid
      let serverMult: number | null = null
      if (!free && mode === 'real') {
        const settled = await playGame('bonni', stake, {})
        const rows = JSON.parse(String(settled.payload.grid ?? '[]')) as string[][]
        if (rows.length !== REELS || rows.some((reel) => reel.length !== ROWS)) {
          toast({ kind: 'error', title: 'Spin refused', body: 'The server returned an unexpected reel shape.' })
          setSpinning(false)
          return
        }
        next = rows.map((reel, r) => reel.map((id, row) => ({ id: id as SymbolId, reel: r, row })))
        serverMult = settled.multiplier
      } else {
        const floats = await nextFloats(REELS * ROWS)
        next = buildGrid(floats)
      }

      // ONE clock for the drums and the payout. The board publishes this exact
      // plan in the same frame, so the result can never be committed before the
      // last drum is at rest (or long after it, which reads as a stall).
      const plan = spinPlan(REELS)

      // Publish the outcome to the board NOW, while it is still sitting on the
      // previous symbols. Each drum builds its strip from "what I am showing"
      // to "where I must land", which is what stops the board jumping at t=0.
      // React batches these, so the drums receive grid + spinKey together.
      setGrid(next)
      setSpinKey((k) => k + 1)

      // One click per drum, at the moment it actually lands.
      plan.reels.forEach((r) => {
        schedule(() => sfx.reelStop(r.reel), r.stopMs)
      })

      schedule(() => {
        const res = resolve(next)
        setSpinning(false)
        setOutcome(res)
        setLastWin(res.totalMultiplier)
        setHistory((h) => [res.totalMultiplier, ...h].slice(0, 14))

        // only highlight cells that are actually part of the ways run
        const lit = new Set<string>()
        res.wins.forEach((w) => {
          w.cells.forEach((c) => {
            const cell = next[c.reel]?.[c.row]
            if (cell && (cell.id === w.symbol || cell.id === 'wild')) lit.add(`${c.reel}-${c.row}`)
          })
        })
        setWinCells(lit)

        // If this spin raises the full celebration card, suppress the global
        // win flash: two overlapping confetti layers is noise, not excitement.
        const celebrating = res.chase || res.totalMultiplier >= 40
        // The server already paid a real-money spin; only free play settles here.
        const paid = serverMult !== null
          ? Math.round(stake * serverMult)
          : res.totalMultiplier > 0 && !free
          ? settleBet({
              game: 'bonni',
              wager: stake,
              multiplier: res.totalMultiplier,
              detail: `${res.wins.length ? res.wins[0].symbol.toUpperCase() : 'no line'} · ${res.totalMultiplier}× ${res.chase ? '· CHASE' : ''}`,
              silent: celebrating,
            })
          : free && res.totalMultiplier > 0
            ? settleBet({ game: 'bonni', wager: 0, multiplier: 0, detail: 'free spin', silent: true })
            : 0

        if (!res.chase && res.scatters >= 3) window.setTimeout(() => sfx.scatter(), 260)

        if (res.chase) {
          // Free spins: full celebration instead of a toast. The board stays
          // behind it, so the player sees the three sirens that caused it.
          setParty({
            kind: 'freespins',
            title: 'Chase mode',
            subtitle: `${res.scatters} sirens landed — the chase is on.`,
            spins: res.freeSpins,
          })
          if (sound) celebrationSound('freespins')
        } else if (res.totalMultiplier >= 40) {
          setGlow('bigwin')
          setParty({
            kind: res.totalMultiplier >= 120 ? 'mega' : 'bigwin',
            title: res.totalMultiplier >= 120 ? 'Mega win' : 'Big win',
            subtitle: free ? 'Won on a free spin' : undefined,
            amount: Math.round(stake * res.totalMultiplier),
          })
          if (sound) celebrationSound(res.totalMultiplier >= 120 ? 'mega' : 'bigwin')
        } else if (res.totalMultiplier > 0) {
          setGlow('win')
          if (sound) sfx.win()
        } else if (sound) sfx.omen()

        if (free) freeWon.current += Math.round(stake * res.totalMultiplier)

        if (res.chase) {
          setGlow('chase')
          setFreeSpins(res.freeSpins)
          setFreeTotal(res.freeSpins)
        }
        void paid
      }, plan.totalMs)

      return true
    },
    [balance, placeBet, nextFloats, settleBet, sound, toast],
  )

  const spin = useCallback(() => {
    if (spinning) return
    void spinOnce(bet)
  }, [spinning, spinOnce, bet])

  useHotkey(spin)

  // free-spin round runs itself — but waits for any celebration to clear, so
  // the fanfare is never cut off by the next spin starting underneath it.
  useEffect(() => {
    if (freeSpins <= 0 || spinning || party) return
    const t = window.setTimeout(() => {
      setFreeSpins((n) => n - 1)
      void spinOnce(bet, true)
    }, 1500)
    return () => window.clearTimeout(t)
  }, [freeSpins, spinning, bet, spinOnce, party])

  // The round just finished: celebrate the total before handing the board back.
  useEffect(() => {
    if (freeSpins > 0 || freeTotal <= 0) return
    const total = freeWon.current
    freeWon.current = 0
    setFreeTotal(0)
    if (total <= 0) return
    setParty({
      kind: total >= bet * 40 ? 'mega' : 'bigwin',
      title: 'Free spins complete',
      subtitle: `All ${freeTotal} spins played.`,
      amount: total,
    })
    if (sound) celebrationSound(total >= bet * 40 ? 'mega' : 'bigwin')
    // fires once, when the counter reaches zero
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [freeSpins])

  // autoplay
  useEffect(() => {
    if (autoLeft <= 0 || spinning || freeSpins > 0 || party) return
    const t = window.setTimeout(() => {
      setAutoLeft((n) => n - 1)
      void spinOnce(bet)
    }, 1900)
    return () => window.clearTimeout(t)
  }, [autoLeft, spinning, freeSpins, bet, spinOnce, party])

  const topWin = outcome?.wins[0]
  const potential = Math.round(bet * MAX_WIN * 100) / 100

  return (
    <GameShell
      game={game}
      onBack={onBack}
      onFair={onFair}
      aside={
        <div className="space-y-3.5">
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
    >
      {party && (
        <Celebration
          kind={party.kind}
          title={party.title}
          subtitle={party.subtitle}
          amount={party.amount}
          spins={party.spins}
          onDone={() => setParty(null)}
        />
      )}

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
      <div className="relative -mx-3 w-auto sm:mx-auto sm:w-full sm:max-w-[720px]">
        <FreeSpinHud left={freeSpins} total={Math.max(freeSpins, freeTotal)} tick={freeTotal - freeSpins} />
        <Slot3D
          grid={grid}
          spinning={spinning}
          spinKey={spinKey}
          stopping={!spinning}
          winCells={winCells}
          glow={glow}
        />
      </div>

      <PlayBar
        bet={bet}
        onBet={setBet}
        onSpin={spin}
        spinning={spinning}
        freeSpins={freeSpins}
        autoLeft={autoLeft}
        onAuto={(n) => { setAutoLeft(n); sfx.click() }}
        onStop={() => { setAutoLeft(0); setFreeSpins(0) }}
        lastWin={outcome?.totalMultiplier ?? 0}
        sub="Space to spin · 243 ways · HMAC-SHA256 verifiable"
      />

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
        Characters are fictional · 18+ · Play responsibly
      </p>
      <span className="sr-only">Max win UGX {money(potential)}</span>
    </GameShell>
  )
}
