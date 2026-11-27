import React from 'react'
import { useStore } from '../lib/store'
import { money, mult } from '../lib/format'
import { sfx } from '../lib/sound'
import { IconBolt } from './Icons'

/**
 * One control row directly under the reels: running balance, last spin win,
 * the bet stepper, autoplay and the primary action. Sits inline on desktop and
 * pins to the bottom on mobile so nothing overlaps the reels.
 */
export type PlayBarProps = {
  bet: number
  onBet: (v: number) => void
  onSpin: () => void
  spinning?: boolean
  /** Free spins remaining. While > 0 the spin is free and the bet is locked. */
  freeSpins?: number
  /** Autoplay rounds remaining. 0 means idle. */
  autoLeft?: number
  onAuto?: (rounds: number) => void
  onStop?: () => void
  /** Multiplier from the last completed spin. */
  lastWin?: number
  /** Disable the whole bar (e.g. crash running). */
  disabled?: boolean
  /** Primary button label override. */
  label?: string
  /** Secondary line under the spin button. */
  sub?: string
}

const QUICK = [1000, 5000, 25000]

function Stat({
  label,
  value,
  accent,
  hint,
}: {
  label: string
  value: React.ReactNode
  accent?: string
  hint?: string
}) {
  return (
    <div className="min-w-0 flex-1 rounded-xl border border-white/[0.07] bg-ink-900/80 px-2.5 py-1.5">
      <p className="truncate text-[9px] font-bold uppercase tracking-[.14em] text-slate-500">{label}</p>
      <p className={`num truncate text-[13.5px] font-black leading-tight ${accent ?? 'text-white'}`}>{value}</p>
      {hint && <p className="truncate text-[9px] leading-tight text-slate-600">{hint}</p>}
    </div>
  )
}

export function PlayBar({
  bet,
  onBet,
  onSpin,
  spinning = false,
  freeSpins = 0,
  autoLeft = 0,
  onAuto,
  onStop,
  lastWin = 0,
  disabled = false,
  label,
  sub,
}: PlayBarProps) {
  const { balanceHidden, mode, playBalance } = useStore()
  const locked = disabled || spinning || freeSpins > 0

  const step = (d: number) => {
    sfx.click()
    onBet(Math.max(0, Math.round(bet + d)))
  }

  const winTone = lastWin >= 40 ? 'text-gold' : lastWin > 0 ? 'text-neon-lime' : 'text-slate-500'

  return (
    <div className="mx-auto mt-2 w-full max-w-[760px]">
      <div className="flex flex-col gap-1.5 rounded-2xl border border-white/[0.08] bg-ink-850/90 p-1.5 backdrop-blur-xl sm:flex-row sm:items-stretch">
        {/* readouts */}
        <div className="flex min-w-0 flex-1 gap-1.5">
          <Stat
            label={mode === 'free' ? 'Free credits' : 'Balance'}
            value={balanceHidden ? '••••••' : `UGX ${money(playBalance)}`}
            accent={mode === 'free' ? 'text-amber-200' : 'text-white'}
            hint={mode === 'free' ? 'not real money' : undefined}
          />
          <Stat
            label={spinning ? 'Spinning' : freeSpins > 0 ? 'Free spins' : 'Last win'}
            value={
              spinning
                ? '—'
                : freeSpins > 0
                  ? `${freeSpins} left`
                  : lastWin > 0
                    ? `${mult(lastWin)}`
                    : 'No win'
            }
            accent={spinning ? 'text-slate-500' : freeSpins > 0 ? 'text-neon-cyan' : winTone}
            hint={
              !spinning && freeSpins === 0 && lastWin > 0
                ? `UGX ${money(Math.floor(bet * lastWin))}`
                : undefined
            }
          />
        </div>

        {/* bet stepper */}
        <div className="flex min-w-0 items-stretch gap-1 rounded-xl border border-white/10 bg-ink-900/80 px-1">
          <button
            type="button"
            onClick={() => step(-Math.max(1, Math.round(bet / 2)))}
            disabled={locked}
            aria-label="Halve bet"
            className="grid w-7 place-items-center rounded-lg text-slate-300 transition hover:bg-white/10 disabled:opacity-30"
          >
            ½
          </button>
          <div className="flex min-w-0 flex-col items-center justify-center px-1">
            <span className="text-[8.5px] font-bold uppercase tracking-[.14em] text-slate-500">Bet</span>
            <div className="flex items-baseline gap-1">
              <input
                inputMode="decimal"
                value={bet === 0 ? '' : String(bet)}
                onChange={(e) => onBet(Math.max(0, parseFloat(e.target.value.replace(/[^0-9.]/g, '')) || 0))}
                disabled={locked}
                aria-label="Bet amount"
                className="num w-[68px] bg-transparent text-center text-[14px] font-black text-white focus:outline-none disabled:opacity-60"
              />
              <span className="text-[9px] font-bold text-neon-lime/70">UGX</span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => step(Math.max(1, Math.round(bet / 2) || 1000))}
            disabled={locked}
            aria-label="Double bet"
            className="grid w-7 place-items-center rounded-lg text-slate-300 transition hover:bg-white/10 disabled:opacity-30"
          >
            2×
          </button>
        </div>

        {/* autoplay */}
        {onAuto && (
          <div className="flex items-center gap-1">
            {autoLeft > 0 ? (
              <button
                type="button"
                onClick={onStop}
                className="h-10 shrink-0 rounded-xl border border-rose-400/30 bg-rose-500/15 px-2.5 text-[11px] font-bold text-rose-300 transition hover:bg-rose-500/25"
              >
                Stop {autoLeft}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onAuto(10)}
                disabled={locked}
                className="grid h-10 shrink-0 place-items-center gap-0.5 rounded-xl border border-white/10 bg-white/[0.04] px-2.5 text-[11px] font-bold text-slate-300 transition hover:bg-white/10 disabled:opacity-40"
                aria-label="Autoplay 10 rounds"
              >
                <IconBolt size={13} />
                Auto
              </button>
            )}
          </div>
        )}

        {/* primary action */}
        <button
          type="button"
          onClick={onSpin}
          disabled={locked}
          className="btn-primary h-10 shrink-0 !px-5 !text-[13px] sm:min-w-[132px]"
        >
          {spinning ? 'Spinning…' : freeSpins > 0 ? `${freeSpins} free` : (label ?? 'Spin')}
        </button>
      </div>

      {/* quick stakes + sub line */}
      <div className="mt-1 flex items-center justify-between gap-2 px-1">
        <div className="flex gap-1">
          {QUICK.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => {
                sfx.click()
                onBet(q)
              }}
              disabled={locked}
              className="num rounded-md border border-white/[0.07] bg-white/[0.03] px-1.5 py-0.5 text-[10px] font-bold text-slate-400 transition hover:border-neon-lime/30 hover:text-neon-lime disabled:opacity-30"
            >
              {money(q)}
            </button>
          ))}
        </div>
        <p className="truncate text-[9.5px] text-slate-600">{sub ?? 'Space to spin · every outcome is verifiable'}</p>
      </div>
    </div>
  )
}
