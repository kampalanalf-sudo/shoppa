import React, { useCallback, useEffect, useState } from 'react'
import { lookupDepositCode, payDepositCode, type GiftLookup } from '../lib/deposits'
import { money } from '../lib/format'
import { sfx } from '../lib/sound'
import { IconBolt, IconCheck, IconInfo, IconShield } from '../components/Icons'

/**
 * The page a SPONSOR opens.
 *
 * It is public on purpose: the person paying for a friend's deposit usually has
 * no FloatBet account, and asking them to create one before they can be generous
 * is how a "Float Me" request goes unpaid. So this screen takes a code and a
 * phone number and nothing else.
 *
 * What it must NOT do is show the payer anything about the requester. It does not
 * know their name, their balance or their history, and it does not ask the server
 * for them: the lookup is a separate function that returns an amount, a currency
 * and a status. A payer is paying a code, not a person.
 */
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
const validNumber = (raw: string) => /^256(7[0-9]|3[0-9])\d{7}$/.test(normalise(raw))

export function FloatMe({ code: initial, onHome }: { code: string; onHome: () => void }) {
  const [code, setCode] = useState(initial.replace(/[^A-Za-z0-9]/g, '').toUpperCase())
  const [info, setInfo] = useState<GiftLookup | null>(null)
  const [checking, setChecking] = useState(false)
  const [phone, setPhone] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reference, setReference] = useState<string | null>(null)

  const check = useCallback(async (value: string) => {
    if (value.length !== 8) { setInfo(null); return }
    setChecking(true)
    setError(null)
    try {
      setInfo(await lookupDepositCode(value))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setChecking(false)
    }
  }, [])

  // A link carries the code, so look it up immediately rather than making the
  // payer press a button first.
  useEffect(() => { if (code.length === 8) void check(code) }, [code, check])

  const pay = async () => {
    setError(null)
    if (!validNumber(phone)) {
      setError('Enter the MTN or Airtel number you will pay from, e.g. 0758 443 666.')
      return
    }
    if (!info?.found || info.status !== 'pending') {
      setError('This code cannot be paid right now.')
      return
    }
    setBusy(true)
    try {
      const res = await payDepositCode(code, normalise(phone))
      setReference(res.reference)
      sfx.win()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-[460px] px-3 py-6">
      <div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-ink-850">
        <div className="border-b border-white/[0.07] bg-gradient-to-br from-neon-lime/[0.12] via-transparent to-transparent px-4 py-4">
          <h1 className="text-[18px] font-black text-white">Float Me</h1>
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-slate-400">
            A player has asked someone to pay their deposit. Paying here sends{' '}
            <b className="text-white">their</b> balance the money — you are not opening an account.
          </p>
        </div>

        <div className="space-y-3 p-4">
          {reference ? (
            <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/[0.08] px-3 py-4 text-center">
              <p className="flex items-center justify-center gap-1.5 text-[14px] font-bold text-emerald-300">
                <IconCheck size={16} /> Prompt sent
              </p>
              <p className="mt-1 text-[11.5px] leading-relaxed text-slate-400">
                Approve it on {pretty(phone)}. The player is credited the moment the network
                confirms — usually under a minute.
              </p>
              <p className="mt-2 break-all rounded-lg bg-black/30 px-2 py-1.5 text-[9.5px] text-slate-500">
                Reference {reference}
              </p>
              <button type="button" onClick={onHome} className="btn-primary mt-3 w-full !py-2.5 !text-[12.5px]">
                Done
              </button>
            </div>
          ) : (
            <>
              <div>
                <p className="label">Deposit code</p>
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 8))}
                  placeholder="XXXXXXXX"
                  autoCapitalize="characters"
                  autoComplete="off"
                  spellCheck={false}
                  className="field num !text-center !text-[20px] font-black tracking-[.3em]"
                  aria-label="Deposit code"
                />
              </div>

              {checking && <p className="text-center text-[11px] text-slate-500">Checking…</p>}

              {info && !info.found && (
                <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 py-2 text-[11.5px] text-rose-200">
                  {(info as { error?: string }).error || 'That code does not exist.'}
                </p>
              )}

              {info?.found && (
                <>
                  <div className={`rounded-xl border px-3 py-3 text-center ${
                    info.status === 'pending'
                      ? 'border-neon-lime/25 bg-neon-lime/[0.07]'
                      : 'border-amber-500/25 bg-amber-500/[0.08]'
                  }`}>
                    <p className="text-[10px] font-bold uppercase tracking-[.18em] text-slate-400">They asked for</p>
                    <p className="num mt-0.5 text-[24px] font-black text-white">
                      UGX {money(info.amount)}
                    </p>
                    <p className="mt-0.5 text-[11px] text-slate-400">
                      {info.status === 'pending' ? 'Still payable' : `Already ${info.status} — nothing was charged`}
                    </p>
                  </div>

                  {info.status === 'pending' && (
                    <>
                      <div>
                        <p className="label">Pay from your number</p>
                        <input
                          value={phone}
                          onChange={(e) => setPhone(e.target.value)}
                          placeholder="0758 443 666"
                          inputMode="tel"
                          className="field"
                          aria-label="Your mobile money number"
                        />
                        <p className="mt-1 text-[10px] text-slate-500">
                          MTN or Airtel, Uganda. This is the number that gets the prompt and pays.
                        </p>
                      </div>

                      <button type="button" onClick={() => void pay()} disabled={busy}
                        className="btn-primary w-full !py-3 !text-[13px] disabled:opacity-60">
                        {busy ? 'Starting…' : `Pay ${money(info.amount)} UGX for them`}
                      </button>
                    </>
                  )}
                </>
              )}

              {error && (
                <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 py-2 text-[11.5px] text-rose-200">{error}</p>
              )}

              <p className="flex items-start gap-1.5 text-[9.5px] leading-relaxed text-slate-600">
                <IconShield size={11} className="mt-0.5 shrink-0 text-emerald-500" />
                The amount is fixed by the player who asked, so it cannot be changed here. A code
                works once. You are charged by the network and we never see your PIN.
              </p>
            </>
          )}
        </div>
      </div>

      <div className="mt-4 flex items-center justify-center gap-1.5 rounded-xl border border-white/[0.07] bg-white/[0.02] px-3 py-2.5 text-[10.5px] text-slate-500">
        <IconInfo size={13} className="shrink-0 text-neon-violet" />
        FloatBet never asks for a deposit to release a withdrawal.
      </div>
      <button type="button" onClick={onHome} className="btn-ghost mt-3 flex w-full items-center justify-center gap-1.5 !py-2.5 !text-[12px]">
        <IconBolt size={13} /> Go to FloatBet
      </button>
    </div>
  )
}
