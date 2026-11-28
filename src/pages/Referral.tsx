import React, { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../lib/auth'
import {
  claimReferral, referralLink, referralState, type ReferralState,
} from '../lib/referrals'
import { money } from '../lib/format'
import { sfx } from '../lib/sound'
import {
  IconBolt, IconCheck, IconChevronLeft, IconCopy, IconGift, IconInfo, IconUser,
} from '../components/Icons'

/**
 * Referrals.
 *
 * WHAT THE SCREEN HAS TO MAKE UNAMBIGUOUS
 *
 * "A percentage of the profits made from his referrals" can be read two ways —
 * a cut of what the friend DEPOSITS, or a cut of what the house actually KEEPS
 * from that friend. Those are very different amounts, and a screen that is vague
 * about which one it pays is a screen that will be accused of lying the first
 * time a friend deposits 5,000, wins 5,000 back and the reward is nothing.
 *
 * So this page says it in plain words, in this order:
 *
 *   * the rate is `state.rate`, from the database — the same number the payment uses;
 *   * it applies to the first five deposits;
 *   * it is a share of PROFIT: deposits minus what the friend has taken back out
 *     (withdrawals plus whatever is still in their balance), never negative.
 *
 * A friend who is up on the platform therefore earns the referrer nothing, and
 * the page says that before it shows a single reward row.
 */
export function Referral({ onBack }: { onBack: () => void }) {
  const { referralRefresh, refreshWallet } = useAuth()
  const [state, setState] = useState<ReferralState | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [codeInput, setCodeInput] = useState('')
  const [claiming, setClaiming] = useState(false)
  const [claimNotice, setClaimNotice] = useState<string | null>(null)
  const [copied, setCopied] = useState<'code' | 'link' | null>(null)

  const load = useCallback(async () => {
    try {
      setState(await referralState())
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load, referralRefresh])

  const link = state ? referralLink(state.code) : ''

  const copy = async (what: 'code' | 'link') => {
    const text = what === 'code' ? state?.code ?? '' : link
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setCopied(what)
      window.setTimeout(() => setCopied(null), 1600)
    } catch {
      setError('Copy did not work — select the code and copy it by hand.')
    }
  }

  const share = async () => {
    const text = `Join me on FloatBet. Use my code ${state?.code} when you sign up.`
    try {
      if (navigator.share) await navigator.share({ text, url: link })
      else await copy('link')
    } catch {
      /* the player cancelled the share sheet; not an error */
    }
  }

  // Not named `useCode`: eslint reads a `use*` prefix as a hook, and this is a
  // click handler. The name is the only thing that made it look like one.
  const applyCode = async () => {
    setClaiming(true)
    setError(null)
    setClaimNotice(null)
    try {
      const res = await claimReferral(codeInput)
      sfx.win()
      setClaimNotice(`You are now referred by ${res.referrer}.`)
      setCodeInput('')
      await load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setClaiming(false)
    }
  }

  const ratePct = state ? Math.round(state.rate * 10000) / 100 : 2
  const covered = state?.deposits_covered ?? 5

  return (
    <div className="mx-auto w-full max-w-[520px] px-3 py-4">
      <button
        type="button"
        onClick={onBack}
        className="mb-3 flex items-center gap-1.5 text-[12px] font-semibold text-slate-400 hover:text-white"
      >
        <IconChevronLeft size={15} /> Back
      </button>

      <div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-ink-850">
        <div className="border-b border-white/[0.07] bg-gradient-to-br from-neon-violet/[0.14] via-transparent to-transparent px-4 py-3.5">
          <h1 className="text-[17px] font-black text-white">Refer a friend</h1>
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-slate-400">
            {ratePct}% of what the house keeps from their first {covered} deposits.
          </p>
        </div>

        <div className="space-y-3 p-4">
          {loading && <p className="py-6 text-center text-[12px] text-slate-500">Loading your code…</p>}

          {!loading && state && (
            <>
              {/* -------------------------------------------------- the card --- */}
              <div className="rounded-xl border border-neon-lime/25 bg-neon-lime/[0.07] px-3 py-3 text-center">
                <p className="text-[10px] font-bold uppercase tracking-[.18em] text-neon-lime/70">Your code</p>
                <p className="num mt-1 text-[26px] font-black tracking-[.18em] text-white">{state.code}</p>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => void copy('code')}
                    className="btn-dark flex items-center justify-center gap-1.5 !py-2 !text-[11.5px]"
                  >
                    <IconCopy size={12} /> {copied === 'code' ? 'Copied' : 'Copy code'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void share()}
                    className="btn-primary flex items-center justify-center gap-1.5 !py-2 !text-[11.5px]"
                  >
                    <IconGift size={12} /> Share link
                  </button>
                </div>
                <p className="mt-1.5 break-all rounded-lg bg-black/25 px-2 py-1.5 text-[9.5px] text-slate-500">
                  {link}
                </p>
              </div>

              {/* ---------------------------------------------- how it pays --- */}
              <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
                <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">How the {ratePct}% works</p>
                <ul className="space-y-1.5 text-[11px] leading-relaxed text-slate-400">
                  <li className="flex gap-1.5">
                    <IconUser size={12} className="mt-0.5 shrink-0 text-neon-violet" />
                    They sign up with your code. It only counts <b className="text-white">before their first deposit</b>.
                  </li>
                  <li className="flex gap-1.5">
                    <IconBolt size={12} className="mt-0.5 shrink-0 text-neon-violet" />
                    It pays on their <b className="text-white">first {covered} deposits</b> — and only those.
                  </li>
                  <li className="flex gap-1.5">
                    <IconInfo size={12} className="mt-0.5 shrink-0 text-amber-400" />
                    The {ratePct}% is of <b className="text-white">profit</b>: what they deposited, minus what they
                    took back out — withdrawals, and whatever is still sitting in their balance. If they are up on
                    the house, there is no profit and nothing is paid.
                  </li>
                </ul>
                <p className="mt-2 rounded-lg bg-black/25 px-2 py-1.5 text-[10px] leading-relaxed text-slate-500">
                  Example: your friend deposits 5,000 and loses it — profit 5,000, you get{' '}
                  <b className="text-slate-300">UGX {money(Math.floor(5000 * (state.rate || 0.02)))}</b>. They deposit
                  5,000, win 5,000 and withdraw 10,000 — profit 0, you get nothing.
                </p>
              </div>

              {/* --------------------------------------------------- totals --- */}
              <div className="grid grid-cols-3 gap-1.5 text-center">
                {[
                  { l: 'Invited', v: String(state.invited) },
                  { l: 'Rewards', v: String(state.rewards_paid) },
                  { l: 'Earned', v: money(state.earned_px) },
                ].map((x) => (
                  <div key={x.l} className="rounded-lg bg-black/25 px-2 py-1.5">
                    <p className="text-[9px] uppercase tracking-wider text-slate-500">{x.l}</p>
                    <p className="num text-[12.5px] font-bold text-slate-200">{x.v}</p>
                  </div>
                ))}
              </div>

              {/* -------------------------------------------------- friends --- */}
              {state.friends.length > 0 && (
                <div>
                  <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">Your referrals</p>
                  <div className="space-y-1.5">
                    {state.friends.map((f) => (
                      <div key={f.username} className="rounded-lg border border-white/[0.07] bg-white/[0.02] px-2.5 py-2">
                        <div className="flex items-center justify-between">
                          <p className="text-[11.5px] font-semibold text-slate-200">{f.username}</p>
                          <p className="num text-[11.5px] font-bold text-emerald-300">UGX {money(f.earned_px)}</p>
                        </div>
                        <div className="mt-1 flex items-center gap-1">
                          {Array.from({ length: covered }, (_, i) => (
                            <span
                              key={i}
                              className={`h-1.5 flex-1 rounded-full ${i < f.rewards ? 'bg-neon-lime' : 'bg-white/10'}`}
                            />
                          ))}
                          <span className="ml-1 text-[9.5px] text-slate-500">{f.rewards}/{covered}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ------------------------------------------------ reward log --- */}
              {state.rewards.length > 0 && (
                <div>
                  <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">Rewards paid</p>
                  <div className="space-y-1">
                    {state.rewards.slice(0, 10).map((r, i) => (
                      <div key={`${r.referred}-${r.deposit_n}-${i}`} className="flex items-center justify-between rounded-lg bg-black/20 px-2.5 py-1.5">
                        <div className="min-w-0">
                          <p className="truncate text-[11px] text-slate-300">
                            {r.referred} · deposit {r.deposit_n} of {covered}
                          </p>
                          <p className="text-[9.5px] text-slate-600">
                            profit share of UGX {money(r.marginal_px ?? r.profit_px)} ·{' '}
                            {new Date(r.created_at).toLocaleDateString('en-GB')}
                          </p>
                        </div>
                        <p className="num shrink-0 text-[11.5px] font-bold text-emerald-300">+{money(r.reward_px)}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ------------------------------------------------ have a code --- */}
              <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
                <p className="mb-1.5 text-[11px] font-bold text-white">
                  {state.referred_by ? 'You were referred by' : 'Were you given a code?'}
                </p>
                {state.referred_by ? (
                  <p className="flex items-center gap-1.5 text-[12px] font-semibold text-emerald-300">
                    <IconCheck size={13} /> {state.referred_by}
                  </p>
                ) : (
                  <>
                    <div className="flex gap-2">
                      <input
                        value={codeInput}
                        onChange={(e) => setCodeInput(e.target.value.replace(/[^a-zA-Z0-9_]/g, '').toUpperCase().slice(0, 18))}
                        placeholder="FRIEND'S CODE"
                        autoCapitalize="characters"
                        spellCheck={false}
                        className="field num flex-1 !text-[13px]"
                        aria-label="Referral code"
                      />
                      <button
                        type="button"
                        onClick={() => void applyCode()}
                        disabled={claiming || codeInput.length < 3}
                        className="btn-primary shrink-0 !px-3 !text-[12px] disabled:opacity-60"
                      >
                        {claiming ? 'Saving…' : 'Use it'}
                      </button>
                    </div>
                    <p className="mt-1 text-[9.5px] leading-relaxed text-slate-600">
                      A code can only be added before your first deposit, and only once per account.
                    </p>
                  </>
                )}
                {claimNotice && (
                  <p className="mt-1.5 rounded-lg border border-emerald-500/25 bg-emerald-500/[0.08] px-2 py-1.5 text-[11px] text-emerald-200">
                    {claimNotice}
                  </p>
                )}
              </div>

              <button
                type="button"
                onClick={() => void refreshWallet()}
                className="w-full text-[10px] font-semibold text-slate-600 hover:text-slate-400"
              >
                Rewards are credited to your balance as they are earned.
              </button>
            </>
          )}

          {error && (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 py-2 text-[11.5px] text-rose-200">
              {error}
            </div>
          )}
        </div>
      </div>

      <p className="mt-3 text-center text-[10px] leading-relaxed text-slate-600">
        Rewards are a share of the profit the house keeps, credited to your gaming balance. Referring
        someone to gamble is not a way to guarantee an income — if you are talking a friend into
        gambling to earn a reward, stop. 18+.
      </p>
    </div>
  )
}
