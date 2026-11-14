import React from 'react'
import type { GameMeta } from '../lib/types'
import { useStore } from '../lib/store'
import { money, mult } from '../lib/format'
import { BetFeed } from './Chrome'
import { IconChevronLeft, IconInfo, IconShield, IconTrophy } from './Icons'

type Props = {
  game: GameMeta
  onBack: () => void
  children: React.ReactNode
  aside: React.ReactNode
  /** sticky footer info like multiplier/potential payout */
  footer?: React.ReactNode
  onFair: () => void
  /** Compact controls pinned above the mobile bottom nav. */
  mobileAction?: React.ReactNode
}

export function GameShell({ game, onBack, children, aside, footer, onFair, mobileAction }: Props) {
  const { stats, setHistoryOpen } = useStore()
  return (
    <div className="mx-auto w-full max-w-[1380px] px-3 pb-24 pt-4 sm:px-5 md:pb-10">
      {/* header row */}
      <div className="mb-3 flex flex-wrap items-center gap-2.5">
        <button type="button" onClick={onBack} className="grid h-9 w-9 place-items-center rounded-xl border border-white/[0.07] bg-white/[0.03] text-slate-300 transition hover:bg-white/10 hover:text-white">
          <IconChevronLeft size={17} />
        </button>
        <div className="flex items-center gap-2.5">
          <img src={game.art} alt="" className="h-9 w-9 rounded-lg object-cover ring-1 ring-white/10" />
          <div>
            <h1 className="text-[15px] font-bold leading-tight text-white sm:text-[17px]">{game.name}</h1>
            <p className="text-[10.5px] text-slate-500">{game.tagline}</p>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <span className="chip hidden sm:inline-flex"><IconShield size={11} className="text-emerald-400" /> RTP {game.rtp}</span>
          <span className="chip hidden md:inline-flex"><IconTrophy size={11} className="text-gold" /> Max {game.maxWin}</span>
          <button type="button" onClick={onFair} className="chip transition hover:border-neon-lime/40 hover:text-neon-lime">
            <IconInfo size={11} /> Fairness
          </button>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-[1fr_340px]">
        {/* main play area */}
        <div className="min-w-0 space-y-3">
          <div
            className="relative overflow-hidden rounded-2xl border border-white/[0.07] bg-ink-900/70 shadow-card"
            style={{ backgroundImage: `radial-gradient(700px 260px at 50% -10%, ${game.accentSoft}, transparent 70%)` }}
          >
            <div className="pointer-events-none absolute inset-0 grid-bg opacity-[0.5]" />
            <div className="relative p-3 sm:p-4">{children}</div>
          </div>
        </div>

        {/* right rail: bet controls */}
        <div className="space-y-3">
          <div className="panel p-3.5">{aside}</div>
          {footer}
          <div className="panel hidden p-3.5 md:block">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-[12px] font-bold uppercase tracking-[.14em] text-slate-400">Your bets</h3>
              <button type="button" onClick={() => setHistoryOpen(true)} className="text-[10.5px] font-semibold text-neon-lime hover:underline">
                View all
              </button>
            </div>
            <BetFeed limit={5} />
          </div>
        </div>
      </div>

      {mobileAction && (
        <div className="fixed bottom-[57px] left-0 right-0 z-30 border-t border-white/[0.08] glass px-3 py-2 md:hidden">
          {mobileAction}
        </div>
      )}

      <div className="mt-3 grid grid-cols-3 gap-2 md:hidden">
        {[
          { l: 'Wagered', v: money(stats.wagered, 0) },
          { l: 'Profit', v: `${stats.profit >= 0 ? '+' : ''}${money(stats.profit, 0)}` },
          { l: 'Biggest', v: money(stats.biggestWin, 0) },
        ].map((s) => (
          <div key={s.l} className="panel-tight px-2 py-1.5 text-center">
            <p className="text-[9px] uppercase tracking-wider text-slate-500">{s.l}</p>
            <p className="num text-[11.5px] font-bold text-slate-200">{s.v}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

/** Shared "potential payout" summary block. */
export function PayoutRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-white/[0.03] px-2.5 py-1.5">
      <span className="text-[11px] text-slate-500">{label}</span>
      <span className={`num text-[12px] font-bold ${highlight ? 'text-neon-lime' : 'text-slate-200'}`}>{value}</span>
    </div>
  )
}

export function MultiplierBadge({ value }: { value: number }) {
  return (
    <span className="num inline-flex items-center gap-1 rounded-md bg-neon-lime/15 px-1.5 py-0.5 text-[11px] font-bold text-neon-lime">
      {mult(value)}
    </span>
  )
}

export const ChartFrameHint = () => (
  <p className="mt-2 text-center text-[10px] text-slate-600">Press Space to play · Enter to cash out</p>
)
