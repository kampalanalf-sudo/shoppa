import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'
import { disburse, usePaymentPoll } from '../lib/payments'
import { money } from '../lib/format'
import { pxToUgx, railForPhone, validPhone } from '../lib/proxicash'
import { sfx } from '../lib/sound'
import { IconChevronLeft, IconShield, IconCheck } from '../components/Icons'

type Row = {
  id: string
  kind: 'momo' | 'crypto'
  amount_px: number
  ugx: number
  status: string
  phone: string | null
  asset: string | null
  created_at: string
  failure_reason: string | null
}

const MIN_PX = 10000
const CRYPTO = ['USDT', 'USDC', 'BTC'] as const

const STATUS_TONE: Record<string, string> = {
  requested: 'text-slate-400',
  pending_provider: 'text-amber-300',
  paid: 'text-emerald-300',
  failed: 'text-rose-300',
  cancelled: 'text-slate-500',
}

export function Cashout({ onBack }: { onBack: () => void }) {
  const { profile, wallet, refreshWallet, updateProfile } = useAuth()
  const balance = wallet?.balance_px ?? 0

  const [tab, setTab] = useState<'momo' | 'crypto'>('momo')
  const [amount, setAmount] = useState(MIN_PX)
  const [phone, setPhone] = useState(profile?.phone ?? '')
  const [asset, setAsset] = useState<(typeof CRYPTO)[number]>('USDT')
  const [address, setAddress] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [rows, setRows] = useState<Row[]>([])
  const [reference, setReference] = useState<string | null>(null)
  const poll = usePaymentPoll(reference)

  const ugx = useMemo(() => pxToUgx(amount), [amount])
  const rail = useMemo(() => railForPhone(phone), [phone])

  const loadedRows = useCallback(async () => {
    const client = supabase
    if (!client) return
    const { data } = await client
      .from('cashouts')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(20)
    if (data) setRows(data as Row[])
  }, [])

  useEffect(() => {
    void loadedRows()
  }, [loadedRows])

  const setMax = () => setAmount(Math.max(0, balance))

  const submit = async () => {
    if (!supabase) return
    setError(null)
    setNotice(null)
    if (amount < MIN_PX) return setError(`Minimum cashout is ${money(MIN_PX)} PX (1,000 UGX).`)
    if (amount > balance) return setError('That is more than your balance.')
    if (tab === 'momo') {
      if (!validPhone(phone)) return setError('Enter a valid Ugandan mobile money number.')
      if (!rail) return setError('That number is not on MTN or Airtel.')
    } else {
      if (address.trim().length < 20) return setError('Enter a valid wallet address.')
    }

    setBusy(true)
    try {
      // 1. move PX out of the spendable balance into a hold
      const { data, error: rpcErr } = await supabase.rpc('request_cashout', {
        p_kind: tab,
        p_amount_px: Math.round(amount),
        p_phone: tab === 'momo' ? phone.replace(/[^\d+]/g, '') : null,
        p_rail: tab === 'momo' ? rail : null,
        p_asset: tab === 'crypto' ? asset : null,
        p_address: tab === 'crypto' ? address.trim() : null,
      })
      if (rpcErr) throw new Error(rpcErr.message)

      // 2. move the money. Mobile money goes through our server route, which
      //    holds the DGateway key; crypto stays on the ProxiCash desk.
      let res: { message?: string; reference?: string }
      if (tab === 'momo') {
        res = await disburse({
          amount: Math.round(ugx),
          currency: 'UGX',
          phone: phone.trim(),
          description: `FloatBet payout ${String(data).slice(0, 8)}`,
          cashoutId: String(data),
        })
        setReference(res.reference ?? null)
      } else {
        res = { message: 'Crypto payout recorded. Send the exact amount to be contacted by the ProxiCash desk.' }
      }

      // 3. remember the phone for next time
      if (tab === 'momo' && !profile?.phone) void updateProfile({ phone })
      await refreshWallet()
      await loadedRows()
      sfx.win()
      setNotice(res.message || 'Payout submitted.')
    } catch (e) {
      setError((e as Error).message)
      await refreshWallet()
      await loadedRows()
    } finally {
      setBusy(false)
    }
  }

  const gated = !profile?.age_confirmed || !profile?.phone_verified

  return (
    <div className="mx-auto w-full max-w-[900px] px-3 pb-24 pt-4 sm:px-5">
      <div className="mb-3 flex items-center gap-2.5">
        <button type="button" onClick={onBack} className="grid h-9 w-9 place-items-center rounded-xl border border-white/[0.07] bg-white/[0.03] text-slate-300 hover:bg-white/10">
          <IconChevronLeft size={17} />
        </button>
        <div>
          <h1 className="text-[17px] font-bold text-white">Cash out</h1>
          <p className="text-[10.5px] text-slate-500">PX converts to UGX or crypto only through ProxiCash</p>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-[1fr_340px]">
        <div className="panel p-3.5">
          {/* balance */}
          <div className="mb-3 rounded-xl border border-neon-lime/25 bg-neon-lime/[0.07] px-3 py-2.5">
            <p className="text-[9.5px] font-bold uppercase tracking-[.16em] text-slate-500">Available to cash out</p>
            <p className="num text-[22px] font-black leading-tight text-white">{money(balance)} PX</p>
            <p className="text-[11px] text-neon-lime">≈ {money(pxToUgx(balance))} UGX at 10 PX / UGX</p>
          </div>

          {gated && (
            <div className="mb-3 rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2.5 text-[11.5px] text-amber-200">
              {!profile?.age_confirmed
                ? 'Confirm you are 18 or older before cashing out.'
                : 'Verify your phone number in Settings before cashing out.'}
            </div>
          )}

          {/* rails */}
          <div className="mb-3 grid grid-cols-2 gap-1.5">
            {(['momo', 'crypto'] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => { setTab(k); setError(null); sfx.click() }}
                className={`rounded-xl border px-3 py-2.5 text-left transition ${
                  tab === k ? 'border-neon-lime bg-neon-lime/10' : 'border-white/10 bg-white/[0.02] hover:border-white/20'
                }`}
              >
                <p className={`text-[12.5px] font-bold ${tab === k ? 'text-neon-lime' : 'text-white'}`}>
                  {k === 'momo' ? 'Mobile money' : 'Crypto'}
                </p>
                <p className="text-[10px] text-slate-500">
                  {k === 'momo' ? 'MTN MoMo / Airtel Money' : 'USDT, USDC or BTC'}
                </p>
              </button>
            ))}
          </div>

          {/* amount */}
          <label className="label" htmlFor="amt">Amount</label>
          <div className="mb-1 flex items-stretch gap-1.5">
            <input
              id="amt"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(Math.max(0, Math.round(Number(e.target.value.replace(/[^0-9]/g, '')) || 0)))}
              className="field num flex-1 !text-[16px] font-bold"
            />
            <button type="button" onClick={setMax} className="btn-ghost shrink-0 !px-3 !text-[11px]">Max</button>
          </div>
          <div className="mb-3 flex items-center justify-between text-[10.5px]">
            <span className="text-slate-500">You receive</span>
            <span className="num font-bold text-white">≈ {money(ugx)} UGX</span>
          </div>

          {tab === 'momo' ? (
            <>
              <label className="label" htmlFor="tel">Mobile money number</label>
              <input
                id="tel"
                inputMode="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="07XX XXX XXX"
                className="field mb-1"
              />
              <p className="mb-3 text-[10px] text-slate-500">
                {rail ? `Detected ${rail} Uganda` : 'Must be an MTN (077/078/076/039) or Airtel (070/075/074) number.'}
              </p>
            </>
          ) : (
            <>
              <label className="label">Receive asset</label>
              <div className="mb-2 flex gap-1">
                {CRYPTO.map((a) => (
                  <button
                    key={a}
                    type="button"
                    onClick={() => setAsset(a)}
                    className={`num flex-1 rounded-lg border px-2 py-1.5 text-[11.5px] font-bold transition ${
                      asset === a ? 'border-neon-cyan bg-neon-cyan/15 text-neon-cyan' : 'border-white/10 bg-white/[0.02] text-slate-400'
                    }`}
                  >
                    {a}
                  </button>
                ))}
              </div>
              <label className="label" htmlFor="addr">Your {asset} wallet address</label>
              <input
                id="addr"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder={`${asset} address`}
                className="field mb-3 num !text-[12px]"
              />
            </>
          )}

          {error && (
            <div className="mb-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 py-2 text-[11.5px] text-rose-200">{error}</div>
          )}
          {poll.state === 'pending' && (
            <div className="mb-2 rounded-lg border border-neon-cyan/30 bg-neon-cyan/10 px-2.5 py-2 text-[11.5px] text-neon-cyan">
              Check your phone and approve the prompt
            </div>
          )}
          {poll.state === 'completed' && (
            <div className="mb-2 flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-2 text-[11.5px] text-emerald-200">
              <IconCheck size={12} /> Payout sent
            </div>
          )}
          {poll.state === 'failed' && (
            <div className="mb-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 py-2 text-[11.5px] text-rose-200">
              Payout failed — the PX has been returned to your balance.
            </div>
          )}
          {notice && (
            <div className="mb-2 flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-2 text-[11.5px] text-emerald-200">
              <IconCheck size={12} /> {notice}
            </div>
          )}

          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy || gated || amount < MIN_PX || amount > balance}
            className="btn-primary w-full !py-3 !text-[13px]"
          >
            {busy ? 'Submitting…' : `Cash out ${money(ugx)} UGX`}
          </button>

          <p className="mt-2 flex items-start gap-1.5 text-[9.5px] leading-relaxed text-slate-600">
            <IconShield size={11} className="mt-0.5 shrink-0 text-emerald-500" />
            Payouts are checked before release. A rejected payout returns the PX to your balance.
            Minimum {money(MIN_PX)} PX.
          </p>
        </div>

        {/* history */}
        <div className="panel p-3.5">
          <h3 className="mb-2 text-[11px] font-bold uppercase tracking-[.14em] text-slate-400">Your cashouts</h3>
          {rows.length === 0 ? (
            <p className="py-6 text-center text-[11.5px] text-slate-600">No cashouts yet.</p>
          ) : (
            <div className="space-y-1.5">
              {rows.map((r) => (
                <div key={r.id} className="rounded-lg border border-white/[0.07] bg-white/[0.02] px-2.5 py-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11.5px] font-bold text-white">
                      {money(r.ugx)} UGX
                    </span>
                    <span className={`text-[10px] font-bold uppercase ${STATUS_TONE[r.status] ?? 'text-slate-400'}`}>
                      {r.status.replace('_', ' ')}
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-500">
                    {r.kind === 'momo' ? `${r.phone ?? ''}` : `${r.asset} payout`} · {money(r.amount_px)} PX ·{' '}
                    {new Date(r.created_at).toLocaleDateString()}
                  </p>
                  {r.failure_reason && <p className="text-[9.5px] text-rose-300">{r.failure_reason}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
