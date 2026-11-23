import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../lib/auth'
import { fetchStatus, type StatusResponse } from '../lib/payments'
import { supabase } from '../lib/supabase'
import { money } from '../lib/format'
import { SUPABASE_ANON_KEY, apiUrl } from '../lib/backend'
import { sfx } from '../lib/sound'
import { IconCheck, IconChevronLeft, IconShield } from '../components/Icons'

type Props = {
  /** Reference from the URL, if DGateway/our flow supplied one. */
  reference?: string | null
  onHome: () => void
  onTopUpAgain: () => void
}

/**
 * Landing page after a mobile-money deposit.
 *
 * Deliberately read-only: it confirms what the webhook already did and never
 * credits anything itself. A URL a player can visit must never move money.
 * If the provider has not settled yet it polls, using the same 10s floor as the
 * rest of the flow.
 */
export function TopUpSuccess({ reference, onHome, onTopUpAgain }: Props) {
  const { wallet, refreshWallet } = useAuth()

  const [state, setState] = useState<'checking' | 'paid' | 'pending' | 'failed'>('checking')
  const [detail, setDetail] = useState<StatusResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [waited, setWaited] = useState(0)
  const [claim, setClaim] = useState('')
  const [claiming, setClaiming] = useState(false)
  const [claimMsg, setClaimMsg] = useState<string | null>(null)

  const balance = wallet?.balance_px ?? 0

  const check = useCallback(
    async (fresh = false) => {
      if (!reference) return
      try {
        const res = await fetchStatus(reference, fresh)
        setDetail(res)
        if (res.status === 'completed') {
          setState('paid')
          sfx.bigwin()
          void refreshWallet()
        } else if (res.status === 'failed') {
          setState('failed')
        } else {
          setState('pending')
        }
      } catch (e) {
        setError((e as Error).message)
        // Keep showing "pending" rather than a hard error: the webhook may
        // still land, and a transient proxy failure is not a failed payment.
        setState((s) => (s === 'checking' ? 'pending' : s))
      }
    },
    [reference, refreshWallet],
  )

  // First look on mount, then poll every 10s for up to 5 minutes.
  useEffect(() => {
    if (!reference) {
      // No reference in the URL: the deposit may still have completed; just
      // show the current balance rather than pretending we know its status.
      setState('paid')
      void refreshWallet()
      return
    }
    void check()
    const started = Date.now()
    const timer = window.setInterval(() => {
      const ms = Date.now() - started
      setWaited(ms)
      if (ms > 5 * 60 * 1000) {
        window.clearInterval(timer)
        return
      }
      void check()
    }, 10_000)
    return () => window.clearInterval(timer)
  }, [reference, check, refreshWallet])

  const submitClaim = useCallback(async () => {
    const ref = claim.trim()
    if (!ref) return
    setClaiming(true)
    setClaimMsg(null)
    try {
      const { data } = (await supabase?.auth.getSession()) ?? { data: { session: null } }
      const token = data.session?.access_token
      if (!token) {
        setClaimMsg('Sign in first, then paste the reference from your payment SMS.')
        return
      }
      const res = await fetch(apiUrl('/api/topup/claim'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          apikey: SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ reference: ref }),
      })
      const body = (await res.json().catch(() => ({}))) as { error?: string; px?: number }
      if (!res.ok) {
        setClaimMsg(body.error || 'Could not claim that reference.')
        return
      }
      setClaimMsg('Top-up recovered — your balance is updated.')
      setClaim('')
      setState('paid')
      await refreshWallet()
    } catch {
      setClaimMsg('Could not reach the server. Try again in a moment.')
    } finally {
      setClaiming(false)
    }
  }, [claim, refreshWallet])

  const tone = useMemo(() => {
    if (state === 'paid') return { ring: 'border-emerald-500/30', bg: 'bg-emerald-500/10', text: 'text-emerald-300' }
    if (state === 'failed') return { ring: 'border-rose-500/30', bg: 'bg-rose-500/10', text: 'text-rose-300' }
    return { ring: 'border-neon-cyan/30', bg: 'bg-neon-cyan/10', text: 'text-neon-cyan' }
  }, [state])

  const title =
    state === 'paid'
      ? 'Deposit confirmed'
      : state === 'failed'
        ? 'Payment failed'
        : 'Waiting for your payment'

  const subtitle =
    state === 'paid'
      ? 'Your PX is in your balance and ready to play.'
      : state === 'failed'
        ? 'Nothing was charged. You can try the top-up again.'
        : 'Check your phone and approve the prompt. This page updates on its own.'

  return (
    <div className="mx-auto w-full max-w-[480px] px-4 py-10">
      <div className="mb-4 flex items-center gap-2">
        <button
          type="button"
          onClick={onHome}
          aria-label="Back to games"
          className="grid h-9 w-9 place-items-center rounded-xl border border-white/[0.07] bg-white/[0.03] text-slate-300 transition hover:bg-white/10"
        >
          <IconChevronLeft size={17} />
        </button>
        <h1 className="text-[15px] font-bold text-white">Top up</h1>
      </div>

      <div className={`rounded-2xl border ${tone.ring} ${tone.bg} px-4 py-6 text-center`}>
        {state === 'paid' ? (
          <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-emerald-500/20">
            <IconCheck size={24} className="text-emerald-300" />
          </div>
        ) : state === 'failed' ? (
          <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-rose-500/20 text-2xl">!</div>
        ) : (
          <div className="mx-auto mb-3 h-12 w-12 animate-spin rounded-full border-2 border-neon-cyan/25 border-t-neon-cyan" />
        )}

        <h2 className={`text-[18px] font-black ${tone.text}`}>{title}</h2>
        <p className="mx-auto mt-1 max-w-[320px] text-[12px] leading-relaxed text-slate-400">{subtitle}</p>

        {state === 'pending' && waited > 30_000 && (
          <p className="mt-2 text-[10.5px] text-slate-600">
            Still waiting — this can take a minute on mobile money.
          </p>
        )}
      </div>

      {/* balance card */}
      <div className="panel mt-3 p-3.5">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-[.14em] text-slate-500">New balance</span>
          <span className="num text-[18px] font-black text-white">{money(balance)} PX</span>
        </div>
        <p className="mt-1 text-right text-[11px] text-neon-lime">≈ {money(Math.round(balance / 10))} UGX</p>
      </div>

      {reference && (
        <p className="mt-2 break-all rounded-lg bg-black/30 px-2.5 py-2 text-center text-[9.5px] text-slate-500">
          Reference {detail?.reference ?? reference}
        </p>
      )}

      {error && (
        <p className="mt-2 rounded-lg border border-amber-400/25 bg-amber-400/10 px-2.5 py-2 text-[10.5px] text-amber-200">
          {error}
        </p>
      )}

      <div className="mt-3 space-y-1.5">
        <button type="button" onClick={onHome} className="btn-primary w-full !py-3 !text-[13px]">
          {state === 'paid' ? 'Go play' : 'Back to games'}
        </button>
        {state !== 'pending' && (
          <button type="button" onClick={onTopUpAgain} className="btn-ghost w-full !py-2.5 !text-[12px]">
            {state === 'failed' ? 'Try again' : 'Top up more'}
          </button>
        )}
      </div>

      {state !== 'paid' && (
        <div className="panel mt-3 p-3.5">
          <p className="text-[11px] font-bold text-white">Paid but no credit?</p>
          <p className="mt-0.5 text-[10.5px] leading-relaxed text-slate-500">
            If the email you typed at checkout was different from your account email,
            we can&apos;t match it automatically. Paste the reference from your payment
            SMS and we&apos;ll attach it.
          </p>
          <div className="mt-2 flex gap-1.5">
            <input
              value={claim}
              onChange={(e) => setClaim(e.target.value)}
              placeholder="DG-XXXXXXXX"
              className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/40 px-2.5 py-2 text-[11px] text-white placeholder:text-slate-600 focus:border-neon-cyan/50 focus:outline-none"
            />
            <button
              type="button"
              onClick={submitClaim}
              disabled={claiming || !claim.trim()}
              className="btn-primary shrink-0 !px-3 !py-2 !text-[11px] disabled:opacity-40"
            >
              {claiming ? 'Checking…' : 'Claim'}
            </button>
          </div>
          {claimMsg && (
            <p className="mt-1.5 text-[10.5px] text-neon-cyan">{claimMsg}</p>
          )}
        </div>
      )}

      <p className="mt-4 flex items-start justify-center gap-1.5 text-center text-[9.5px] leading-relaxed text-slate-600">
        <IconShield size={11} className="mt-0.5 shrink-0" />
        Deposits are credited by the payment webhook once your provider confirms — safe to close this page.
      </p>
    </div>
  )
}
