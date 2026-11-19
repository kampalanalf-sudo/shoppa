import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../lib/auth'
import { sfx } from '../lib/sound'
import { coin, money } from '../lib/format'
import {
  SPORT_LABEL, fmtOdds, loadBoard, loadSlips, placeBet, potentialPayout, startsIn, stakeUgx,
  type Fixture, type Market, type Selection, type Slip, type Sport,
} from '../lib/sportsbook'
import {
  IconBall, IconCheck, IconChevron, IconChevronLeft, IconClock, IconHistory, IconShield, IconTrophy,
} from '../components/Icons'

/**
 * The sportsbook.
 *
 * Layout is deliberately a list of matches with their prices inline, not a
 * bet-slip flow: a slip that accumulates across fixtures needs a second screen,
 * a running total and a clear-all, and this audience is used to reading one
 * card and tapping one price.
 *
 * Money rules that are not stylistic:
 *  - the stake box is whole PX only, and it cannot exceed the wallet balance
 *    (the server checks again under a row lock; this is just the honest UI)
 *  - the price shown and the price paid are the same `odds_x100` the server
 *    snapshotted; the client never sends a multiplier
 *  - a slip is settled by the result job, never here, so a lost bet cannot be
 *    hidden and a won bet cannot be invented
 */
export function Sportsbook({ onBack }: { onBack: () => void }) {
  const { user, wallet, refreshWallet, configured } = useAuth()

  const [fixtures, setFixtures] = useState<Fixture[]>([])
  const [markets, setMarkets] = useState<Market[]>([])
  const [slips, setSlips] = useState<Slip[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sport, setSport] = useState<Sport | 'all'>('all')
  const [tab, setTab] = useState<'board' | 'slips'>('board')

  const [picked, setPicked] = useState<{ selection: Selection; market: Market; fixture: Fixture } | null>(null)
  const [stake, setStake] = useState('')
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)

  const balance = wallet?.balance_px ?? 0

  const refresh = useCallback(async () => {
    setError(null)
    try {
      const board = await loadBoard()
      setFixtures(board.fixtures)
      setMarkets(board.markets)
      if (user) setSlips(await loadSlips(user.id))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => { void refresh() }, [refresh])

  const sports = useMemo(
    () => Array.from(new Set(fixtures.map((f) => f.sport))) as Sport[],
    [fixtures],
  )

  const shown = useMemo(
    () => (sport === 'all' ? fixtures : fixtures.filter((f) => f.sport === sport)),
    [fixtures, sport],
  )

  const marketsFor = useCallback(
    (fixtureId: string) => markets.filter((m) => m.fixture_id === fixtureId),
    [markets],
  )

  const stakeNum = Number(stake.replace(/[^0-9]/g, '')) || 0
  const potential = picked ? potentialPayout(stakeNum, picked.selection.odds_x100) : 0
  const overBalance = stakeNum > balance
  const canPlace = Boolean(picked) && stakeNum > 0 && !overBalance && !busy

  const confirm = async () => {
    if (!picked || !canPlace) return
    setBusy(true)
    setError(null)
    try {
      await placeBet(picked.selection.id, stakeNum)
      sfx.win()
      setFlash(`Bet placed — ${coin(stakeNum)} at ${fmtOdds(picked.selection.odds_x100)}`)
      setPicked(null)
      setStake('')
      await refreshWallet()
      await refresh()
      setTab('slips')
    } catch (e) {
      // The server's message is the truthful one: 'insufficient balance',
      // 'betting has closed for this event', 'market is closed'.
      setError((e as Error).message)
      sfx.click()
    } finally {
      setBusy(false)
    }
  }

  const open = slips.filter((s) => s.status === 'open')
  const settled = slips.filter((s) => s.status !== 'open')

  return (
    <div className="mx-auto w-full max-w-[1100px] px-3 pb-24 pt-4 sm:px-5">
      <button type="button" onClick={onBack} className="mb-3 flex items-center gap-1 text-[12px] font-semibold text-slate-400 transition hover:text-white">
        <IconChevronLeft size={15} /> Back
      </button>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="grid h-11 w-11 place-items-center rounded-xl bg-neon-lime/10 text-neon-lime">
          <IconBall size={22} />
        </div>
        <div className="min-w-0">
          <h1 className="text-[20px] font-black leading-tight text-white">Sports</h1>
          <p className="text-[11.5px] text-slate-500">Pre-match · Uganda and abroad · PX stakes</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="chip !border-white/[0.07] normal-case tracking-normal">
            <span className="grid h-4 w-4 place-items-center rounded-full bg-gradient-to-br from-neon-lime to-neon-green text-[7px] font-black text-ink-950">PX</span>
            <span className="num font-bold text-white">{money(balance)}</span>
          </span>
        </div>
      </div>

      <div className="mb-3 flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => setTab('board')}
          className={`rounded-full px-3.5 py-1.5 text-[12px] font-bold transition ${tab === 'board' ? 'bg-neon-lime text-ink-950' : 'bg-white/[0.04] text-slate-300 hover:bg-white/[0.08]'}`}
        >
          Matches
        </button>
        <button
          type="button"
          onClick={() => setTab('slips')}
          className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12px] font-bold transition ${tab === 'slips' ? 'bg-neon-lime text-ink-950' : 'bg-white/[0.04] text-slate-300 hover:bg-white/[0.08]'}`}
        >
          <IconHistory size={13} /> My bets
          {open.length > 0 && (
            <span className="rounded-full bg-ink-950/20 px-1.5 text-[10px] font-black">{open.length}</span>
          )}
        </button>
      </div>

      {flash && (
        <div className="mb-3 flex items-start gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5 text-[12px] text-emerald-200">
          <IconCheck size={15} className="mt-0.5 shrink-0" />
          <span>{flash}</span>
        </div>
      )}

      {error && (
        <div className="mb-3 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2.5 text-[12px] text-rose-200">
          {error}
        </div>
      )}

      {!configured && (
        <div className="mb-3 rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2.5 text-[12px] text-amber-200">
          The backend is not reachable, so there are no fixtures to show.
        </div>
      )}

      {tab === 'board' && (
        <>
          {sports.length > 0 && (
            <div className="mb-3 flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
              <SportPill active={sport === 'all'} onClick={() => setSport('all')}>All</SportPill>
              {sports.map((s) => (
                <SportPill key={s} active={sport === s} onClick={() => setSport(s)}>
                  {SPORT_LABEL[s]}
                </SportPill>
              ))}
            </div>
          )}

          {loading && <p className="py-10 text-center text-[12px] text-slate-500">Loading fixtures…</p>}

          {!loading && !shown.length && (
            <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] px-4 py-10 text-center">
              <IconBall size={26} className="mx-auto mb-2 text-slate-600" />
              <p className="text-[13px] font-bold text-slate-300">No matches on the board yet</p>
              <p className="mx-auto mt-1 max-w-[380px] text-[11.5px] leading-relaxed text-slate-500">
                Fixtures appear here once they are published. Every price is snapshotted when you
                bet, and every slip is settled against the official result.
              </p>
            </div>
          )}

          <div className="grid gap-2.5">
            {shown.map((f) => (
              <FixtureCard
                key={f.id}
                fixture={f}
                markets={marketsFor(f.id)}
                onPick={(selection, market) => {
                  sfx.click()
                  setPicked({ selection, market, fixture: f })
                  setFlash(null)
                }}
              />
            ))}
          </div>
        </>
      )}

      {tab === 'slips' && (
        <div className="grid gap-2.5">
          {!slips.length && (
            <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] px-4 py-10 text-center">
              <IconTrophy size={26} className="mx-auto mb-2 text-slate-600" />
              <p className="text-[13px] font-bold text-slate-300">No bets yet</p>
              <p className="mt-1 text-[11.5px] text-slate-500">Pick a price on the Matches tab to place one.</p>
            </div>
          )}
          {[...open, ...settled].map((s) => <SlipCard key={s.id} slip={s} fixtures={fixtures} />)}
        </div>
      )}

      {/* ------------------------------------------------------- bet sheet --*/}
      {picked && (
        <div className="fixed inset-0 z-[80] grid place-items-end sm:place-items-center" role="dialog" aria-modal="true" aria-label="Place bet">
          <div className="absolute inset-0 bg-black/75 backdrop-blur-sm" onClick={() => !busy && setPicked(null)} />
          <div className="relative w-full max-w-md animate-popIn rounded-t-2xl border border-white/[0.09] bg-ink-850 p-4 shadow-pop sm:rounded-2xl">
            <div className="mb-3 flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-bold uppercase tracking-[.16em] text-slate-500">{picked.market.name}</p>
                <p className="mt-0.5 truncate text-[15px] font-black text-white">{picked.selection.name}</p>
                <p className="truncate text-[11.5px] text-slate-500">
                  {picked.fixture.home_team} v {picked.fixture.away_team} · {picked.fixture.league}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[10px] font-bold uppercase tracking-[.16em] text-slate-500">Odds</p>
                <p className="num text-[19px] font-black text-neon-lime">{fmtOdds(picked.selection.odds_x100)}</p>
              </div>
            </div>

            <label className="label" htmlFor="stake">Stake (PX)</label>
            <input
              id="stake"
              inputMode="numeric"
              className="field num !py-3 !text-[16px]"
              placeholder="0"
              value={stake}
              onChange={(e) => setStake(e.target.value.replace(/[^0-9]/g, '').slice(0, 9))}
            />
            <div className="mt-1.5 flex items-center gap-1.5">
              {[1000, 5000, 10000, 50000].map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setStake(String(v))}
                  className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[10.5px] font-bold text-slate-300 transition hover:border-neon-lime/40 hover:text-white"
                >
                  {money(v)}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setStake(String(Math.max(0, Math.floor(balance))))}
                className="ml-auto rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[10.5px] font-bold text-slate-300 transition hover:border-neon-lime/40 hover:text-white"
              >
                Max
              </button>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2 rounded-xl border border-white/[0.07] bg-white/[0.02] p-2.5">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[.14em] text-slate-500">Potential return</p>
                <p className="num text-[15px] font-black text-white">{money(potential)} PX</p>
                <p className="text-[10.5px] text-slate-500">≈ UGX {money(stakeUgx(potential))}</p>
              </div>
              <div className="text-right">
                <p className="text-[10px] font-bold uppercase tracking-[.14em] text-slate-500">Balance after</p>
                <p className="num text-[15px] font-black text-slate-300">{money(Math.max(0, balance - stakeNum))} PX</p>
                <p className="text-[10.5px] text-slate-500">10 PX = 1 UGX</p>
              </div>
            </div>

            {overBalance && (
              <p className="mt-2 text-[11px] font-semibold text-rose-300">
                That is more than your balance of {coin(balance)}.
              </p>
            )}

            <div className="mt-3 flex gap-2">
              <button type="button" onClick={() => setPicked(null)} disabled={busy} className="btn-ghost flex-1 !py-3 !text-[13px]">
                Cancel
              </button>
              <button type="button" onClick={() => void confirm()} disabled={!canPlace} className="btn-primary flex-[1.6] !py-3 !text-[13px]">
                {busy ? 'Placing…' : `Bet ${stakeNum ? money(stakeNum) : ''} PX`}
              </button>
            </div>

            <p className="mt-2 flex items-center justify-center gap-1.5 text-center text-[10px] text-slate-600">
              <IconShield size={11} /> Price is locked server-side · settled on the official result
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

function SportPill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 rounded-full px-3 py-1.5 text-[11.5px] font-bold transition ${
        active ? 'bg-white text-ink-950' : 'bg-white/[0.04] text-slate-300 hover:bg-white/[0.08]'
      }`}
    >
      {children}
    </button>
  )
}

function FixtureCard({
  fixture, markets, onPick,
}: {
  fixture: Fixture
  markets: Market[]
  onPick: (s: Selection, m: Market) => void
}) {
  const [openAll, setOpenAll] = useState(false)
  const primary = markets[0]
  const rest = markets.slice(1)
  const countdown = startsIn(fixture.starts_at)

  return (
    <div className="overflow-hidden rounded-2xl border border-white/[0.07] bg-white/[0.02]">
      <div className="flex items-center gap-2 border-b border-white/[0.05] px-3 py-2">
        <span className="rounded-md bg-neon-lime/10 px-1.5 py-0.5 text-[9.5px] font-black uppercase tracking-wider text-neon-lime">
          {SPORT_LABEL[fixture.sport]}
        </span>
        <span className="truncate text-[11px] font-semibold text-slate-400">{fixture.league}</span>
        <span className="ml-auto flex shrink-0 items-center gap-1 text-[10.5px] font-semibold text-slate-500">
          {fixture.status === 'live' ? (
            <span className="flex items-center gap-1 text-rose-300">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-rose-400" /> LIVE
            </span>
          ) : (
            <>
              <IconClock size={11} />
              {countdown || 'starting'}
            </>
          )}
        </span>
      </div>

      <div className="px-3 py-2.5">
        <div className="mb-2 flex items-baseline gap-2">
          <p className="min-w-0 flex-1 truncate text-[13.5px] font-bold text-white">
            {fixture.home_team} <span className="text-slate-500">v</span> {fixture.away_team}
          </p>
          {fixture.venue && <p className="hidden shrink-0 text-[10.5px] text-slate-600 sm:block">{fixture.venue}</p>}
        </div>

        {!primary && <p className="text-[11.5px] text-slate-500">Prices not published yet.</p>}

        {primary && (
          <div className="grid grid-cols-3 gap-1.5">
            {primary.sports_selections.map((s) => (
              <button
                key={s.id}
                type="button"
                disabled={!s.is_active || !primary.is_open}
                onClick={() => onPick(s, primary)}
                className="group rounded-lg border border-white/[0.08] bg-white/[0.03] px-2 py-1.5 text-center transition hover:border-neon-lime/50 hover:bg-neon-lime/10 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <span className="block truncate text-[11px] font-semibold text-slate-300 group-hover:text-white">{s.name}</span>
                <span className="num block text-[13px] font-black text-neon-lime">{fmtOdds(s.odds_x100)}</span>
              </button>
            ))}
          </div>
        )}

        {rest.length > 0 && (
          <button
            type="button"
            onClick={() => setOpenAll((v) => !v)}
            className="mt-2 flex items-center gap-1 text-[11px] font-bold text-slate-400 transition hover:text-white"
          >
            <IconChevron size={12} className={openAll ? 'rotate-90' : ''} />
            {openAll ? 'Hide' : `${rest.length} more market${rest.length > 1 ? 's' : ''}`}
          </button>
        )}

        {openAll && rest.map((m) => (
          <div key={m.id} className="mt-2.5">
            <p className="mb-1 text-[10px] font-bold uppercase tracking-[.14em] text-slate-500">{m.name}</p>
            <div className="grid gap-1.5 sm:grid-cols-3">
              {m.sports_selections.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  disabled={!s.is_active || !m.is_open}
                  onClick={() => onPick(s, m)}
                  className="flex items-center justify-between rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 py-1.5 transition hover:border-neon-lime/50 hover:bg-neon-lime/10 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <span className="truncate text-[11px] font-semibold text-slate-300">{s.name}</span>
                  <span className="num ml-2 shrink-0 text-[12.5px] font-black text-neon-lime">{fmtOdds(s.odds_x100)}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

const STATUS_STYLE: Record<Slip['status'], { label: string; cls: string }> = {
  open: { label: 'Open', cls: 'text-amber-300 border-amber-400/30 bg-amber-400/10' },
  won: { label: 'Won', cls: 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10' },
  lost: { label: 'Lost', cls: 'text-slate-400 border-white/10 bg-white/[0.03]' },
  void: { label: 'Void · refunded', cls: 'text-slate-400 border-white/10 bg-white/[0.03]' },
  cashed_out: { label: 'Cashed out', cls: 'text-sky-300 border-sky-400/30 bg-sky-400/10' },
}

function SlipCard({ slip, fixtures }: { slip: Slip; fixtures: Fixture[] }) {
  const f = fixtures.find((x) => x.id === slip.fixture_id)
  const s = STATUS_STYLE[slip.status]
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (slip.status !== 'open') return
    const t = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(t)
  }, [slip.status])
  // `now` is only a re-render trigger for the countdown, so it must be read.
  void now

  return (
    <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] px-3 py-2.5">
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 truncate text-[12.5px] font-bold text-white">
          {f ? `${f.home_team} v ${f.away_team}` : 'Match'}
        </p>
        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-wider ${s.cls}`}>
          {s.label}
        </span>
      </div>
      <div className="mt-1.5 flex items-end justify-between gap-2">
        <div className="min-w-0">
          <p className="num text-[11px] text-slate-500">
            {coin(slip.stake_px)} @ {fmtOdds(slip.odds_x100)}
          </p>
          {slip.status === 'won' && (
            <p className="num text-[12px] font-black text-emerald-300">+{coin(slip.payout_px)}</p>
          )}
          {slip.status === 'open' && (
            <p className="num text-[11px] text-slate-500">returns {coin(slip.potential_px)}</p>
          )}
          {slip.status === 'void' && (
            <p className="num text-[11px] text-slate-500">stake returned</p>
          )}
        </div>
        {f?.status === 'live' && (
          <span className="flex items-center gap-1 text-[10px] font-bold text-rose-300">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-rose-400" /> LIVE
          </span>
        )}
      </div>
    </div>
  )
}
