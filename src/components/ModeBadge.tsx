import React from 'react'
import { useStore } from '../lib/store'
import { FREE_PLAY_REFILL } from '../lib/currency'
import { money } from '../lib/format'
import { IconBolt } from './Icons'

/**
 * The free-play marker.
 *
 * Requirement: free play must be *clearly* marked. That means more than a label
 * on one screen — a player who looks at a balance at any moment has to be able
 * to tell, without having read anything else, whether the number is money.
 *
 * So this badge is:
 *   - rendered next to every balance while free play is on
 *   - worded plainly ("Free play — not real money"), not with an icon alone
 *   - a different colour from every real-money surface
 *
 * `variant="bar"` is the full-width strip for the top of the page; `variant`
 * "inline" is the compact chip for a header or a control row.
 */
export function FreePlayBadge({ variant = 'inline' }: { variant?: 'inline' | 'bar' }) {
  if (variant === 'bar') {
    return (
      <div
        role="status"
        className="flex items-center justify-center gap-2 bg-gradient-to-r from-amber-400/20 via-amber-300/15 to-amber-400/20 px-3 py-1.5 text-[11.5px] font-bold text-amber-200 ring-1 ring-inset ring-amber-400/30"
      >
        <span className="grid h-4 w-4 place-items-center rounded-full bg-amber-400 text-[9px] font-black text-ink-950">F</span>
        Free play — practice credits, not real money. Nothing here can be withdrawn.
      </div>
    )
  }
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border border-amber-400/40 bg-amber-400/15 px-2 py-[3px] text-[9.5px] font-black uppercase tracking-[.1em] text-amber-200"
      title="Practice credits. Not real money, and cannot be withdrawn."
    >
      Free play
    </span>
  )
}

/**
 * The balance, labelled honestly for the mode.
 *
 * Every place that shows a number a player might read as money uses this, so
 * there is exactly one component that decides whether the number is real. It
 * reads `playBalance`/`mode` from the store rather than taking a balance prop,
 * because passing the real balance in from a caller is how the wrong number ends
 * up under a "free play" label.
 */
export function Balance({ hidden = false, showCurrency = true }: { hidden?: boolean; showCurrency?: boolean }) {
  const { mode, playBalance } = useStore()
  const free = mode === 'free'

  return (
    <span className="inline-flex items-center gap-1.5">
      {free && <FreePlayBadge />}
      <span className={`num ${free ? 'text-amber-200' : 'text-white'}`}>
        {hidden ? '••••••' : showCurrency ? `UGX ${money(playBalance)}` : money(playBalance)}
      </span>
    </span>
  )
}

/**
 * The mode switch.
 *
 * Both options are always visible so a player can see which one is active. The
 * free option states the consequence ("practice only") in the control itself,
 * because that is the moment the choice is made.
 */
export function ModeSwitch({ compact = false }: { compact?: boolean }) {
  const { mode, setMode, free } = useStore()
  const freeLow = free.credits < 500

  return (
    <div className="flex flex-col gap-1">
      <div
        role="tablist"
        aria-label="Play mode"
        className="flex overflow-hidden rounded-lg border border-white/10 bg-ink-900/80 p-[2px]"
      >
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'real'}
          onClick={() => setMode('real')}
          className={`flex-1 rounded-md px-2 py-1 text-[10.5px] font-bold transition ${
            mode === 'real' ? 'bg-neon-lime text-ink-950' : 'text-slate-400 hover:text-white'
          }`}
        >
          Real money
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'free'}
          onClick={() => setMode('free')}
          className={`flex-1 rounded-md px-2 py-1 text-[10.5px] font-bold transition ${
            mode === 'free' ? 'bg-amber-400 text-ink-950' : 'text-slate-400 hover:text-white'
          }`}
        >
          Free play
        </button>
      </div>
      {!compact && mode === 'free' && (
        <p className="text-[9.5px] leading-snug text-amber-200/70">
          Practice credits only. Winnings are not real and cannot be withdrawn.
        </p>
      )}
      {!compact && freeLow && (
        <RefillButton />
      )}
    </div>
  )
}

/** Refill practice credits. Deliberately not reachable in real-money mode. */
export function RefillButton() {
  const { mode, refillFreePlay } = useStore()
  if (mode !== 'free') return null
  return (
    <button
      type="button"
      onClick={refillFreePlay}
      className="flex w-full items-center justify-center gap-1 rounded-lg border border-amber-400/40 bg-amber-400/10 py-1.5 text-[10.5px] font-bold text-amber-200 transition hover:bg-amber-400/20"
    >
      <IconBolt size={12} /> Refill to {money(FREE_PLAY_REFILL)} free credits
    </button>
  )
}
