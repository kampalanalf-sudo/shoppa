import React, { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../lib/auth'
import { collect, startHostedCheckout, usePaymentPoll } from '../lib/payments'
import { money } from '../lib/format'
import { sfx } from '../lib/sound'
import { IconCheck, IconClose, IconShield } from './Icons'

const PRESETS = [5000, 10000, 25000, 50000]

/**
 * Buy UGX with mobile money. The balance is credited by the payment webhook once the
 * provider confirms, so this panel only ever *starts* a payment and then polls.
 */
export function TopUpPanel({
  onClose,
  onStarted,
}: {
  onClose: () => void
  /** Called once DGateway returns a reference, so the caller can route to
   *  the success page (which polls) instead of leaving a spinner in a modal. */
  onStarted?: (reference: string) => void
}) {
  const { profile, refreshWallet } = useAuth()

  const [ugx, setUgx] = useState(10000)
  const [phone, setPhone] = useState(profile?.phone ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reference, setReference] = useState<string | null>(null)

  const poll = usePaymentPoll(reference)

  /*
   * The webhook credits the database, and this poll is what notices. Without the
   * refresh the balance on screen is whatever localStorage held, so a player
   * could be credited (payment_orders.completed, ledger +600) and see nothing
   * change. The store now adopts the server balance too, so one refresh here
   * propagates everywhere.
   */
  useEffect(() => {
    if (poll.state === 'completed') {
      sfx.bigwin()
      void refreshWallet()
    }
    if (poll.state === 'failed') setError(poll.detail?.failureReason || 'The payment was not completed.')
  }, [poll.state, poll.detail?.failureReason, refreshWallet])

  const start = useCallback(async () => {
    setError(null)
    setBusy(true)
    try {
      const res = await collect({
        amount: Math.round(ugx),
        currency: 'UGX',
        phone: phone.trim(),
        description: `FloatBet top-up ${money(ugx)} UGX`,
      })
      setReference(res.reference)
      sfx.click()
      onStarted?.(res.reference)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }, [ugx, phone])

  const waiting = poll.state === 'pending'

  /*
   * Why the pay button is inert.
   *
   * It was silently `disabled` when the amount was under 500 or the number was
   * short of nine digits, and a disabled button does nothing at all when tapped
   * — no toast, no border, no message. A player pressing it saw "no outward
   * sign" and had no way to learn that the phone field was empty.
   *
   * The requirement is stated up front instead, and the button only disables
   * while a request is actually in flight.
   */
  const phoneDigits = phone.replace(/[^0-9]/g, '')
  const blockedReason =
    ugx < 500
      ? 'The minimum top-up is UGX 500.'
      : phoneDigits.length < 9
        ? 'Enter the mobile money number to top up, for example 0758 443 666.'
        : null

  // Hosted checkout: the player pays on ZENGAPAY's own page. Nothing here can
  // credit — the webhook does that once it has re-verified the transaction.
  // We only ask the server for a session and navigate to it.
  const startHosted = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const url = await startHostedCheckout(Math.round(ugx))
      if (!url) {
        setError('The payment page is not available right now.')
        return
      }
      window.location.href = url
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }, [ugx])

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center sm:p-4">
      <div className="w-full max-w-[400px] animate-popIn overflow-hidden rounded-t-2xl border border-white/10 bg-ink-850/98 shadow-pop sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-white/[0.07] px-3.5 py-2.5">
          <span className="text-[13px] font-bold text-white">Top up UGX</span>
          <button type="button" onClick={onClose} aria-label="Close" className="text-slate-500 hover:text-white">
            <IconClose size={16} />
          </button>
        </div>

        <div className="space-y-2.5 p-3.5">
          {!reference ? (
            <>
              <div>
                <p className="label">Amount (UGX)</p>
                <div className="mb-1.5 grid grid-cols-4 gap-1">
                  {PRESETS.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setUgx(p)}
                      className={`num rounded-lg border py-1.5 text-[11px] font-bold transition ${
                        ugx === p
                          ? 'border-neon-lime bg-neon-lime/15 text-neon-lime'
                          : 'border-white/10 bg-white/[0.02] text-slate-400'
                      }`}
                    >
                      {money(p)}
                    </button>
                  ))}
                </div>
                <input
                  inputMode="decimal"
                  value={ugx}
                  onChange={(e) => setUgx(Math.max(0, Math.round(Number(e.target.value.replace(/[^0-9]/g, '')) || 0)))}
                  className="field num !text-[16px] font-bold"
                />
                <p className="mt-1 text-[10.5px] text-slate-500">
                  You pay <b className="text-neon-lime">UGX {money(ugx)}</b> and it is credited to your balance in full.
                </p>
              </div>

              <div>
                <p className="label">Mobile money number</p>
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="07XX XXX XXX"
                  inputMode="tel"
                  className="field"
                />
                <p className="mt-1 text-[10px] text-slate-500">
                  MTN or Airtel. Ugandan numbers only on this rail.
                </p>
              </div>

              {error && (
                <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 py-2 text-[11.5px] text-rose-200">
                  {error}
                </div>
              )}

              {blockedReason && (
                <p className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-2.5 py-2 text-[11.5px] text-amber-200">
                  {blockedReason}
                </p>
              )}

              <button
                type="button"
                onClick={() => {
                  // A tap on a blocked form must still say why. The button is no
                  // longer disabled for a form problem, only while sending.
                  if (blockedReason) { setError(blockedReason); return }
                  void start()
                }}
                disabled={busy}
                className="btn-primary w-full !py-3 !text-[13px] disabled:opacity-60"
              >
                {busy ? 'Starting…' : `Pay ${money(ugx)} UGX`}
              </button>
              <p className="flex items-start gap-1.5 text-[9.5px] leading-relaxed text-slate-600">
                <IconShield size={11} className="mt-0.5 shrink-0 text-emerald-500" />
                You will get a prompt on your phone. Approve it to complete the top-up.
              </p>
              <button
                type="button"
                onClick={() => {
                  if (ugx < 500) { setError('The minimum top-up is UGX 500.'); return }
                  void startHosted()
                }}
                disabled={busy}
                className="w-full rounded-lg border border-white/10 py-2.5 text-[11.5px] font-semibold text-slate-300 hover:border-white/20 hover:text-white disabled:opacity-50"
              >
                Or pay on the secure payment page
              </button>
            </>
          ) : (
            <>
              <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3 text-center">
                {waiting ? (
                  <>
                    <div className="mx-auto mb-2 h-8 w-8 animate-spin rounded-full border-2 border-neon-lime/25 border-t-neon-lime" />
                    <p className="text-[13px] font-bold text-white">Check your phone and approve the prompt</p>
                    <p className="mt-1 text-[11px] text-slate-500">
                      Waiting for {phone} · {Math.floor(poll.elapsed / 1000)}s
                    </p>
                  </>
                ) : poll.state === 'completed' ? (
                  <>
                    <p className="mb-1 flex items-center justify-center gap-1.5 text-[13px] font-bold text-emerald-300">
                      <IconCheck size={14} /> Payment confirmed
                    </p>
                    <p className="text-[11px] text-slate-500">
                      UGX {money(ugx)} added to your balance.
                    </p>
                  </>
                ) : poll.state === 'failed' ? (
                  <>
                    <p className="text-[13px] font-bold text-rose-300">Payment failed</p>
                    <p className="mt-1 text-[11px] text-slate-500">Nothing was charged. You can try again.</p>
                  </>
                ) : (
                  <>
                    <p className="text-[13px] font-bold text-amber-300">Still waiting</p>
                    <p className="mt-1 text-[11px] text-slate-500">
                      We stopped checking after 5 minutes. If you approved it, the balance updates automatically.
                    </p>
                  </>
                )}
              </div>

              {poll.detail?.reference && (
                <p className="break-all rounded-lg bg-black/30 px-2 py-1.5 text-center text-[9.5px] text-slate-500">
                  Reference {poll.detail.reference}
                </p>
              )}

              {poll.state !== 'pending' && poll.state !== 'completed' && (
                <button
                  type="button"
                  onClick={() => { setReference(null); setError(null) }}
                  className="btn-ghost w-full !py-2.5 !text-[12px]"
                >
                  Try again
                </button>
              )}
              {poll.state === 'pending' && (
                <button type="button" onClick={onClose} className="btn-ghost w-full !py-2.5 !text-[12px]">
                  Close — keep waiting in the background
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
