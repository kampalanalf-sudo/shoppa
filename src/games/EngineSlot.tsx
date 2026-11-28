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
import { buildGrid, resolve, type Grid, type SlotConfig, type SlotOutcome } from '../lib/slots/engine'
import { spinPlan } from '../lib/reels'
import { Celebration, celebrationSound, FreeSpinHud } from '../components/Celebration'
import { MIN_BET } from '../lib/currency'

type Props = { config: SlotConfig; id: GameId; onBack: () => void; onFair: () => void }

export function EngineSlot({ config, id, onBack, onFair }: Props) {
  const game = gameById(id)!
  const { placeBet, settleBet, nextFloats, balance, toast, sound, flashLoss, mode, playGame } = useStore()

  const [bet, setBet] = useState(MIN_BET)
  const [grid, setGrid] = useState<Grid | null>(null)
  const [spinning, setSpinning] = useState(false)
  const [outcome, setOutcome] = useState<SlotOutcome | null>(null)
  const [winCells, setWinCells] = useState<Set<string>>(new Set())
  const [glow, setGlow] = useState<'none' | 'win' | 'omen' | 'free'>('none')
  const [freeSpins, setFreeSpins] = useState(0)
  const [freeTotal, setFreeTotal] = useState(0)
  const freeWon = useRef(0)
  const [autoplay, setAutoplay] = useState(0)
  const [history, setHistory] = useState<number[]>([])
  const [lastWin, setLastWin] = useState(0)
  // Bumped the instant an outcome is published, so the drums start travelling
  // against a board that already knows where it lands.
  const [spinKey, setSpinKey] = useState(0)
  // A free-spin trigger or a big win takes over the screen for a moment.
  const [party, setParty] = useState<{
    kind: 'freespins' | 'bigwin' | 'mega'
    title: string
    subtitle?: string
    amount?: number
    spins?: number
  } | null>(null)
  const autoRef = useRef(false)

  const safe = (fn: () => void) => { try { fn() } catch { /* audio best-effort */ } }

  const spin = useCallback(async () => {
    if (spinning) return
    const free = freeSpins > 0
    if (!free) {
      if (!(bet > 0)) return
      if (bet > balance) {
        toast({ kind: 'error', title: 'Insufficient balance', body: 'Lower your bet to continue.' })
        return
      }
      if (!placeBet(id, bet)) return
    } else {
      setFreeSpins((n) => n - 1)
    }

    safe(() => sfx.spinStart())
    safe(() => sfx.place())
    setSpinning(true)
    setGlow('none')
    setWinCells(new Set())

    /*
     * A PAID spin is decided by the server: it returns the grid and the
     * multiplier together, so the drums land on symbols that have already been
     * paid. Free spins keep the local path — they are extra spins on a round
     * that was already settled.
     */
    let out: ReturnType<typeof resolve>
    let serverMult: number | null = null
    if (!free && mode === 'real') {
      /*
       * A refusal here used to leave the button on "Spinning…" for good.
       *
       * `setSpinning(true)` has already run and the only code that clears it is
       * the animation callback further down — so any throw between the two (no
       * session, the server declining the stake, an open round elsewhere, a
       * dropped request) disabled the button and the game until a reload. The
       * player saw a spin that never happened and could not try again. The other
       * arcade games have always wrapped this step; these two did not.
       */
      let settled: Awaited<ReturnType<typeof playGame>>
      try {
        settled = await playGame(id, bet, {})
      } catch (e) {
        setSpinning(false)
        toast({ kind: 'error', title: 'Spin refused', body: (e as Error).message })
        return
      }
      const rows = JSON.parse(String(settled.payload.grid ?? '[]')) as string[][]
      // A wrong-sized grid throws later, inside an animation callback, and
      // leaves the button on "Spinning…" for good. Check it here.
      if (rows.length !== config.reels || rows.some((reel) => reel.length !== config.rows)) {
        toast({ kind: 'error', title: 'Spin refused', body: 'The server returned an unexpected reel shape.' })
        setSpinning(false)
        return
      }
      const g = rows.map((reel, r) => reel.map((sym, row) => ({ id: sym, reel: r, row })))
      out = resolve(config, g)
      serverMult = settled.multiplier
      // `resolve` on the server's own grid must reproduce the paid multiplier;
      // if it ever disagrees, trust the server and say so rather than pay twice.
      const paidMult = serverMult
      if (Math.abs(out.totalMultiplier - paidMult) > 0.011) {
        toast({
          kind: 'error',
          title: 'Payout mismatch',
          body: `The board reads ${out.totalMultiplier}×, the server paid ${paidMult}×. The server is authoritative.`,
        })
      }
    } else {
      const floats = await nextFloats(config.reels * config.rows)
      out = resolve(config, buildGrid(config, floats))
    }

    const payout = Math.round(bet * out.totalMultiplier * 100) / 100
    const detail = out.fine > 0
      ? `Faith fined you ${out.fine}×`
      : out.triggered
        ? `${out.scatters} ${config.scatter} → ${out.freeSpins} free spins`
        : out.wins.length
          ? `${out.wins[0].symbol} ×${out.wins[0].multiplier}`
          : 'No win'

    // ONE clock for the drums and the payout. The board publishes this same
    // plan in the same frame, so the win highlight can never appear before the
    // last drum has landed — nor long after it, which reads as a stall.
    const plan = spinPlan(config.reels)

    // Publish the outcome NOW, while the board is still sitting on the previous
    // symbols. Each drum builds its strip from "what I am showing" to "where I
    // must land", which is what stops the board jumping at t=0.
    setGrid(out.grid)
    setSpinKey((k) => k + 1)

    // One click per drum, at the moment it actually lands.
    plan.reels.forEach((r) => {
      window.setTimeout(() => safe(() => sfx.reelStop(r.reel)), r.stopMs)
    })

    window.setTimeout(() => {
      setSpinning(false)
      setOutcome(out)
      setLastWin(out.totalMultiplier)
      setHistory((h) => [out.totalMultiplier, ...h].slice(0, 12))

      const cells = new Set<string>()
      for (const w of out.wins) for (const c of w.cells) cells.add(`${c.reel}-${c.row}`)
      setWinCells(cells)

      if (out.fine > 0) {
        setGlow('omen')
        flashLoss()
        safe(() => sfx.omen())
        toast({
          kind: 'error',
          title: 'Faith appeared',
          body: `${out.omenCount} witch symbols — fined ${out.fine}× ($UGX {money(bet * out.fine)}).`,
        })
      } else if (out.triggered) {
        setGlow('free')
        setFreeSpins((n) => n + out.freeSpins)
        setFreeTotal((n) => n + out.freeSpins)
        safe(() => sfx.scatter())
        setParty({
          kind: 'freespins',
          title: 'Free spins',
          subtitle: `${out.scatters} ${config.scatter} landed — awarded free spins.`,
          spins: out.freeSpins,
        })
        if (sound) celebrationSound('freespins')
      } else if (out.totalMultiplier >= bet * 0.2) {
        setGlow('win')
      }

      if (out.totalMultiplier > 0 && out.fine === 0) {
        const won = Math.round(bet * out.totalMultiplier)
        if (out.totalMultiplier >= 8) {
          // Big win: escalate the celebration with the size of the win.
          setParty({
            kind: out.totalMultiplier >= 40 ? 'mega' : 'bigwin',
            title: out.totalMultiplier >= 40 ? 'Mega win' : 'Big win',
            subtitle: free ? 'Won on a free spin' : undefined,
            amount: won,
          })
          if (sound) celebrationSound(out.totalMultiplier >= 40 ? 'mega' : 'bigwin')
        } else if (sound) sfx.win()
      }

      if (free && out.fine === 0) freeWon.current += Math.round(bet * out.totalMultiplier)

      // settleBet credits wager * multiplier, i.e. the full return including
      // the stake. placeBet already debited it, so passing the full bet here is
      // correct and matches every other game's convention.
      // A full celebration card is already covering the win: suppress the
      // global flash so two confetti layers do not stack.
      const celebrating = out.triggered || (out.fine === 0 && out.totalMultiplier >= 8)
      // A real-money spin was already credited by the server; settling again
      // here would be the money printer. Only free play settles in the browser.
      if (serverMult === null) settleBet({
        game: id,
        wager: free ? 0 : bet,
        multiplier: out.totalMultiplier,
        detail,
        silent: celebrating,
      })
    }, plan.totalMs)
  }, [spinning, freeSpins, bet, balance, placeBet, id, config, nextFloats, settleBet, toast, flashLoss])

  // Round over: celebrate the total.
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

  useHotkey(() => { if (autoplay === 0) void spin() })

  // autoplay loop
  useEffect(() => {
    if (autoplay <= 0 || spinning || party) return
    const t = window.setTimeout(() => {
      void spin()
      setAutoplay((n) => Math.max(0, n - 1))
    }, 600)
    return () => window.clearTimeout(t)
  }, [autoplay, spinning, spin, party])

  const payRows = useMemo(() => config.symbols.filter((s) => s.pay), [config])

  return (
    <GameShell
      game={game}
      onBack={onBack}
      onFair={onFair}
      aside={
        <div className="space-y-3.5">
          <div className="space-y-1.5">
            <PayoutRow label="RTP" value={game.rtp} />
            <PayoutRow label="Volatility" value={config.volatility} />
            <PayoutRow label="Max win" value={game.maxWin} />
            {config.omen && <PayoutRow label="Faith fine" value={`${config.omen.fine}×`} />}
          </div>
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

      {/* header strip */}
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1">
        <div className="flex items-center gap-2">
          <span className="rounded-md bg-gradient-to-r from-neon-lime to-neon-green px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-ink-950">
            {config.reels} × {config.rows} · ways
          </span>
          {config.badLuck?.length ? (
            <span className="hidden items-center gap-1 text-[10px] text-rose-300/80 sm:flex">
              ⚠ {config.badLuck.join(' & ')} are bad luck
            </span>
          ) : null}
        </div>
        {lastWin > 0 && !spinning && (
          <span className="num text-[11px] font-bold text-neon-lime">last {lastWin}×</span>
        )}
      </div>

      <div className="relative -mx-3 w-auto sm:mx-auto sm:w-full sm:max-w-[760px]">
        <FreeSpinHud left={freeSpins} total={freeTotal} tick={freeTotal - freeSpins} />
        <SlotBoard3D
          config={config}
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
        lastWin={outcome?.totalMultiplier ?? 0}
        sub={`Space to spin · ${config.reels}×${config.rows} ways · HMAC-SHA256 verifiable`}
      />

      {/* outcome banner */}
      {outcome && !spinning && (
        <div
          className={`mx-auto mt-2 max-w-[760px] rounded-xl border px-3 py-2 text-center ${
            outcome.fine > 0
              ? 'border-rose-500/40 bg-rose-500/10 text-rose-300'
              : outcome.totalMultiplier > 0
                ? 'border-neon-lime/40 bg-neon-lime/10 text-neon-lime'
                : 'border-white/[0.07] bg-white/[0.02] text-slate-500'
          }`}
        >
          <p className="text-[11.5px] font-bold">
            {outcome.fine > 0
              ? `Faith fined you ${outcome.fine}× — $UGX {money(bet * outcome.fine)}`
              : outcome.totalMultiplier > 0
                ? `You won $UGX {money(bet * outcome.totalMultiplier)} · ${outcome.totalMultiplier}×`
                : 'No win this spin'}
          </p>
        </div>
      )}

      {/* feature strips */}
      <div className="mx-auto mt-3 grid max-w-[760px] grid-cols-2 gap-2">
        <div className="flex items-center gap-2.5 rounded-xl border border-white/[0.07] bg-gradient-to-r from-neon-lime/[0.10] to-transparent p-2.5">
          {/* The Wild is the face of the game — show the face. */}
          {(() => {
            const wild = config.symbols.find((s) => s.id === config.wild)
            return wild?.art ? (
              <img
                src={wild.art}
                alt=""
                width={30}
                height={30}
                className="h-[30px] w-[30px] shrink-0 rounded-md object-cover ring-1 ring-neon-lime/30"
              />
            ) : (
              <span className="text-[18px]">{wild?.glyph ?? '📦'}</span>
            )
          })()}
          <div className="min-w-0">
            <p className="truncate text-[11.5px] font-bold text-white">
              {config.symbols.find((s) => s.id === config.wild)?.name ?? 'Wild'}
            </p>
            <p className="truncate text-[10px] text-slate-500">Substitutes for every paying symbol</p>
          </div>
        </div>
        <div className="flex items-center gap-2.5 rounded-xl border border-white/[0.07] bg-gradient-to-r from-neon-cyan/[0.10] to-transparent p-2.5">
          <span className="text-[18px]">{config.symbols.find((s) => s.id === config.scatter)?.glyph ?? '⭐'}</span>
          <div className="min-w-0">
            <p className="truncate text-[11.5px] font-bold text-white">
              {config.symbols.find((s) => s.id === config.scatter)?.name ?? 'Scatter'}
            </p>
            <p className="truncate text-[10px] text-slate-500">
              {config.scatterTrigger}+ triggers {config.freeSpins} free spins
            </p>
          </div>
        </div>
        {config.omen && (
          <div className="col-span-2 flex items-center gap-2.5 rounded-xl border border-rose-500/25 bg-gradient-to-r from-rose-500/[0.12] to-transparent p-2.5">
            <span className="text-[18px]">🧙🏿‍♀️</span>
            <div className="min-w-0">
              <p className="truncate text-[11.5px] font-bold text-rose-300">
                {config.symbols.find((s) => s.id === config.omen!.symbol)?.name} — bad omen
              </p>
              <p className="truncate text-[10px] text-slate-500">
                {config.omen.trigger}+ anywhere fines you {config.omen.fine}× your bet
              </p>
            </div>
          </div>
        )}
      </div>

      {/* paytable */}
      <div className="mx-auto mt-3 max-w-[760px] rounded-xl border border-white/[0.07] bg-ink-850/80 p-3">
        <p className="mb-2 text-[10px] font-bold uppercase tracking-[.14em] text-slate-500">Paytable (× bet, per way)</p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
          {payRows.map((s) => (
            <div key={s.id} className="flex items-center justify-between gap-2 text-[10.5px]">
              <span className="flex min-w-0 items-center gap-1.5">
                {/* The portrait, not the emoji. This paytable is the one place a
                    player can see what each character looks like; showing a
                    glyph here meant the art was only ever visible mid-spin. */}
                {s.art ? (
                  <img
                    src={s.art}
                    alt=""
                    width={22}
                    height={22}
                    loading="lazy"
                    decoding="async"
                    className="h-[22px] w-[22px] shrink-0 rounded-[5px] object-cover ring-1 ring-white/10"
                  />
                ) : (
                  <span className="w-[22px] shrink-0 text-center text-[13px]">{s.glyph}</span>
                )}
                <span className="truncate text-slate-400">{s.name.replace(/ \(.*\)/, '')}</span>
              </span>
              <span className="num shrink-0 text-slate-300">
                {s.pay!.map((p) => (p >= 1 ? p.toFixed(1) : p.toFixed(2))).join(' / ')}
              </span>
            </div>
          ))}
        </div>
      </div>

      <p className="mt-2 text-center text-[9.5px] text-slate-600">
        Space to spin · Characters are fictional · 18+ · Play responsibly
      </p>
    </GameShell>
  )
}
