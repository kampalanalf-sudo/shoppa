import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../lib/store'
import { sfx } from '../lib/sound'
import { money } from '../lib/format'
import { gameById } from '../lib/games'
import type { GameId } from '../lib/types'
import { useHotkey } from '../components/BetControls'
import { GameShell, PayoutRow } from '../components/GameShell'
import { SlotBoard3D } from '../components/SlotBoard3D'
import { PlayBar } from '../components/PlayBar'
import { buildGrid, type Grid } from '../lib/slots/engine'
import { spinPlan } from '../lib/reels'
import { Celebration, celebrationSound, FreeSpinHud } from '../components/Celebration'
import {
  CRATERS, CRATE_TRIGGER, BODA_TRIGGER, BODA_SPINS, MAX_ROUND_MULTIPLIER,
  IDLE_ROUND, advanceRound, resolveCraters, tierFor,
  type CratersOutcome, type RoundState,
} from '../lib/slots/craters'

type Props = { id: GameId; onBack: () => void; onFair: () => void }

/**
 * Craters.
 *
 * Renders through the same board, drum model and celebration layers as the
 * other engine slots — the generic `EngineSlot` cannot host this game because
 * it has no notion of a round: a crate landing *inside* free spins has to add
 * spins and raise a multiplier that applies to every spin after it. That is
 * round state, and it lives here rather than in the config.
 */
export function Craters({ id, onBack, onFair }: Props) {
  const game = gameById(id)!
  const cfg = CRATERS
  const { placeBet, settleBet, nextFloats, balance, toast, sound, flashLoss } = useStore()

  const [bet, setBet] = useState(1000)
  const [grid, setGrid] = useState<Grid | null>(null)
  const [spinning, setSpinning] = useState(false)
  const [outcome, setOutcome] = useState<CratersOutcome | null>(null)
  const [winCells, setWinCells] = useState<Set<string>>(new Set())
  const [glow, setGlow] = useState<'none' | 'win' | 'omen' | 'free'>('none')
  const [spinKey, setSpinKey] = useState(0)
  const [history, setHistory] = useState<number[]>([])
  const [lastWin, setLastWin] = useState(0)

  // ---- round state. ONE object, so spins / multiplier / delivery can never
  // disagree with each other, and clearing it is a single assignment back to
  // IDLE_ROUND rather than three resets that can drift apart.
  const [round, setRound] = useState<RoundState>(IDLE_ROUND)
  const [freeTotal, setFreeTotal] = useState(0)
  const freeWon = useRef(0)
  const freeSpins = round.left
  const roundMult = round.multiplier
  const delivery = round.delivery

  const [autoplay, setAutoplay] = useState(0)
  const [party, setParty] = useState<{
    kind: 'freespins' | 'bigwin' | 'mega'
    title: string
    subtitle?: string
    amount?: number
    spins?: number
  } | null>(null)

  const safe = (fn: () => void) => { try { fn() } catch { /* audio is best-effort */ } }

  const spin = useCallback(async () => {
    if (spinning) return
    const inRound = freeSpins > 0

    if (!inRound) {
      if (!(bet > 0)) return
      if (bet > balance) {
        toast({ kind: 'error', title: 'Insufficient balance', body: 'Lower your bet to continue.' })
        return
      }
      if (!placeBet(id, bet)) return
    } else {
      // Spend a free spin. The multiplier and delivery flag stay.
      setRound((r) => ({ ...r, left: r.left - 1 }))
    }

    safe(() => sfx.spinStart())
    safe(() => sfx.place())
    setSpinning(true)
    setGlow('none')
    setWinCells(new Set())

    const floats = await nextFloats(cfg.reels * cfg.rows)
    const g = buildGrid(cfg, floats)

    // The multiplier and the delivery bonus apply to the spin played *after*
    // they were awarded, which is why they are read from state that was set on
    // the previous landing rather than from this outcome.
    const out = resolveCraters(cfg, g, { multiplier: roundMult, delivery })

    const payout = Math.round(bet * out.total * 100) / 100
    const detail = out.crates >= CRATE_TRIGGER
      ? `${out.crates} crates → ${out.freeSpins || 'retrigger'} spins`
      : out.delivery
        ? 'Delivery run — bottles doubled'
        : out.wins.length
          ? `${out.wins[0].symbol} ×${out.wins[0].multiplier}`
          : 'No win'

    const plan = spinPlan(cfg.reels)

    // Publish the landing before the drums move: each drum builds its strip as
    // "where I am" -> "where I must land", which is what stops the board
    // jumping at t=0. Same contract as EngineSlot.
    setGrid(out.grid)
    setSpinKey((k) => k + 1)

    plan.reels.forEach((r) => {
      window.setTimeout(() => safe(() => sfx.reelStop(r.reel)), r.stopMs)
    })

    window.setTimeout(() => {
      setSpinning(false)
      setOutcome(out)
      setLastWin(out.total)
      setHistory((h) => [out.total, ...h].slice(0, 12))

      const cells = new Set<string>()
      for (const w of out.wins) for (const c of w.cells) cells.add(`${c.reel}-${c.row}`)
      setWinCells(cells)

      // ONE transition decides what this spin did to the round. The same
      // function drives the Monte Carlo, so what the test measures is what the
      // player gets.
      const next = advanceRound(round, out)
      const gained = next.left - round.left
      const opened = round.left === 0 && next.left > 0
      const crateHit = out.crates >= CRATE_TRIGGER
      const bodaHit = out.bodas >= BODA_TRIGGER

      if (opened || gained > 0) {
        setRound(next)
        setFreeTotal((n) => n + Math.max(0, gained))
        if (opened) freeWon.current = 0
        setGlow('free')
        safe(() => sfx.scatter())
        if (sound) celebrationSound('freespins')
        setParty({
          kind: 'freespins',
          title: opened ? 'Delivery ordered' : crateHit ? 'More crates in' : 'Boda boda',
          subtitle: [
            crateHit ? `${out.crates} crates — every crate raises the multiplier.` : '',
            bodaHit ? `Boda boda: bottles pay double for ${BODA_SPINS} spins.` : '',
          ].filter(Boolean).join(' '),
          spins: Math.max(0, gained),
        })
      } else if (gained === 0 && (crateHit || bodaHit)) {
        // Trigger at the cap: still advance the multiplier, grant nothing.
        setRound(next)
      } else if (out.total >= 5) {
        setGlow('win')
      }

      if (out.total > 0) {
        const won = Math.round(bet * out.total)
        const tier = tierFor(out.total)
        if (tier) {
          setParty({
            kind: tier.kind,
            title: tier.label,
            subtitle: out.roundMultiplier > 1 ? `at ${out.roundMultiplier}× round multiplier` : undefined,
            amount: won,
          })
          if (sound) celebrationSound(tier.kind)
        } else if (sound) sfx.win()
      }

      if (inRound) freeWon.current += Math.round(bet * out.total)

      // settleBet credits wager × multiplier: the full return including stake.
      const celebrating = out.crates >= CRATE_TRIGGER || Boolean(tierFor(out.total))
      settleBet({
        game: id,
        wager: inRound ? 0 : bet,
        multiplier: out.total,
        detail,
        silent: celebrating,
      })
    }, plan.totalMs)
  }, [spinning, freeSpins, bet, balance, roundMult, delivery, placeBet, id, cfg, nextFloats, settleBet, toast, sound])

  // Round over: pay out the summary and clear every bit of round state, so the
  // next paid spin cannot inherit a multiplier or a delivery bonus.
  useEffect(() => {
    if (freeSpins > 0 || freeTotal <= 0) return
    const total = freeWon.current
    const mult = roundMult
    freeWon.current = 0
    setFreeTotal(0)
    // Back to a clean slate: no multiplier, no delivery bonus, no spins.
    setRound(IDLE_ROUND)
    if (total <= 0) return
    setParty({
      kind: total >= bet * 40 ? 'mega' : 'bigwin',
      title: 'Delivery complete',
      subtitle: mult > 1 ? `Reached ${mult}× on the crates.` : undefined,
      amount: total,
    })
    if (sound) celebrationSound(total >= bet * 40 ? 'mega' : 'bigwin')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [freeSpins])

  useHotkey(() => { if (autoplay === 0) void spin() })

  useEffect(() => {
    if (autoplay <= 0 || spinning || party) return
    const t = window.setTimeout(() => {
      void spin()
      setAutoplay((n) => Math.max(0, n - 1))
    }, 600)
    return () => window.clearTimeout(t)
  }, [autoplay, spinning, spin, party])

  const payRows = useMemo(() => cfg.symbols.filter((s) => s.pay), [cfg])
  const inRound = freeSpins > 0

  return (
    <GameShell
      game={game}
      onBack={onBack}
      onFair={onFair}
      aside={
        <div className="space-y-3.5">
          <div className="space-y-1.5">
            <PayoutRow label="RTP" value={game.rtp} />
            <PayoutRow label="Volatility" value={cfg.volatility} />
            <PayoutRow label="Max win" value={game.maxWin} />
            <PayoutRow label="Crate trigger" value={`${CRATE_TRIGGER}+`} />
            <PayoutRow label="Top multiplier" value={`${MAX_ROUND_MULTIPLIER}×`} />
          </div>

          {/* Round panel: only exists while a round runs, so it reads as an
              event rather than permanent chrome. */}
          {inRound && (
            <div className="panel border-neon-cyan/30 p-3.5">
              <p className="mb-2 text-[10px] font-bold uppercase tracking-[.14em] text-neon-cyan/80">
                Delivery round
              </p>
              <div className="flex items-baseline justify-between">
                <span className="text-[11px] text-slate-400">Multiplier</span>
                <span className="num text-lg font-black text-neon-cyan">{roundMult}×</span>
              </div>
              <div className="mt-1 flex items-baseline justify-between">
                <span className="text-[11px] text-slate-400">Spins left</span>
                <span className="num text-sm font-bold text-white">{freeSpins}</span>
              </div>
              {delivery && (
                <p className="mt-1.5 text-[10px] font-bold text-neon-lime">Bottles paying 2× — delivery run</p>
              )}
            </div>
          )}
        </div>
      }
      footer={
        history.length ? (
          <div className="panel p-3.5">
            <p className="mb-2 text-[11px] font-bold uppercase tracking-[.14em] text-slate-400">Last spins</p>
            <div className="flex flex-wrap gap-1">
              {history.map((h, i) => (
                <span
                  key={i}
                  className={`num rounded px-1.5 py-0.5 text-[10px] font-bold ${
                    h >= 20 ? 'bg-gold/20 text-gold' : h > 0 ? 'bg-neon-lime/15 text-neon-lime' : 'bg-white/[0.05] text-slate-500'
                  }`}
                >
                  {h > 0 ? `${h}×` : '–'}
                </span>
              ))}
            </div>
          </div>
        ) : undefined
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

      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1">
        <div className="flex items-center gap-2">
          <span className="rounded-md bg-gradient-to-r from-neon-lime to-neon-green px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-ink-950">
            {cfg.reels} × {cfg.rows} · ways
          </span>
          {inRound ? (
            <span className="flex items-center gap-1 text-[10px] font-bold text-neon-cyan">
              📦 {roundMult}× multiplier
            </span>
          ) : (
            <span className="hidden items-center gap-1 text-[10px] text-slate-500 sm:flex">
              🍾 Nile Special &amp; Club Pilsener pay best
            </span>
          )}
        </div>
        {lastWin > 0 && !spinning && (
          <span className="num text-[11px] font-bold text-neon-lime">last {lastWin}×</span>
        )}
      </div>

      <div className="relative -mx-3 w-auto sm:mx-auto sm:w-full sm:max-w-[760px]">
        <FreeSpinHud left={freeSpins} total={freeTotal} tick={freeTotal - freeSpins} />
        <SlotBoard3D
          config={cfg}
          grid={grid}
          spinning={spinning}
          spinKey={spinKey}
          winCells={winCells}
          glow={glow}
        />
      </div>

      <PlayBar
        bet={bet}
        onBet={setBet}
        onSpin={() => void spin()}
        spinning={spinning}
        freeSpins={freeSpins}
        autoLeft={autoplay}
        onAuto={(n) => { setAutoplay(n); sfx.click() }}
        onStop={() => setAutoplay(0)}
        lastWin={outcome?.total ?? 0}
        sub={`Space to spin · ${cfg.reels}×${cfg.rows} ways · HMAC-SHA256 verifiable`}
      />

      {outcome && !spinning && (
        <div
          className={`mx-auto mt-2 max-w-[760px] rounded-xl border px-3 py-2 text-center ${
            outcome.total > 0
              ? 'border-neon-lime/40 bg-neon-lime/10 text-neon-lime'
              : 'border-white/[0.07] bg-white/[0.02] text-slate-500'
          }`}
        >
          <p className="text-[11.5px] font-bold">
            {outcome.total > 0
              ? `You won $UGX {money(bet * outcome.total)} · ${outcome.total}×${
                  outcome.roundMultiplier > 1 ? ` (${outcome.roundMultiplier}× round)` : ''
                }`
              : 'No win this spin — the crates are still out there'}
          </p>
        </div>
      )}

      {/* feature strips */}
      <div className="mx-auto mt-3 grid max-w-[760px] grid-cols-2 gap-2">
        <div className="flex items-center gap-2.5 rounded-xl border border-white/[0.07] bg-gradient-to-r from-neon-lime/[0.10] to-transparent p-2.5">
          <span className="text-[18px]">🤵🏿</span>
          <div className="min-w-0">
            <p className="truncate text-[11.5px] font-bold text-white">Bartender — wild</p>
            <p className="truncate text-[10px] text-slate-500">Covers any bottle on the board</p>
          </div>
        </div>
        <div className="flex items-center gap-2.5 rounded-xl border border-white/[0.07] bg-gradient-to-r from-neon-cyan/[0.10] to-transparent p-2.5">
          <span className="text-[18px]">📦</span>
          <div className="min-w-0">
            <p className="truncate text-[11.5px] font-bold text-white">Crate — scatter</p>
            <p className="truncate text-[10px] text-slate-500">
              {CRATE_TRIGGER}+ = 10 free spins, +1× per crate in the round
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2.5 rounded-xl border border-white/[0.07] bg-gradient-to-r from-gold/[0.10] to-transparent p-2.5 col-span-2">
          <span className="text-[18px]">🛵</span>
          <div className="min-w-0">
            <p className="truncate text-[11.5px] font-bold text-gold">Boda boda — delivery run</p>
            <p className="truncate text-[10px] text-slate-500">
              {BODA_TRIGGER} anywhere = 3 free spins where every bottle pays double
            </p>
          </div>
        </div>
      </div>

      {/* paytable */}
      <div className="mx-auto mt-3 max-w-[760px] rounded-xl border border-white/[0.07] bg-ink-850/80 p-3">
        <p className="mb-2 text-[10px] font-bold uppercase tracking-[.14em] text-slate-500">
          Paytable (× bet, per way)
        </p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
          {payRows.map((s) => (
            <div key={s.id} className="flex items-center justify-between gap-2 text-[10.5px]">
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="text-[13px]">{s.glyph}</span>
                <span className="truncate text-slate-400">{s.name.replace(/ \(.*\)/, '')}</span>
              </span>
              <span className="num shrink-0 text-slate-300">
                {s.pay!.map((p) => (p >= 1 ? p.toFixed(1) : p.toFixed(2))).join(' / ')}
              </span>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[9.5px] text-slate-600">
          Crate pays {cfg.scatterPay.slice(0, 2).map((p) => `${p}×`).join(' / ')} on 3 / 4 anywhere.
        </p>
      </div>

      <p className="mt-2 text-center text-[9.5px] text-slate-600">
        Space to spin · Drink responsibly · 18+ · Play within your means
      </p>
    </GameShell>
  )
}
