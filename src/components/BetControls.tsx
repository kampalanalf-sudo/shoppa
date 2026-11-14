import React, { useEffect, useRef } from 'react'
import { money } from '../lib/format'
import { useStore } from '../lib/store'
import { sfx } from '../lib/sound'
import { IconBolt } from './Icons'

const CHIPS = [1, 5, 25, 100, 500]

type Props = {
  value: number
  onChange: (v: number) => void
  disabled?: boolean
  allowHalf?: boolean
  allowDouble?: boolean
  label?: string
  max?: number
}

export function BetAmount({ value, onChange, disabled, allowHalf = true, allowDouble = true, label = 'Bet amount' }: Props) {
  const { balance, balanceHidden } = useStore()
  const maxBudget = 100000

  const step = (delta: number) => {
    sfx.click()
    onChange(Math.max(0, Math.min(maxBudget, Math.round((value + delta) * 100) / 100)))
  }

  const set = (v: string) => {
    const n = parseFloat(v.replace(/[^0-9.]/g, ''))
    onChange(Number.isFinite(n) ? Math.min(maxBudget, n) : 0)
  }

  return (
    <div>
      <div className="label">
        <span>{label}</span>
        <span className="normal-case tracking-normal text-slate-500">
          Balance <span className="num text-slate-300">{balanceHidden ? '••••' : money(balance)}</span>
        </span>
      </div>
      <div className="flex items-stretch gap-1.5 rounded-xl border border-white/10 bg-ink-900/80 p-1.5 transition focus-within:border-neon-lime/50">
        <button
          type="button"
          aria-label={allowHalf ? 'Halve bet' : 'Decrease bet'}
          onClick={() => step(allowHalf ? -value / 2 : -1)}
          disabled={disabled}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white/[0.05] text-slate-300 transition hover:bg-white/10 disabled:opacity-40"
        >
          {allowHalf ? '½' : '−'}
        </button>
        <div className="relative flex-1">
          <input
            inputMode="decimal"
            value={value === 0 ? '' : String(value)}
            onChange={(e) => set(e.target.value)}
            disabled={disabled}
            placeholder="0.00"
            aria-label={label}
            className="num w-full bg-transparent px-1 text-center text-lg font-bold text-white placeholder:text-slate-600 focus:outline-none"
          />
          <span className="pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 text-[11px] font-bold text-neon-lime/70">FB</span>
        </div>
        <button
          type="button"
          aria-label={allowDouble ? 'Double bet' : 'Increase bet'}
          onClick={() => step(allowDouble ? value || 1 : 1)}
          disabled={disabled}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white/[0.05] text-slate-300 transition hover:bg-white/10 disabled:opacity-40"
        >
          {allowDouble ? '2×' : '+'}
        </button>
      </div>
      <div className="mt-2 grid grid-cols-5 gap-1.5">
        {CHIPS.map((c) => (
          <button
            key={c}
            type="button"
            disabled={disabled}
            onClick={() => {
              sfx.click()
              onChange(c)
            }}
            className={`num rounded-lg border py-1.5 text-[11px] font-bold transition disabled:opacity-40 ${
              value === c
                ? 'border-neon-lime/60 bg-neon-lime/15 text-neon-lime'
                : 'border-white/[0.07] bg-white/[0.035] text-slate-300 hover:border-white/20 hover:text-white'
            }`}
          >
            {c}
          </button>
        ))}
      </div>
    </div>
  )
}

type ActionProps = {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  variant?: 'primary' | 'ghost' | 'danger' | 'dark'
  sub?: string
  loading?: boolean
  className?: string
}

export function BetButton({ children, onClick, disabled, variant = 'primary', sub, loading, className = '' }: ActionProps) {
  const cls =
    variant === 'primary' ? 'btn-primary' : variant === 'danger' ? 'btn-danger' : variant === 'dark' ? 'btn-dark' : 'btn-ghost'
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`${cls} h-[54px] w-full flex-col gap-0 text-[15px] ${className}`}
    >
      <span className="flex items-center gap-2">
        {loading ? (
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
        ) : null}
        {children}
      </span>
      {sub ? <span className="num text-[10.5px] font-semibold opacity-70">{sub}</span> : null}
    </button>
  )
}

export function QuickBetToggle({ auto }: { auto: boolean }) {
  return (
    <span
      className={`chip transition ${auto ? 'border-neon-lime/50 !text-neon-lime' : ''}`}
      title="Space or Enter to play"
    >
      <IconBolt size={12} /> {auto ? 'Auto' : 'Manual'}
    </span>
  )
}

/** Calls handler on Space / Enter, ignoring typing in inputs. */
export function useHotkey(handler: () => void, enabled = true) {
  const ref = useRef(handler)
  ref.current = handler
  useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault()
        ref.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enabled])
}

export const ZERO_BET_GUARD = (v: number) => !(v > 0)
