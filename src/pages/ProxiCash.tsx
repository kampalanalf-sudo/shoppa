import React, { useMemo, useState } from 'react'
import { useStore } from '../lib/store'
import { sfx } from '../lib/sound'
import { money, mult } from '../lib/format'
import {
  ASSETS, ASSET_IDS, RAIL_FEE, STATUS_LABEL,
  quote, quoteForPayout, newOrder, validPhone, railForPhone, normalisePhone,
  type AssetId, type ExchangeOrder, type Rail,
} from '../lib/proxicash'
import {
  IconArrowUpRight, IconCheck, IconChevronLeft, IconCopy, IconShield,
  IconBolt, IconWallet, IconHistory, IconInfo,
} from '../components/Icons'

type Props = { onBack: () => void }

const RAIL_STYLE: Record<Rail, { bg: string; label: string }> = {
  MTN: { bg: 'linear-gradient(135deg,#ffcc00,#f5a623)', label: 'MTN MoMo' },
  Airtel: { bg: 'linear-gradient(135deg,#ff3b30,#c1121f)', label: 'Airtel Money' },
}

function AssetBadge({ id, size = 34 }: { id: AssetId; size?: number }) {
  const a = ASSETS[id]
  return (
    <span
      className="grid shrink-0 place-items-center rounded-full font-black text-ink-950"
      style={{ width: size, height: size, background: a.color, fontSize: size * 0.34 }}
    >
      {id.slice(0, 1)}
    </span>
  )
}

export function ProxiCash({ onBack }: Props) {
  const { balance, exchanges, recordExchange, settleExchange, toast } = useStore()

  const [direction, setDirection] = useState<'in' | 'out'>('out')
  const [asset, setAsset] = useState<AssetId>('USDT')
  const [send, setSend] = useState<string>('50')
  const [phone, setPhone] = useState<string>('')
  const [pending, setPending] = useState<ExchangeOrder | null>(null)
  const [tab, setTab] = useState<'exchange' | 'orders'>('exchange')

  const sendNum = parseFloat(send.replace(/[^0-9.]/g, '')) || 0
  const q = useMemo(() => quote(asset, sendNum), [asset, sendNum])
  const rail = railForPhone(phone)
  const phoneOk = validPhone(phone)
  const a = ASSETS[asset]

  const canSubmit = phoneOk && !q.tooSmall && sendNum > 0

  const submit = () => {
    if (!canSubmit || !rail) {
      sfx.lose()
      toast({
        kind: 'error',
        title: !phoneOk ? 'Invalid mobile money number' : q.tooSmall ? 'Amount below minimum' : 'Check the details',
        body: !phoneOk ? 'Use a Ugandan number, e.g. 0772 123 456.' : `Minimum is ${a.min} ${asset}.`,
      })
      return
    }
    const order = newOrder(asset, sendNum, phone, rail)
    recordExchange(order)
    setPending(order)
    sfx.win()
  }

  return (
    <div className="mx-auto w-full max-w-[1180px] px-3 pb-28 pt-4 sm:px-5 md:pb-12">
      {/* header */}
      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        <button
          type="button"
          onClick={onBack}
          className="grid h-9 w-9 place-items-center rounded-xl border border-white/[0.07] bg-white/[0.03] text-slate-300 transition hover:bg-white/10 hover:text-white"
          aria-label="Back"
        >
          <IconChevronLeft size={17} />
        </button>
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br from-[#26a17b] to-[#0f6b4f] text-[13px] font-black text-white">P</span>
          <div>
            <h1 className="text-[15px] font-bold leading-tight text-white sm:text-[17px]">ProxiCash</h1>
            <p className="text-[10.5px] text-slate-500">Crypto → Mobile Money · Uganda</p>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <span className="chip"><IconShield size={11} className="text-emerald-400" /> Instant payout</span>
          <span className="chip hidden sm:inline-flex"><IconBolt size={11} className="text-gold" /> ~2 min</span>
        </div>
      </div>

      {/* balance strip */}
      <div className="mb-3 grid gap-2 sm:grid-cols-3">
        {[
          { l: 'UGX balance', v: `UGX ${money(balance)}`, c: 'text-neon-lime' },
          { l: 'Payout fee', v: `${(RAIL_FEE * 100).toFixed(1)}%`, c: 'text-white' },
          { l: 'Networks', v: '5 assets', c: 'text-white' },
        ].map((s) => (
          <div key={s.l} className="panel px-3 py-2.5">
            <p className="text-[9px] uppercase tracking-[.14em] text-slate-500">{s.l}</p>
            <p className={`num text-[15px] font-black ${s.c}`}>{s.v}</p>
          </div>
        ))}
      </div>

      {/* tabs */}
      <div className="mb-3 flex gap-1 rounded-xl bg-ink-900/80 p-1">
        {([['exchange', 'Exchange'], ['orders', `Orders (${exchanges.length})`]] as const).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => { setTab(k); sfx.click() }}
            className={`flex-1 rounded-lg py-2 text-[12px] font-bold transition ${tab === k ? 'bg-white/[0.09] text-white' : 'text-slate-400 hover:text-white'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'exchange' ? (
        <div className="grid gap-3 lg:grid-cols-[1fr_360px]">
          {/* ---------- form ---------- */}
          <div className="panel p-4">
            {/* direction */}
            <div className="mb-3 grid grid-cols-2 gap-1 rounded-xl bg-ink-900/80 p-1">
              {([['out', 'Crypto → MoMo'], ['in', 'Top up']] as const).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => { setDirection(k); sfx.click() }}
                  className={`rounded-lg py-2 text-[11.5px] font-bold transition ${direction === k ? 'bg-neon-lime text-ink-950' : 'text-slate-400 hover:text-white'}`}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* asset picker */}
            <span className="label"><span>You send</span></span>
            <div className="mb-2 grid grid-cols-5 gap-1.5">
              {ASSET_IDS.map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => { setAsset(id); sfx.click() }}
                  className={`flex flex-col items-center gap-1 rounded-xl border py-2 transition ${
                    asset === id ? 'border-neon-lime/60 bg-neon-lime/10' : 'border-white/[0.07] bg-white/[0.02] hover:border-white/20'
                  }`}
                >
                  <AssetBadge id={id} size={24} />
                  <span className="text-[9.5px] font-bold text-slate-300">{id}</span>
                </button>
              ))}
            </div>

            {/* amount */}
            <div className="relative">
              <input
                inputMode="decimal"
                value={send}
                onChange={(e) => setSend(e.target.value.replace(/[^0-9.]/g, ''))}
                className="field num !pr-24 !text-lg !font-bold"
                aria-label={`Amount in ${asset}`}
                placeholder="0"
              />
              <button
                type="button"
                onClick={() => {
                  if (asset === 'USDT') setSend(String(Math.floor(balance / ASSETS.USDT.ugxRate)))
                  else setSend(String(Math.round(q.net / a.ugxRate)))
                  sfx.click()
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md bg-neon-lime/15 px-2 py-1 text-[10px] font-black uppercase tracking-wide text-neon-lime"
              >
                Max
              </button>
            </div>
            <p className="mt-1 text-[10.5px] text-slate-500">
              Min {a.min} {asset} · 1 {asset} ≈ UGX {money(a.ugxRate)}
            </p>

            {/* phone */}
            <span className="label mt-3"><span>Mobile money number</span></span>
            <div className="relative">
              <input
                inputMode="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="0772 123 456"
                className={`field num !pl-14 ${phone && !phoneOk ? '!border-rose-500/60' : ''}`}
                aria-label="Mobile money number"
              />
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[11px] font-bold text-slate-500">🇺🇬 +256</span>
              {rail && (
                <span
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md px-1.5 py-0.5 text-[9px] font-black text-ink-950"
                  style={{ background: RAIL_STYLE[rail].bg }}
                >
                  {rail}
                </span>
              )}
            </div>
            <p className="mt-1 text-[10.5px] text-slate-500">
              {phone && !phoneOk ? 'Enter a valid Ugandan number (07XXXXXXXX).' : rail ? `${RAIL_STYLE[rail].label} detected` : 'MTN or Airtel — detected automatically'}
            </p>

            <button
              type="button"
              disabled={!canSubmit}
              onClick={submit}
              className="btn-primary mt-3 w-full !py-3"
            >
              {direction === 'in' ? 'Fund in UGX' : `Send & receive UGX ${money(q.net)}`}
              <IconArrowUpRight size={15} />
            </button>
            <p className="mt-2 text-center text-[10px] text-slate-600">
              Cashout via ProxiCash · rates are reference rates · 18+
            </p>
          </div>

          {/* ---------- quote summary ---------- */}
          <div className="panel h-fit p-4">
            <p className="mb-3 text-[11px] font-bold uppercase tracking-[.14em] text-slate-400">You receive</p>
            <p className="num text-[30px] font-black leading-none text-white">
              UGX {money(q.net)}
            </p>
            <p className="mt-1 text-[11px] text-slate-500">
              {rail ? `to ${rail === 'MTN' ? 'MTN MoMo' : 'Airtel Money'} · ${normalisePhone(phone) ?? phone}` : 'enter a number to see the payout'}
            </p>

            <div className="mt-4 space-y-1.5">
              {[
                ['Amount', `${sendNum || 0} ${asset}`],
                ['Rate', `UGX ${money(a.ugxRate)} / ${asset}`],
                ['Subtotal', `UGX ${money(q.gross)}`],
                ['Network fee', `− UGX ${money(q.networkFeeUgx)}`],
                [`Payout fee (${(RAIL_FEE * 100).toFixed(0)}%)`, `− UGX ${money(q.payoutFeeUgx)}`],
              ].map(([l, v]) => (
                <div key={l} className="flex items-center justify-between text-[11.5px]">
                  <span className="text-slate-500">{l}</span>
                  <span className="num font-semibold text-slate-200">{v}</span>
                </div>
              ))}
              <div className="divider !my-2" />
              <div className="flex items-center justify-between">
                <span className="text-[12px] font-bold text-white">You receive</span>
                <span className="num text-[13px] font-black text-neon-lime">UGX {money(q.net)}</span>
              </div>
            </div>

            <div className="mt-4 rounded-xl border border-white/[0.06] bg-white/[0.02] p-2.5">
              <p className="flex items-center gap-1.5 text-[10.5px] font-bold text-slate-300">
                <IconInfo size={12} className="text-neon-cyan" /> How it works
              </p>
              <ol className="mt-1.5 space-y-1 text-[10.5px] leading-relaxed text-slate-500">
                <li>1. Choose an asset and enter how much to send.</li>
                <li>2. Send to the deposit address ProxiCash gives you.</li>
                <li>3. We confirm on-chain and pay UGX to your wallet.</li>
              </ol>
            </div>
          </div>
        </div>
      ) : (
        <div className="panel overflow-hidden">
          <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
            <h2 className="flex items-center gap-2 text-[13px] font-bold text-white">
              <IconHistory size={14} className="text-neon-lime" /> Your exchanges
            </h2>
          </div>
          {exchanges.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <IconWallet size={26} className="mx-auto text-slate-700" />
              <p className="mt-2 text-[12px] font-bold text-slate-400">No exchanges yet</p>
              <p className="mt-0.5 text-[11px] text-slate-600">Create one from the Exchange tab.</p>
            </div>
          ) : (
            <div className="divide-y divide-white/[0.05]">
              {exchanges.map((o) => (
                <div key={o.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <AssetBadge id={o.asset} size={30} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px] font-bold text-white">
                      {o.send} {o.asset} → UGX {money(o.net)}
                    </p>
                    <p className="truncate text-[10.5px] text-slate-500">
                      {o.id} · {o.rail} · {o.phone}
                    </p>
                  </div>
                  <span className={`rounded-md px-2 py-0.5 text-[9.5px] font-black uppercase tracking-wide ${
                    o.status === 'paid' ? 'bg-neon-lime/15 text-neon-lime' : 'bg-gold/15 text-gold'
                  }`}>
                    {STATUS_LABEL[o.status]}
                  </span>
                  {o.status !== 'paid' && (
                    <button
                      type="button"
                      onClick={() => settleExchange(o.id)}
                      className="btn-ghost !px-2.5 !py-1 !text-[10.5px]"
                    >
                      <IconCheck size={11} /> Confirm
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
