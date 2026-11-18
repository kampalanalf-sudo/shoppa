import React, { useEffect, useMemo, useState } from 'react'
import { useStore } from '../lib/store'
import { money, mult, shortHash, timeAgo, pct } from '../lib/format'
import { GAMES } from '../lib/games'
import {
  IconBolt, IconCheck, IconClose, IconCopy, IconExternal, IconGift, IconInfo, IconShield, IconTrophy, IconWallet,
} from './Icons'
import { CopyField, BetFeed } from './Chrome'
import { sfx } from '../lib/sound'
import { crashPoint, diceRoll, floats, limboPoint } from '../lib/fair'

function Sheet({
  open, onClose, title, subtitle, icon, children, width = 'max-w-lg',
}: {
  open: boolean
  onClose: () => void
  title: string
  subtitle?: string
  icon?: React.ReactNode
  children: React.ReactNode
  width?: string
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-[70] grid place-items-center p-3 sm:p-6" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/75 backdrop-blur-sm" onClick={onClose} />
      <div className={`relative w-full ${width} max-h-[92vh] animate-popIn overflow-y-auto rounded-2xl border border-white/[0.09] bg-ink-850 shadow-pop`}>
        <div className="sticky top-0 z-10 flex items-start gap-3 border-b border-white/[0.07] bg-ink-850/95 px-5 py-4 backdrop-blur-xl">
          {icon && <div className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-neon-lime/10 text-neon-lime">{icon}</div>}
          <div className="min-w-0 flex-1">
            <h3 className="text-[15px] font-bold text-white">{title}</h3>
            {subtitle && <p className="text-[11.5px] text-slate-500">{subtitle}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 transition hover:bg-white/5 hover:text-white">
            <IconClose size={16} />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ Wallet */

const COINS = [
  { s: 'BTC', name: 'Bitcoin', net: 'Bitcoin', rate: 1 / 64000, color: '#f7931a' },
  { s: 'ETH', name: 'Ethereum', net: 'ERC-20', rate: 1 / 3200, color: '#8c8cf9' },
  { s: 'USDT', name: 'Tether', net: 'TRC-20', rate: 1, color: '#26a17b' },
  { s: 'TRX', name: 'Tron', net: 'Tron', rate: 8.4, color: '#ff060a' },
  { s: 'SOL', name: 'Solana', net: 'Solana', rate: 1 / 165, color: '#14f195' },
  { s: 'LTC', name: 'Litecoin', net: 'Litecoin', rate: 1 / 78, color: '#bfbbbb' },
]

export function WalletModal({ forceOpen }: { forceOpen?: boolean } = {}) {
  const { walletOpen, setWalletOpen, balance, deposit, withdraw, totalDeposited, stats, toast, resetAccount, username, setUsername } = useStore()
  const [tab, setTab] = useState<'deposit' | 'withdraw' | 'account'>('deposit')
  const [coin, setCoin] = useState('USDT')
  const [amount, setAmount] = useState('100')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<null | { kind: 'deposit' | 'withdraw'; amt: number }>(null)

  const coinMeta = COINS.find((c) => c.s === coin)!
  const amt = parseFloat(amount) || 0

  const submit = () => {
    if (!(amt > 0)) {
      toast({ kind: 'error', title: 'Enter an amount', body: 'Amount must be greater than zero.' })
      return
    }
    if (tab === 'withdraw' && amt > balance) {
      toast({ kind: 'error', title: 'Insufficient balance', body: 'Reduce the amount and try again.' })
      return
    }
    setBusy(true)
    window.setTimeout(() => {
      setBusy(false)
      if (tab === 'deposit') {
        deposit(amt)
        sfx.deposit()
        setDone({ kind: 'deposit', amt })
      } else {
        if (withdraw(amt)) {
          sfx.cashout()
          setDone({ kind: 'withdraw', amt })
        }
      }
    }, 900)
  }

  const activeTabBtn = (t: typeof tab, label: string) => (
    <button
      type="button"
      onClick={() => { setTab(t); setDone(null); sfx.click() }}
      className={`flex-1 rounded-lg py-2 text-[12.5px] font-bold transition ${
        tab === t ? 'bg-white/[0.09] text-white shadow-sm' : 'text-slate-400 hover:text-white'
      }`}
    >
      {label}
    </button>
  )

  return (
    <Sheet
      open={forceOpen ?? walletOpen}
      onClose={() => { setWalletOpen(false); setDone(null) }}
      title="Wallet"
      subtitle={`Balance ${money(balance)} PX · ${username}`}
      icon={<IconWallet size={18} />}
    >
      <div className="mb-4 overflow-hidden rounded-2xl border border-neon-lime/20 bg-gradient-to-br from-neon-lime/[0.12] via-ink-800 to-ink-850 p-4">
        <p className="text-[10.5px] font-bold uppercase tracking-[.18em] text-neon-lime/70">Available balance</p>
        <div className="mt-1 flex items-end gap-2">
          <span className="num text-3xl font-black text-white">{money(balance)}</span>
          <span className="mb-1 text-[12px] font-bold text-slate-400">PX</span>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          {[
            { l: 'Deposited', v: money(totalDeposited) },
            { l: 'Profit', v: `${stats.profit >= 0 ? '+' : ''}${money(stats.profit)}` },
            { l: 'Rounds', v: String(stats.rounds) },
          ].map((x) => (
            <div key={x.l} className="rounded-lg bg-black/25 px-2 py-1.5">
              <p className="text-[9.5px] uppercase tracking-wider text-slate-500">{x.l}</p>
              <p className="num text-[12px] font-bold text-slate-200">{x.v}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="mb-4 flex gap-1 rounded-xl border border-white/[0.07] bg-ink-900/70 p-1">
        {activeTabBtn('deposit', 'Deposit')}
        {activeTabBtn('withdraw', 'Withdraw')}
        {activeTabBtn('account', 'Account')}
      </div>

      {done ? (
        <div className="py-4 text-center">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-emerald-500/15 text-emerald-400">
            <IconCheck size={26} />
          </div>
          <p className="mt-3 text-[15px] font-bold text-white">
            {done.kind === 'deposit' ? 'Deposit confirmed' : 'Withdrawal sent'}
          </p>
          <p className="num mt-1 text-[13px] text-slate-400">{money(done.amt)} PX {done.kind === 'deposit' ? 'credited' : 'on the way'}</p>
          <p className="mt-1 text-[11px] text-slate-500">Payouts settle to mobile money via ProxiCash.</p>
          <div className="mt-4 flex gap-2">
            <button type="button" onClick={() => setDone(null)} className="btn-ghost flex-1">New transaction</button>
            <button type="button" onClick={() => { setWalletOpen(false); setDone(null) }} className="btn-primary flex-1">Back to games</button>
          </div>
        </div>
      ) : tab === 'account' ? (
        <div className="space-y-4">
          <div>
            <label className="label" htmlFor="uname">Display name</label>
            <div className="flex gap-2">
              <input id="uname" className="field" value={username} onChange={(e) => setUsername(e.target.value)} maxLength={18} />
            </div>
          </div>
          <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[12.5px] font-bold text-white">VIP Platinum</p>
                <p className="text-[11px] text-slate-500">Level 24 · 76% to Diamond</p>
              </div>
              <span className="chip !border-gold/30 !text-gold">VIP</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
              <div className="h-full w-[76%] rounded-full bg-gradient-to-r from-neon-lime to-gold" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="panel-tight p-3">
              <p className="text-[10px] uppercase tracking-wider text-slate-500">Wagered</p>
              <p className="num text-[15px] font-bold text-white">{money(stats.wagered)}</p>
            </div>
            <div className="panel-tight p-3">
              <p className="text-[10px] uppercase tracking-wider text-slate-500">Biggest win</p>
              <p className="num text-[15px] font-bold text-neon-lime">{money(stats.biggestWin)}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => { resetAccount(); setDone(null) }}
            className="btn-ghost w-full !border-rose-500/25 !text-rose-300 hover:!bg-rose-500/10"
          >
            Reset local stats
          </button>
        </div>
      ) : (
        <div className="space-y-3.5">
          <div>
            <span className="label">Currency</span>
            <div className="grid grid-cols-3 gap-1.5">
              {COINS.map((c) => (
                <button
                  key={c.s}
                  type="button"
                  onClick={() => { setCoin(c.s); sfx.click() }}
                  className={`flex items-center gap-1.5 rounded-lg border px-2 py-2 transition ${
                    coin === c.s ? 'border-neon-lime/50 bg-neon-lime/10' : 'border-white/[0.07] bg-white/[0.025] hover:border-white/20'
                  }`}
                >
                  <span className="h-2 w-2 rounded-full" style={{ background: c.color }} />
                  <span className="text-[11.5px] font-bold text-white">{c.s}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="label" htmlFor="amt">
              <span>Amount (PX)</span>
              <span className="normal-case tracking-normal text-slate-500">
                ≈ {money(amt * coinMeta.rate)} {coinMeta.s}
              </span>
            </label>
            <div className="relative">
              <input
                id="amt"
                inputMode="decimal"
                className="field num !pr-16 !text-lg !font-bold"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-bold text-neon-lime/70">PX</span>
            </div>
            <div className="mt-1.5 flex gap-1.5">
              {[50, 100, 500, 1000].map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => { setAmount(String(v)); sfx.click() }}
                  className="flex-1 rounded-lg border border-white/[0.07] bg-white/[0.03] py-1 text-[11px] font-bold text-slate-300 transition hover:border-neon-lime/40 hover:text-white"
                >
                  {v}
                </button>
              ))}
              {tab === 'withdraw' && (
                <button
                  type="button"
                  onClick={() => setAmount(String(Math.floor(balance)))}
                  className="flex-1 rounded-lg border border-neon-lime/30 bg-neon-lime/10 py-1 text-[11px] font-bold text-neon-lime"
                >
                  Max
                </button>
              )}
            </div>
          </div>

          {tab === 'deposit' ? (
            <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">Send {coinMeta.s} to</p>
              <CopyField label={`${coinMeta.s} · ${coinMeta.net}`} value="TQ8vN5kRfLz9m2yB7xJcWq4pAhD1sEuG3K" />
              <p className="mt-2 flex items-center gap-1.5 text-[10.5px] text-slate-500">
                <IconInfo size={12} /> Top up with mobile money or crypto. PX can be cashed out via ProxiCash.
              </p>
            </div>
          ) : (
            <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">Withdraw to {coinMeta.s}</p>
              <input className="field !text-[12px]" placeholder={`${coinMeta.s} address`} defaultValue="0x7f9A2c4B15eD8a3Ff61b0C9e2D4a5B6c7D8e9F01" readOnly />
              <p className="mt-2 flex items-center gap-1.5 text-[10.5px] text-emerald-400/80">
                <IconCheck size={12} /> Zero-fee instant withdrawals · avg 42s
              </p>
            </div>
          )}

          <button type="button" onClick={submit} disabled={busy} className="btn-primary h-12 w-full text-[14px]">
            {busy ? (
              <span className="flex items-center gap-2">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-ink-950/30 border-t-ink-950" /> Processing…
              </span>
            ) : tab === 'deposit' ? (
              <>Deposit {money(amt)} PX <IconBolt size={15} /></>
            ) : (
              <>Withdraw {money(amt)} PX <IconExternal size={14} /></>
            )}
          </button>
          <p className="text-center text-[10px] text-slate-600">
            By continuing you agree to the FloatBet Terms. 18+ · Play responsibly.
          </p>
        </div>
      )}
    </Sheet>
  )
}

/* ------------------------------------------------------------------ Provably fair */

export function FairModal({ forceOpen }: { forceOpen?: boolean } = {}) {
  const { fairOpen, setFairOpen, seeds, clientSeed, updateClientSeed, rotateSeed, bets, toast } = useStore()
  const [seedInput, setSeedInput] = useState(clientSeed)
  const [verifyNonce, setVerifyNonce] = useState('1')

  useEffect(() => setSeedInput(clientSeed), [clientSeed, fairOpen])

  return (
    <Sheet
      open={forceOpen ?? fairOpen}
      onClose={() => setFairOpen(false)}
      title="Provably Fair"
      subtitle="Every outcome is verifiable with HMAC-SHA256"
      icon={<IconShield size={18} />}
      width="max-w-xl"
    >
      <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.07] px-3 py-2.5">
        <IconCheck size={15} className="mt-0.5 shrink-0 text-emerald-400" />
        <p className="text-[11.5px] leading-relaxed text-emerald-100/70">
          Your server seed was hashed and committed <b>before</b> any bet. Rotating reveals the previous seed so you can
          re-run the maths on any past round.
        </p>
      </div>

      <div className="space-y-3">
        <CopyField label="Server seed hash (commitment)" value={seeds.serverSeedHash} masked />
        <CopyField label="Server seed (revealed on rotate)" value={seeds.serverSeed} masked />
        {seeds.prevServerSeed && <CopyField label="Previous server seed" value={seeds.prevServerSeed} masked />}

        <div>
          <label className="label" htmlFor="clientseed">
            <span>Client seed</span>
            <span className="normal-case tracking-normal text-slate-500">editable</span>
          </label>
          <div className="flex gap-2">
            <input id="clientseed" className="field num !text-[12px]" value={seedInput} onChange={(e) => setSeedInput(e.target.value)} />
            <button
              type="button"
              onClick={() => { updateClientSeed(seedInput); toast({ kind: 'success', title: 'Client seed updated', body: 'Nonce reset to 0.' }) }}
              className="btn-dark shrink-0"
            >
              Save
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="panel-tight p-3">
            <p className="text-[10px] uppercase tracking-wider text-slate-500">Nonce</p>
            <p className="num text-[15px] font-bold text-white">{seeds.nonce}</p>
          </div>
          <button type="button" onClick={() => void rotateSeed()} className="btn-ghost !border-neon-lime/30 !text-neon-lime">
            Rotate & reveal
          </button>
        </div>

        <div className="divider" />

        <VerifyPanel
          defaultServerSeed={seeds.prevServerSeed ?? seeds.serverSeed}
          defaultClientSeed={clientSeed || seeds.clientSeed}
          onVerifyed={() => {}}
        />

        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[11px] font-bold uppercase tracking-[.14em] text-slate-400">Recent rounds</p>
            {bets[0] && (
              <button
                type="button"
                onClick={() => {
                  setSeedInput(bets[0].clientSeed ?? clientSeed)
                  setVerifyNonce(String(bets[0].nonce ?? 1))
                }}
                className="text-[10px] font-semibold text-neon-lime hover:underline"
              >
                Verify latest
              </button>
            )}
          </div>
          <div className="max-h-44 overflow-y-auto rounded-xl border border-white/[0.07]">
            {bets.length ? (
              <table className="w-full text-left text-[11px]">
                <thead className="sticky top-0 bg-ink-800 text-[9.5px] uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-2.5 py-1.5">Game</th>
                    <th className="px-1 py-1.5">Nonce</th>
                    <th className="px-1 py-1.5">Mult</th>
                    <th className="px-1 py-1.5">Bet</th>
                    <th className="px-2.5 py-1.5 text-right">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {bets.slice(0, 20).map((b) => (
                    <tr key={b.id} className="border-t border-white/[0.04]">
                      <td className="px-2.5 py-1.5 text-slate-300">{b.gameName}</td>
                      <td className="num px-1 py-1.5 text-slate-500">{b.nonce ?? '—'}</td>
                      <td className={`num px-1 py-1.5 ${b.won ? 'text-neon-lime' : 'text-slate-500'}`}>{mult(b.multiplier)}</td>
                      <td className="num px-1 py-1.5 text-slate-400">{money(b.wager)}</td>
                      <td className="px-2.5 py-1.5 text-right text-slate-500">{timeAgo(b.ts)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="px-3 py-4 text-center text-[11.5px] text-slate-500">No rounds yet — place a bet to start.</p>
            )}
          </div>
        </div>
      </div>
    </Sheet>
  )
}


/* ------------------------------------------------------------------ Rewards hub */

const REWARDS = [
  { id: 'daily', title: 'Daily login', desc: 'Streak day 3 of 7', amount: 250, icon: '📅', ready: true },
  { id: 'rakeback', title: 'Rakeback', desc: '2.4% of your last 24h volume', amount: 640, icon: '♻️', ready: true },
  { id: 'race', title: 'Weekly race', desc: 'Rank #48 · pool 5,000,000 PX', amount: 1200, icon: '🏁', ready: true },
  { id: 'vip', title: 'VIP airdrop', desc: 'Platinum tier · unlocks Friday', amount: 5000, icon: '💎', ready: false },
]

export function RewardsModal({ forceOpen }: { forceOpen?: boolean } = {}) {
  const { rewardsOpen, setRewardsOpen, deposit, stats, toast } = useStore()
  const [claimed, setClaimed] = useState<string[]>([])

  const totalReady = REWARDS.filter((r) => r.ready && !claimed.includes(r.id)).reduce((a, r) => a + r.amount, 0)

  return (
    <Sheet
      open={forceOpen ?? rewardsOpen}
      onClose={() => setRewardsOpen(false)}
      title="Rewards hub"
      subtitle={`${money(totalReady)} PX ready to collect`}
      icon={<IconGift size={18} />}
    >
      <div className="relative mb-4 overflow-hidden rounded-2xl border border-gold/25 bg-gradient-to-br from-gold/15 via-ink-800 to-ink-850 p-4">
        <div className="pointer-events-none absolute -right-6 -top-8 h-28 w-28 rounded-full bg-gold/20 blur-2xl" />
        <p className="text-[10px] font-bold uppercase tracking-[.2em] text-gold/80">Available now</p>
        <p className="num mt-1 text-3xl font-black text-white">{money(totalReady)} <span className="text-[13px] font-bold text-slate-400">PX</span></p>
        <button
          type="button"
          disabled={totalReady === 0}
          onClick={() => {
            deposit(totalReady)
            setClaimed(REWARDS.filter((r) => r.ready).map((r) => r.id))
            sfx.deposit()
            toast({ kind: 'success', title: 'Rewards collected', body: `${money(totalReady)} PX credited.` })
          }}
          className="btn-primary mt-3 h-10 w-full !text-[12.5px]"
        >
          {totalReady === 0 ? <><IconCheck size={15} /> All collected</> : <><IconGift size={15} /> Collect all</>}
        </button>
      </div>

      <div className="space-y-2">
        {REWARDS.map((r) => {
          const done = claimed.includes(r.id) || !r.ready
          return (
            <div key={r.id} className={`flex items-center gap-3 rounded-xl border p-3 ${done ? 'border-white/[0.05] bg-white/[0.015]' : 'border-white/[0.08] bg-white/[0.03]'}`}>
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/[0.05] text-[16px]">{r.icon}</span>
              <div className="min-w-0 flex-1">
                <p className={`text-[12.5px] font-bold ${done ? 'text-slate-400' : 'text-white'}`}>{r.title}</p>
                <p className="truncate text-[10.5px] text-slate-500">{r.desc}</p>
              </div>
              <button
                type="button"
                disabled={done}
                onClick={() => {
                  deposit(r.amount)
                  setClaimed((c) => [...c, r.id])
                  sfx.deposit()
                  toast({ kind: 'success', title: `${r.title} claimed`, body: `+${money(r.amount)} PX` })
                }}
                className={`num shrink-0 rounded-lg px-2.5 py-1.5 text-[11px] font-bold transition ${
                  done ? 'bg-white/[0.04] text-slate-500' : 'bg-neon-lime/15 text-neon-lime hover:bg-neon-lime/25'
                }`}
              >
                {done ? (r.ready ? 'Claimed' : 'Locked') : `+${money(r.amount)}`}
              </button>
            </div>
          )
        })}
      </div>

      <div className="mt-4 rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-slate-500">30-day volume</span>
          <span className="num font-bold text-white">{money(stats.wagered)} PX</span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
          <div className="h-full rounded-full bg-gradient-to-r from-neon-lime to-gold" style={{ width: `${Math.min(100, (stats.wagered / 50000) * 100)}%` }} />
        </div>
        <p className="mt-1.5 text-[10px] text-slate-600">
          {stats.wagered >= 50000 ? 'Gold tier unlocked — 15% rakeback' : `Wager ${money(50000 - stats.wagered)} PX more to unlock Gold tier`}
        </p>
      </div>
    </Sheet>
  )
}

/* ------------------------------------------------------------------ Stats / history */

export function HistoryModal({ forceOpen }: { forceOpen?: boolean } = {}) {
  const { historyOpen, setHistoryOpen, stats, bets, username } = useStore()
  const winRate = stats.rounds ? stats.wins / stats.rounds : 0
  const byGame = useMemo(() => {
    const map = new Map<string, { wagered: number; payout: number; rounds: number }>()
    for (const b of bets) {
      const r = map.get(b.game) ?? { wagered: 0, payout: 0, rounds: 0 }
      r.wagered += b.wager
      r.payout += b.payout
      r.rounds += 1
      map.set(b.game, r)
    }
    return [...map.entries()].sort((a, b) => b[1].wagered - a[1].wagered).slice(0, 6)
  }, [bets])

  return (
    <Sheet
      open={forceOpen ?? historyOpen}
      onClose={() => setHistoryOpen(false)}
      title="Stats & leaderboard"
      subtitle={`${username} · ${stats.rounds} rounds played`}
      icon={<IconTrophy size={18} />}
      width="max-w-2xl"
    >
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { l: 'Wagered', v: money(stats.wagered), c: 'text-white' },
          { l: 'Net profit', v: `${stats.profit >= 0 ? '+' : ''}${money(stats.profit)}`, c: stats.profit >= 0 ? 'text-neon-lime' : 'text-rose-400' },
          { l: 'Win rate', v: pct(winRate), c: 'text-neon-cyan' },
          { l: 'Best streak', v: `${stats.bestStreak}×`, c: 'text-gold' },
        ].map((s) => (
          <div key={s.l} className="panel-tight p-3">
            <p className="text-[9.5px] uppercase tracking-wider text-slate-500">{s.l}</p>
            <p className={`num mt-0.5 text-[16px] font-bold ${s.c}`}>{s.v}</p>
          </div>
        ))}
      </div>

      <div className="mt-4">
        <p className="mb-2 text-[11px] font-bold uppercase tracking-[.14em] text-slate-400">Performance by game</p>
        {byGame.length ? (
          <div className="space-y-1.5">
            {byGame.map(([id, r]) => {
              const g = GAMES.find((x) => x.id === id)
              const net = r.payout - r.wagered
              const share = Math.min(1, r.wagered / Math.max(1, stats.wagered))
              return (
                <div key={id} className="flex items-center gap-2.5 rounded-lg border border-white/[0.06] bg-white/[0.02] p-2">
                  <img src={g?.art} alt="" className="h-8 w-8 rounded-md object-cover" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-[12px] font-semibold text-white">{g?.name ?? id}</p>
                      <p className={`num text-[11.5px] font-bold ${net >= 0 ? 'text-neon-lime' : 'text-rose-400'}`}>
                        {net >= 0 ? '+' : ''}{money(net)}
                      </p>
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/10">
                        <div className="h-full rounded-full bg-gradient-to-r from-neon-lime/80 to-neon-cyan/70" style={{ width: `${Math.max(6, share * 100)}%` }} />
                      </div>
                      <span className="num shrink-0 text-[10px] text-slate-500">{money(r.wagered)} wagered · {r.rounds} bets</span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <p className="rounded-xl border border-dashed border-white/10 px-4 py-6 text-center text-[12px] text-slate-500">Play a few rounds to unlock your stats.</p>
        )}
      </div>

      <div className="mt-4">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-[11px] font-bold uppercase tracking-[.14em] text-slate-400">Recent bets</p>
          <span className="chip !border-white/[0.07] normal-case tracking-normal">{bets.length} tracked</span>
        </div>
        <BetFeed limit={12} />
      </div>
    </Sheet>
  )
}

/* ------------------------------------------------------------------ Search */

export function SearchModal({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (id: string) => void }) {
  const [q, setQ] = useState('')
  useEffect(() => { if (open) setQ('') }, [open])
  const results = GAMES.filter((g) => g.name.toLowerCase().includes(q.toLowerCase()) || g.tagline.toLowerCase().includes(q.toLowerCase()))

  return (
    <Sheet open={open} onClose={onClose} title="Search games" subtitle="8 originals · more every month" icon={<IconBolt size={18} />}>
      <input
        autoFocus
        className="field !py-3 !text-[14px]"
        placeholder="Try “plinko”, “mines”, “crash”…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <div className="mt-3 grid gap-1.5">
        {results.map((g) => (
          <button
            key={g.id}
            type="button"
            onClick={() => { onPick(g.id); onClose() }}
            className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-2 text-left transition hover:border-neon-lime/30 hover:bg-white/[0.06]"
          >
            <img src={g.art} alt="" className="h-11 w-11 rounded-lg object-cover" />
            <div className="flex-1">
              <p className="text-[13px] font-bold text-white">{g.name}</p>
              <p className="text-[11px] text-slate-500">{g.tagline} · {g.rtp} RTP</p>
            </div>
            <span className="chip !border-white/[0.07] normal-case tracking-normal">Play</span>
          </button>
        ))}
        {!results.length && <p className="py-6 text-center text-[12px] text-slate-500">No games match “{q}”.</p>}
      </div>
    </Sheet>
  )
}

/* ------------------------------------------------------------------ Bonus / promo */

export function PromoModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { deposit, toast } = useStore()
  const [claimed, setClaimed] = useState(false)
  return (
    <Sheet open={open} onClose={onClose} title="Welcome bonus" subtitle="Available to new FloatBet players" icon={<IconGift size={18} />}>
      <div className="relative overflow-hidden rounded-2xl border border-neon-lime/25 bg-gradient-to-br from-neon-lime/15 via-ink-800 to-ink-850 p-5 text-center">
        <div className="pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full bg-neon-lime/20 blur-2xl" />
        <p className="text-[10.5px] font-bold uppercase tracking-[.24em] text-neon-lime/80">Deposit bonus</p>
        <p className="mt-1 text-4xl font-black text-white">+200%</p>
        <p className="mt-1 text-[12px] text-slate-400">on your first deposit, up to 5,000 PX</p>
        <div className="mt-3 flex items-center justify-center gap-1.5">
          {['Instant', 'Provably fair', '18+ only'].map((t) => (
            <span key={t} className="rounded-full bg-black/30 px-2 py-0.5 text-[10px] font-semibold text-slate-300">{t}</span>
          ))}
        </div>
      </div>
      <button
        type="button"
        disabled={claimed}
        onClick={() => {
          deposit(5000)
          setClaimed(true)
          toast({ kind: 'success', title: 'Bonus claimed', body: '5,000 PX welcome bonus credited.' })
        }}
        className="btn-primary mt-4 h-12 w-full text-[14px]"
      >
        {claimed ? <><IconCheck size={16} /> Bonus credited</> : <><IconGift size={16} /> Claim 5,000 PX bonus</>}
      </button>
      <p className="mt-2 text-center text-[10.5px] text-slate-600">Bonus funds carry wagering requirements · 18+</p>
    </Sheet>
  )
}

/* ------------------------------------------------------------------ Verifier */

function VerifyPanel({
  defaultServerSeed, defaultClientSeed,
}: {
  defaultServerSeed: string
  defaultClientSeed: string
  onVerifyed: () => void
}) {
  const { clientSeed } = useStore()
  const [server, setServer] = useState(defaultServerSeed)
  const [client, setClient] = useState(defaultClientSeed || clientSeed)
  const [nonce, setNonce] = useState('1')
  const [out, setOut] = useState<{ u: string; crash: string; limbo: string; dice: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const run = async () => {
    setBusy(true)
    try {
      const [u] = await floats(server.trim(), client.trim() || 'client', Math.max(1, parseInt(nonce) || 1), 1)
      setOut({
        u: u.toFixed(10),
        crash: `${crashPoint(u).toFixed(2)}×`,
        limbo: `${limboPoint(u).toFixed(2)}×`,
        dice: diceRoll(u).toFixed(2),
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <p className="mb-2 text-[11px] font-bold uppercase tracking-[.14em] text-slate-400">Verify a round</p>
      <div className="space-y-2">
        <div>
          <label className="label" htmlFor="vs">Server seed</label>
          <input id="vs" className="field num !text-[11px]" value={server} onChange={(e) => setServer(e.target.value)} />
        </div>
        <div className="grid grid-cols-[1fr_84px] gap-2">
          <div>
            <label className="label" htmlFor="vc">Client seed</label>
            <input id="vc" className="field num !text-[11px]" value={client} onChange={(e) => setClient(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="vn">Nonce</label>
            <input id="vn" className="field num !text-[11px]" value={nonce} onChange={(e) => setNonce(e.target.value.replace(/\D/g, ''))} />
          </div>
        </div>
        <button type="button" onClick={() => void run()} disabled={busy} className="btn-dark w-full !py-2 !text-[12px]">
          {busy ? 'Computing HMAC…' : 'Run verifier'}
        </button>
        {out && (
          <div className="animate-popIn space-y-1 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.06] p-2.5">
            <p className="flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-wider text-emerald-300">
              <IconCheck size={12} /> HMAC_SHA256 output
            </p>
            <p className="num break-all text-[10.5px] text-slate-400">float[0] = {out.u}</p>
            <div className="grid grid-cols-3 gap-1.5 pt-1">
              {[
                { l: 'Lift Off', v: out.crash },
                { l: 'Limbo', v: out.limbo },
                { l: 'Dice', v: out.dice },
              ].map((x) => (
                <div key={x.l} className="rounded-lg bg-black/25 px-2 py-1 text-center">
                  <p className="text-[9px] uppercase tracking-wider text-slate-500">{x.l}</p>
                  <p className="num text-[11.5px] font-bold text-white">{x.v}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
