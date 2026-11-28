import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'
import { collect, usePaymentPoll } from '../lib/payments'
import {
  cancelDepositRequest, createDepositRequest, currentDepositRequest, giftLink, type DepositRequest,
} from '../lib/deposits'
import { money, timeAgo } from '../lib/format'
import { sfx } from '../lib/sound'
import { MIN_BET } from '../lib/currency'
import { IconBolt, IconCheck, IconChevronLeft, IconCopy, IconShield } from '../components/Icons'
import { PermissionsCard } from '../components/Permissions'
import { confirmationFor } from '../lib/native'

/*
 * Deposit.
 *
 * THE NUMBER IS NOT EDITABLE, AND THAT IS THE POINT
 *
 * This page used to have, buried in the wallet sheet, an amount box and a free
 * phone field. A free phone field on a deposit screen can be typed into with any
 * number — a friend's, a typo, a stranger's — and the money then leaves the
 * player's phone and lands in a wallet they are not signed into. The requirement
 * is that the account's own number is used and shown, not typed.
 *
 * So: the number comes from the profile, is rendered as read-only, and if it is
 * missing the page asks for it ONCE (that is the only way to have an own number
 * at all) and then locks it. The server is not told a phone number for a normal
 * deposit at all — `collect` is called with the number the profile holds.
 */

const PRESETS = [5000, 10000, 25000, 50000, 100000]
const MIN_TOPUP = 500
const MAX_TOPUP = 5_000_000

/** Ugandan mobile-money shape: 07XXXXXXXX, 2567XXXXXXXX or +2567XXXXXXXX. */
const normalise = (raw: string) => {
  const digits = raw.replace(/[^0-9]/g, '')
  if (digits.startsWith('256')) return digits
  if (digits.startsWith('0')) return `256${digits.slice(1)}`
  if (digits.length === 9) return `256${digits}`
  return digits
}
const pretty = (raw: string) => {
  const d = normalise(raw)
  if (!d.startsWith('256') || d.length !== 12) return raw
  return `0${d.slice(3, 6)} ${d.slice(6, 9)} ${d.slice(9)}`
}
const validNumber = (raw: string) => {
  const d = normalise(raw)
  return /^256(7[0-9]|3[0-9])\d{7}$/.test(d)
}

export function Deposit({ onBack, onOpenFloat }: { onBack: () => void; onOpenFloat: () => void }) {
  const { profile, wallet, refreshWallet, updateProfile, user } = useAuth()

  const [open, setOpen] = useState<'deposit' | 'float-me'>('deposit')
  const [ugx, setUgx] = useState(10000)

  // The own number. `profile.phone` when it exists; an entry box only until it
  // does.
  const storedPhone = profile?.phone ?? ''
  const [enteringPhone, setEnteringPhone] = useState(false)
  const [phoneDraft, setPhoneDraft] = useState('')
  const [savingPhone, setSavingPhone] = useState(false)

  const [busy, setBusy] = useState(false)
  // When the phone's own confirmation text arrived, if it has: a timestamp only,
  // so the screen can say the network has spoken.
  const [smsSeen, setSmsSeen] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reference, setReference] = useState<string | null>(null)
  const poll = usePaymentPoll(reference)

  // "Float Me" state
  const [request, setRequest] = useState<DepositRequest | null>(null)
  const [requestBusy, setRequestBusy] = useState(false)
  const [requestError, setRequestError] = useState<string | null>(null)
  const [copied, setCopied] = useState<'code' | 'link' | null>(null)

  const balance = wallet?.balance_px ?? 0
  const own = storedPhone
  const ownOk = validNumber(own)

  // The live request, so a player who already sent a code sees it, not an error.
  const loadRequest = useCallback(async () => {
    try {
      setRequest(await currentDepositRequest())
    } catch {
      /* the panel works without it */
    }
  }, [])
  useEffect(() => { void loadRequest() }, [loadRequest])

  useEffect(() => {
    if (poll.state === 'completed') {
      sfx.bigwin()
      void refreshWallet()
    }
    if (poll.state === 'failed') setError(poll.detail?.failureReason || 'The payment was not completed.')
  }, [poll.state, poll.detail?.failureReason, refreshWallet])

  // The request turning paid is what the requester is waiting for, so watch it.
  useEffect(() => {
    if (!request || request.status !== 'pending') return
    const t = window.setInterval(() => {
      void (async () => {
        if (!supabase || !user) return
        const { data } = await supabase
          .from('deposit_requests')
          .select('*')
          .eq('code', request.code)
          .maybeSingle()
        const row = data as DepositRequest | null
        if (row && row.status !== 'pending') {
          setRequest(row)
          if (row.status === 'paid') {
            sfx.bigwin()
            void refreshWallet()
          }
        }
      })()
    }, 8000)
    return () => window.clearInterval(t)
  }, [request, refreshWallet, user])

  /*
   * A deposit the network has already confirmed.
   *
   * While a payment is pending, the confirmation text on the player's own phone is
   * the fastest evidence available — faster than the webhook round-trip. It is used
   * ONLY to refresh the balance and say so: the credit itself comes from the
   * webhook, so a forged message changes nothing but the wording on this screen.
   */
  useEffect(() => {
    if (poll.state !== 'pending') return
    const t = window.setInterval(() => {
      const hit = confirmationFor(ugx)
      if (!hit) return
      void refreshWallet()
      setSmsSeen(hit.date)
    }, 3000)
    return () => window.clearInterval(t)
  }, [poll.state, ugx, refreshWallet])

  const savePhone = async () => {
    if (!validNumber(phoneDraft)) {
      setError('Enter a Ugandan mobile money number, for example 0758 443 666.')
      return
    }
    setSavingPhone(true)
    setError(null)
    try {
      await updateProfile({ phone: normalise(phoneDraft) })
      setEnteringPhone(false)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSavingPhone(false)
    }
  }

  const startDeposit = async () => {
    setError(null)
    if (!ownOk) {
      setError('Add your mobile money number first — deposits are charged to your own number.')
      setEnteringPhone(true)
      return
    }
    if (ugx < MIN_TOPUP) { setError(`The minimum deposit is UGX ${money(MIN_TOPUP)}.`); return }
    if (ugx > MAX_TOPUP) { setError(`The maximum deposit is UGX ${money(MAX_TOPUP)}.`); return }

    setBusy(true)
    try {
      // The number is the profile's, not a field this page can be typed into.
      const res = await collect({
        amount: Math.round(ugx),
        currency: 'UGX',
        phone: own,
        description: `FloatBet deposit ${money(ugx)} UGX`,
      })
      setReference(res.reference)
      sfx.click()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const askForFloatMe = async () => {
    setRequestError(null)
    if (ugx < MIN_TOPUP) { setRequestError(`The minimum is UGX ${money(MIN_TOPUP)}.`); return }
    setRequestBusy(true)
    try {
      const created = await createDepositRequest(ugx)
      setRequest(created)
      sfx.win()
    } catch (e) {
      setRequestError((e as Error).message)
    } finally {
      setRequestBusy(false)
    }
  }

  const cancelRequest = async () => {
    if (!request) return
    setRequestBusy(true)
    try {
      await cancelDepositRequest(request.code)
      setRequest(null)
    } catch (e) {
      setRequestError((e as Error).message)
    } finally {
      setRequestBusy(false)
    }
  }

  const copy = async (what: 'code' | 'link') => {
    if (!request) return
    const text = what === 'code' ? request.code : giftLink(request.code)
    try {
      await navigator.clipboard.writeText(text)
      setCopied(what)
      window.setTimeout(() => setCopied(null), 1600)
    } catch {
      setRequestError('Copy did not work — select the code and copy it by hand.')
    }
  }

  const expiry = useMemo(() => {
    if (!request) return ''
    const ms = new Date(request.expires_at).getTime() - Date.now()
    if (ms <= 0) return 'expired'
    const h = Math.floor(ms / 3_600_000)
    return h >= 1 ? `${h}h left` : `${Math.max(1, Math.floor(ms / 60_000))}m left`
  }, [request])

  const waiting = poll.state === 'pending'

  return (
    <div className="mx-auto w-full max-w-[520px] px-3 py-4">
      <button type="button" onClick={onBack} className="mb-3 flex items-center gap-1.5 text-[12px] font-semibold text-slate-400 hover:text-white">
        <IconChevronLeft size={15} /> Back
      </button>

      <div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-ink-850">
        <div className="border-b border-white/[0.07] bg-gradient-to-br from-neon-lime/[0.10] via-transparent to-transparent px-4 py-3.5">
          <h1 className="text-[17px] font-black text-white">Deposit</h1>
          <p className="mt-0.5 text-[11.5px] text-slate-400">
            Balance <span className="num font-bold text-white">UGX {money(balance)}</span> · credited only when the network confirms
          </p>
        </div>

        <div className="flex gap-1 border-b border-white/[0.07] p-1.5">
          {([['deposit', 'Pay myself'], ['float-me', 'Float Me']] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => { setOpen(id); sfx.click() }}
              className={`flex-1 rounded-lg py-2 text-[12.5px] font-bold transition ${
                open === id ? 'bg-white/[0.09] text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="space-y-3 p-4">
          {/* ---------------------------------------------------- amount --- */}
          <div>
            <p className="label">Amount (UGX)</p>
            <div className="mb-1.5 grid grid-cols-5 gap-1">
              {PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setUgx(p)}
                  className={`num rounded-lg border py-1.5 text-[10.5px] font-bold transition ${
                    ugx === p ? 'border-neon-lime bg-neon-lime/15 text-neon-lime' : 'border-white/10 bg-white/[0.02] text-slate-400'
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
              aria-label="Deposit amount in UGX"
            />
          </div>

          {/* ------------------------------------------------- the number --- */}
          <div>
            <p className="label">
              <span>Your mobile money number</span>
              {ownOk && !enteringPhone && (
                <span className="normal-case tracking-normal text-slate-500">from your account · not editable</span>
              )}
            </p>

            {enteringPhone || !ownOk ? (
              <>
                <div className="flex gap-2">
                  <input
                    value={phoneDraft}
                    onChange={(e) => setPhoneDraft(e.target.value)}
                    placeholder="0758 443 666"
                    inputMode="tel"
                    className="field"
                    aria-label="Your mobile money number"
                  />
                  <button type="button" onClick={() => void savePhone()} disabled={savingPhone} className="btn-dark shrink-0 !px-3">
                    {savingPhone ? 'Saving…' : 'Save'}
                  </button>
                </div>
                <p className="mt-1 text-[10px] text-slate-500">
                  {normalise(phoneDraft) && validNumber(phoneDraft) ? `Will be charged as ${pretty(phoneDraft)} — MTN or Airtel.` : 'MTN or Airtel. Set once; it is then locked to your account.'}
                </p>
              </>
            ) : (
              <div className="flex items-center justify-between rounded-lg border border-white/[0.09] bg-white/[0.03] px-3 py-2.5">
                <span className="num text-[14px] font-bold text-white">{pretty(own)}</span>
                <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-400">
                  <IconCheck size={12} /> locked
                </span>
              </div>
            )}
          </div>

          {error && (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 py-2 text-[11.5px] text-rose-200">
              {error}
            </div>
          )}

          {/* ------------------------------------------------ pay myself --- */}
          {open === 'deposit' && (
            <>
              {!reference ? (
                <>
                  <button
                    type="button"
                    onClick={() => void startDeposit()}
                    disabled={busy}
                    className="btn-primary w-full !py-3 !text-[13px] disabled:opacity-60"
                  >
                    {busy ? 'Starting…' : `Deposit ${money(ugx)} UGX`}
                  </button>
                  <p className="flex items-start gap-1.5 text-[9.5px] leading-relaxed text-slate-600">
                    <IconShield size={11} className="mt-0.5 shrink-0 text-emerald-500" />
                    You approve a prompt on {ownOk ? pretty(own) : 'your phone'}. Your balance moves only after the network confirms.
                  </p>
                </>
              ) : waiting ? (
                <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3 text-center">
                  <div className="mx-auto mb-2 h-8 w-8 animate-spin rounded-full border-2 border-neon-lime/25 border-t-neon-lime" />
                  <p className="text-[13px] font-bold text-white">Check your phone and approve</p>
                  <p className="mt-1 text-[11px] text-slate-500">{pretty(own)} · {Math.floor(poll.elapsed / 1000)}s</p>
                  {smsSeen && (
                    <p className="mt-1.5 text-[10.5px] font-semibold text-emerald-300">
                      The network's confirmation text arrived — refreshing your balance.
                    </p>
                  )}
                </div>
              ) : (
                <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3 text-center">
                  {poll.state === 'completed' ? (
                    <>
                      <p className="flex items-center justify-center gap-1.5 text-[13px] font-bold text-emerald-300">
                        <IconCheck size={14} /> Deposit confirmed
                      </p>
                      <p className="mt-1 text-[11px] text-slate-500">UGX {money(ugx)} added to your balance.</p>
                    </>
                  ) : (
                    <>
                      <p className="text-[13px] font-bold text-amber-300">
                        {poll.state === 'failed' ? 'Payment failed' : 'Still waiting'}
                      </p>
                      <p className="mt-1 text-[11px] text-slate-500">
                        {poll.state === 'failed'
                          ? 'Nothing was charged. Try again.'
                          : 'If you approved it, the balance updates on its own.'}
                      </p>
                    </>
                  )}
                  <button type="button" onClick={() => { setReference(null); setError(null) }} className="btn-ghost mt-2.5 w-full !py-2 !text-[12px]">
                    Deposit again
                  </button>
                </div>
              )}
            </>
          )}

          {/* -------------------------------------------------- Float Me --- */}
          {open === 'float-me' && (
            <>
              {!request ? (
                <>
                  <button
                    type="button"
                    onClick={() => void askForFloatMe()}
                    disabled={requestBusy}
                    className="btn-primary w-full !py-3 !text-[13px] disabled:opacity-60"
                  >
                    {requestBusy ? 'Creating…' : 'Float Me — ask someone to pay'}
                  </button>
                  <p className="text-[10.5px] leading-relaxed text-slate-500">
                    We give you a code for <b className="text-white">UGX {money(ugx)}</b>.
                    Send it to whoever is willing to pay. They enter <i>their</i> number and approve the
                    prompt; the money lands in <b className="text-white">your</b> balance, not theirs.
                    The code lasts 24 hours and works once.
                  </p>
                </>
              ) : request.status === 'paid' ? (
                <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/[0.08] px-3 py-3 text-center">
                  <p className="flex items-center justify-center gap-1.5 text-[13px] font-bold text-emerald-300">
                    <IconCheck size={14} /> Paid — UGX {money(request.amount)} credited
                  </p>
                  <p className="mt-1 text-[11px] text-slate-400">Your balance has been updated.</p>
                  <button type="button" onClick={() => { setRequest(null); setOpen('deposit') }} className="btn-ghost mt-2.5 w-full !py-2 !text-[12px]">
                    Back to deposits
                  </button>
                </div>
              ) : (
                <>
                  <div className="rounded-xl border border-neon-lime/25 bg-neon-lime/[0.07] px-3 py-3 text-center">
                    <p className="text-[10px] font-bold uppercase tracking-[.18em] text-neon-lime/70">Deposit code</p>
                    <p className="num mt-1 text-[26px] font-black tracking-[.18em] text-white">{request.code}</p>
                    <p className="mt-0.5 text-[11px] text-slate-400">
                      UGX {money(request.amount)} · {expiry}
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <button type="button" onClick={() => void copy('code')} className="btn-dark flex items-center justify-center gap-1.5 !py-2.5 !text-[12px]">
                      <IconCopy size={13} /> {copied === 'code' ? 'Copied' : 'Copy code'}
                    </button>
                    <button type="button" onClick={() => void copy('link')} className="btn-dark flex items-center justify-center gap-1.5 !py-2.5 !text-[12px]">
                      <IconBolt size={13} /> {copied === 'link' ? 'Copied' : 'Copy link'}
                    </button>
                  </div>
                  <p className="break-all rounded-lg bg-black/30 px-2 py-1.5 text-[9.5px] leading-relaxed text-slate-500">
                    {giftLink(request.code)}
                  </p>
                  <p className="text-[10.5px] leading-relaxed text-slate-500">
                    Anyone with this code can pay it once. We check every 8 seconds and credit you the
                    moment the network confirms — you do not need to do anything else.
                  </p>
                  <button type="button" onClick={() => void cancelRequest()} disabled={requestBusy} className="btn-ghost w-full !py-2 !text-[11.5px] disabled:opacity-50">
                    Cancel this request
                  </button>
                </>
              )}

              {requestError && (
                <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 py-2 text-[11.5px] text-rose-200">
                  {requestError}
                </div>
              )}
            </>
          )}
        </div>

        {/* ------------------------------------------------- phone checks --- */}
        <div className="border-t border-white/[0.07] px-4 py-3">
          <PermissionsCard />
        </div>

        {/* ------------------------------------------------------- Float --- */}
        <div className="border-t border-white/[0.07] bg-white/[0.015] px-4 py-3.5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[13px] font-bold text-white">Need a float?</p>
              <p className="mt-0.5 text-[10.5px] leading-relaxed text-slate-500">
                Borrow up to your limit, straight into your balance. Repay in 3 instalments inside
                24 hours; after that it is 6% of what is left, every 24 hours.
              </p>
            </div>
            <button type="button" onClick={onOpenFloat} className="btn-primary shrink-0 !px-3 !py-2 !text-[12px]">
              Borrow
            </button>
          </div>
        </div>
      </div>

      <p className="mt-3 text-center text-[10px] text-slate-600">
        Minimum deposit UGX {money(MIN_TOPUP)} · Minimum bet UGX {money(MIN_BET)} · 18+ · Play responsibly.
      </p>
      {request?.created_at && (
        <p className="mt-1 text-center text-[9.5px] text-slate-700">
          Request created {timeAgo(new Date(request.created_at).getTime())}
        </p>
      )}
    </div>
  )
}
