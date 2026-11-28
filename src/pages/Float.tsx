import React, { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../lib/auth'
import { repayFloat, requestFloat, floatState, type FloatState } from '../lib/deposits'
import { money, timeAgo } from '../lib/format'
import { sfx } from '../lib/sound'
import { IconBolt, IconCheck, IconChevronLeft, IconInfo, IconShield } from '../components/Icons'

/**
 * Float — the credit product.
 *
 * WHAT THE PLAYER IS TOLD, AND WHY EXACTLY THIS
 *
 * A loan shown as "get UGX 5,000" is a loan the player will treat as a win. So
 * the screen states the three things that matter before a single shilling is
 * credited:
 *
 *   1. it is not cash — it lands in the gaming balance and cannot be withdrawn;
 *   2. it is three payments, all within 24 hours;
 *   3. after those 24 hours it costs 6% of what is left, every day.
 *
 * Every number on this page is the database's: the limit, the instalments, the
 * outstanding balance and the levy. The client cannot name a limit or a fee.
 */
export function Float({ onBack, onDeposit }: { onBack: () => void; onDeposit: () => void }) {
  const { refreshWallet, wallet } = useAuth()
  const [state, setState] = useState<FloatState | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [amount, setAmount] = useState(0)
  const [repayIn, setRepayIn] = useState(0)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const s = await floatState()
      setState(s)
      if (!s.open) setAmount(Math.min(s.offer.limit, Math.max(0, amount || s.offer.limit)))
      else setRepayIn(s.outstanding)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
    // `amount` deliberately not a dependency: this reloads on actions, not on typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => { void load() }, [load])

  const borrow = async () => {
    setError(null)
    setDone(null)
    setBusy(true)
    try {
      const res = await requestFloat(amount)
      sfx.bigwin()
      setDone(`UGX ${money(res.principal)} credited to your balance. First instalment in 8 hours.`)
      await refreshWallet()
      await load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const repay = async (howMuch: number) => {
    setError(null)
    setDone(null)
    setBusy(true)
    try {
      const res = await repayFloat(howMuch)
      sfx.win()
      setDone(
        res.status === 'settled'
          ? 'Float cleared. Your account is square.'
          : `UGX ${money(res.paid)} repaid. UGX ${money(res.outstanding)} still owed.`,
      )
      await refreshWallet()
      await load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const balance = wallet?.balance_px ?? 0
  const levyPct = state?.open ? Math.round(state.levy_rate * 100) : 6

  return (
    <div className="mx-auto w-full max-w-[520px] px-3 py-4">
      <button type="button" onClick={onBack} className="mb-3 flex items-center gap-1.5 text-[12px] font-semibold text-slate-400 hover:text-white">
        <IconChevronLeft size={15} /> Back
      </button>

      <div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-ink-850">
        <div className="border-b border-white/[0.07] bg-gradient-to-br from-neon-violet/[0.14] via-transparent to-transparent px-4 py-3.5">
          <h1 className="text-[17px] font-black text-white">Float</h1>
          <p className="mt-0.5 text-[11.5px] text-slate-400">
            Credit into your gaming balance · 3 instalments · 24 hours
          </p>
        </div>

        <div className="space-y-3 p-4">
          {loading && <p className="py-6 text-center text-[12px] text-slate-500">Loading your limit…</p>}

          {!loading && state && !state.open && (
            <>
              {state.offer.eligible ? (
                <>
                  <div className="rounded-xl border border-neon-lime/25 bg-neon-lime/[0.07] px-3 py-3 text-center">
                    <p className="text-[10px] font-bold uppercase tracking-[.18em] text-neon-lime/70">Your limit</p>
                    <p className="num mt-0.5 text-[26px] font-black text-white">UGX {money(state.offer.limit)}</p>
                  </div>

                  <div>
                    <p className="label">Borrow (UGX)</p>
                    <input
                      inputMode="decimal"
                      value={amount}
                      onChange={(e) => setAmount(Math.min(state.offer.limit, Math.max(0, Math.round(Number(e.target.value.replace(/[^0-9]/g, '')) || 0))))}
                      className="field num !text-[16px] font-bold"
                      aria-label="Amount to borrow"
                    />
                    <div className="mt-1.5 grid grid-cols-3 gap-1">
                      {[0.25, 0.5, 1].map((f) => {
                        const v = Math.floor((state.offer.limit * f) / 100) * 100
                        return (
                          <button key={f} type="button" onClick={() => setAmount(v)}
                            className={`num rounded-lg border py-1.5 text-[10.5px] font-bold ${amount === v ? 'border-neon-lime bg-neon-lime/15 text-neon-lime' : 'border-white/10 text-slate-400'}`}>
                            {money(v)}
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
                    <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">The terms, in full</p>
                    <ul className="space-y-1.5 text-[11px] leading-relaxed text-slate-400">
                      <li className="flex gap-1.5"><IconInfo size={12} className="mt-0.5 shrink-0 text-neon-violet" />
                        It is <b className="text-white">not cash</b>. It is credited to your gaming balance and cannot be withdrawn.
                      </li>
                      <li className="flex gap-1.5"><IconInfo size={12} className="mt-0.5 shrink-0 text-neon-violet" />
                        Repay in <b className="text-white">3 instalments</b> at 8h, 16h and 24h, from the same balance.
                      </li>
                      <li className="flex gap-1.5"><IconInfo size={12} className="mt-0.5 shrink-0 text-amber-400" />
                        Anything still owed when the 24 hours end costs <b className="text-amber-200">{levyPct}% of what is left</b>,
                        and another {levyPct}% every 24 hours after that.
                      </li>
                    </ul>
                  </div>

                  {amount > 0 && (
                    <div className="grid grid-cols-3 gap-1.5 text-center">
                      {[1, 2, 3].map((n) => {
                        const share = n < 3 ? Math.floor(amount / 3) : amount - Math.floor(amount / 3) * 2
                        return (
                          <div key={n} className="rounded-lg bg-black/25 px-2 py-1.5">
                            <p className="text-[9px] uppercase tracking-wider text-slate-500">Repay {n}</p>
                            <p className="num text-[12px] font-bold text-slate-200">{money(share)}</p>
                            <p className="text-[9px] text-slate-600">{n * 8}h</p>
                          </div>
                        )
                      })}
                    </div>
                  )}

                  <button type="button" onClick={() => void borrow()} disabled={busy || amount < 300}
                    className="btn-primary w-full !py-3 !text-[13px] disabled:opacity-60">
                    {busy ? 'Crediting…' : amount < 300 ? 'Choose an amount' : `Float me ${money(amount)} UGX`}
                  </button>
                </>
              ) : (
                <div className="rounded-xl border border-amber-500/25 bg-amber-500/[0.08] px-3 py-3">
                  <p className="text-[12.5px] font-bold text-amber-200">No float available right now</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-amber-200/80">
                    {state.offer.reason || 'Your account is not eligible for a float yet.'}
                  </p>
                  <button type="button" onClick={onDeposit} className="btn-primary mt-2.5 w-full !py-2 !text-[12px]">
                    Make a deposit instead
                  </button>
                </div>
              )}
            </>
          )}

          {!loading && state && state.open && (
            <>
              <div className="rounded-xl border border-amber-500/25 bg-amber-500/[0.08] px-3 py-3">
                <p className="text-[10px] font-bold uppercase tracking-[.18em] text-amber-200/70">You owe</p>
                <p className="num mt-0.5 text-[26px] font-black text-white">UGX {money(state.outstanding)}</p>
                <p className="mt-0.5 text-[11px] text-amber-200/80">
                  {state.overdue
                    ? `Overdue · ${levyPct}% was added at the deadline and every 24h since`
                    : `Due ${new Date(state.due_at).toLocaleString('en-GB', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })}`}
                </p>
                {state.levy_due > 0 && (
                  <p className="mt-1.5 rounded-lg bg-black/25 px-2 py-1.5 text-[10.5px] text-amber-100">
                    {levyPct}% levy not yet posted: <b>UGX {money(state.levy_due)}</b>. It is added to what you owe.
                  </p>
                )}
              </div>

              <div>
                <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">Instalments</p>
                <div className="space-y-1.5">
                  {state.installments.map((i) => {
                    const settledInst = i.paid >= i.amount
                    return (
                      <div key={i.n} className="flex items-center justify-between rounded-lg border border-white/[0.07] bg-white/[0.02] px-2.5 py-2">
                        <div>
                          <p className="text-[11.5px] font-semibold text-slate-200">Instalment {i.n}</p>
                          <p className="text-[9.5px] text-slate-500">
                            {settledInst ? 'paid' : new Date(i.due_at).toLocaleString('en-GB', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className={`num text-[12px] font-bold ${settledInst ? 'text-emerald-300' : 'text-white'}`}>
                            {settledInst ? <span className="flex items-center gap-1"><IconCheck size={12} /> {money(i.amount)}</span> : money(i.amount)}
                          </p>
                          {i.paid > 0 && !settledInst && (
                            <p className="num text-[9.5px] text-slate-500">{money(i.paid)} paid</p>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              <div>
                <p className="label">Repay from your balance</p>
                <input
                  inputMode="decimal"
                  value={repayIn}
                  onChange={(e) => setRepayIn(Math.min(state.outstanding, Math.max(0, Math.round(Number(e.target.value.replace(/[^0-9]/g, '')) || 0))))}
                  className="field num !text-[16px] font-bold"
                  aria-label="Amount to repay"
                />
                <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                  <button type="button" onClick={() => setRepayIn(Math.min(state.outstanding, balance))} className="btn-dark !py-2 !text-[11.5px]">
                    What I can
                  </button>
                  <button type="button" onClick={() => setRepayIn(state.outstanding)} className="btn-dark !py-2 !text-[11.5px]">
                    Clear it all
                  </button>
                </div>
              </div>

              <button
                type="button"
                onClick={() => void repay(repayIn)}
                disabled={busy || repayIn <= 0 || repayIn > balance}
                className="btn-primary w-full !py-3 !text-[13px] disabled:opacity-60"
              >
                {busy ? 'Repaying…' : repayIn > balance ? 'Not enough balance' : `Repay ${money(repayIn)} UGX`}
              </button>
              <p className="flex items-start gap-1.5 text-[9.5px] leading-relaxed text-slate-600">
                <IconShield size={11} className="mt-0.5 shrink-0 text-emerald-500" />
                Repaid from your gaming balance. Until it is cleared, the amount owed is held back from withdrawals.
              </p>
              {balance < state.outstanding && (
                <button type="button" onClick={onDeposit} className="btn-ghost flex w-full items-center justify-center gap-1.5 !py-2.5 !text-[12px]">
                  <IconBolt size={13} /> Deposit to clear it
                </button>
              )}
            </>
          )}

          {error && (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 py-2 text-[11.5px] text-rose-200">{error}</div>
          )}
          {done && (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-2 text-[11.5px] text-emerald-200">{done}</div>
          )}
        </div>
      </div>

      <p className="mt-3 text-center text-[10px] leading-relaxed text-slate-600">
        Float is credit, not cash. It cannot be withdrawn, and it is repayable from your gaming
        balance. Borrowing to keep playing is how a bad day becomes a worse one — if you are
        borrowing to chase a loss, stop and talk to support. 18+.
      </p>
    </div>
  )
}
