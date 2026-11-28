import React, { useEffect, useMemo, useState } from 'react'
import { useStore } from '../lib/store'
import { money, mult, shortHash, timeAgo, pct } from '../lib/format'
import { GAMES } from '../lib/games'
import {
  IconBolt, IconCheck, IconClose, IconCopy, IconExternal, IconGift, IconInfo, IconShield, IconTrophy, IconWallet,
} from './Icons'
import { CopyField, BetFeed } from './Chrome'
import { ModeSwitch, RefillButton } from './ModeBadge'
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

/**
 * The wallet.
 *
 * WHAT THIS USED TO BE, AND WHY IT IS GONE
 *
 * It offered a Deposit tab, an amount box, and a "Deposit UGX N" button that
 * called a local `deposit(amount)` — pure state arithmetic, then a toast reading
 * "Deposit confirmed". No payment provider was involved, nothing was charged, and
 * the amount was whatever the player typed. Every figure entered was credited.
 * The withdraw tab had the mirror bug: it subtracted a local number and printed
 * "Withdrawal submitted" for money that no one was ever asked to send.
 *
 * Around that sat hardcoded crypto addresses, a fabricated "avg 42s" payout
 * claim, and a "0x7f9A…" withdrawal address default. None of it was real.
 *
 * So the wallet now does exactly two honest things: it shows the balance, and it
 * hands the player to the mobile-money flow, which charges through ZENGAY and
 * credits only on a confirmed webhook. There is no local path that can increase
 * a balance, so there is nothing here to abuse.
 */
export function WalletModal({ forceOpen }: { forceOpen?: boolean } = {}) {
  const { walletOpen, setWalletOpen, balance, totalDeposited, stats, mode, playBalance, unsentCredit, username } = useStore()
  const [tab, setTab] = useState<'overview' | 'topup' | 'cashout'>('overview')

  const go = (hash: string) => {
    setWalletOpen(false)
    try { window.location.hash = hash } catch { /* ignore */ }
  }

  return (
    <Sheet
      open={forceOpen ?? walletOpen}
      onClose={() => setWalletOpen(false)}
      title="Wallet"
      subtitle={mode === 'free' ? `Free play · ${username}` : `Balance UGX ${money(playBalance)} · ${username}`}
      icon={<IconWallet size={18} />}
    >
      {/* The mode switch belongs next to the balance: it is the one place a
          player reads a number as money, so it is where they must be able to
          change — and see — which money it is. */}
      <div className="mb-3">
        <ModeSwitch />
      </div>

      <div className="mb-4 overflow-hidden rounded-2xl border border-neon-lime/20 bg-gradient-to-br from-neon-lime/[0.12] via-ink-800 to-ink-850 p-4">
        <p className="text-[10.5px] font-bold uppercase tracking-[.18em] text-neon-lime/70">
          {mode === 'free' ? 'Free play credits — not real money' : 'Available balance'}
        </p>
        <div className="mt-1 flex items-end gap-2">
          <span className={`num text-3xl font-black ${mode === 'free' ? 'text-amber-200' : 'text-white'}`}>
            {money(playBalance)}
          </span>
          <span className="mb-1 text-[12px] font-bold text-slate-400">UGX</span>
        </div>
        {/* Game results in the arcade are settled in the browser, so they are not
            on the platform's books until a deposit or the daily reward moves the
            balance. Saying so is the difference between a player discovering this
            at the cashout screen and knowing it now. */}
        {mode !== 'free' && unsentCredit > 0 && (
          <p className="mt-2 rounded-lg border border-amber-400/25 bg-amber-400/[0.08] px-2.5 py-2 text-[10.5px] leading-relaxed text-amber-200">
            UGX {money(unsentCredit)} of this is game winnings this device is holding. It is not
            withdrawable yet — only the amount the platform has recorded can be cashed out.
          </p>
        )}
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

      {mode === 'free' ? (
        <p className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-3 text-[11.5px] leading-relaxed text-amber-200">
          You are in free play. These credits are practice only — they cannot be
          topped up, cashed out, or turned into money. Switch to real money to
          make a deposit.
        </p>
      ) : (
        <>
          <div className="mb-3 flex gap-1 rounded-xl border border-white/[0.07] bg-ink-900/70 p-1">
            {([['overview', 'Overview'], ['topup', 'Top up'], ['cashout', 'Cash out']] as const).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => { setTab(id); sfx.click() }}
                className={`flex-1 rounded-lg py-2 text-[12.5px] font-bold transition ${
                  tab === id ? 'bg-white/[0.09] text-white shadow-sm' : 'text-slate-400 hover:text-white'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === 'overview' && (
            <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
              <p className="text-[11.5px] leading-relaxed text-slate-400">
                Top up with MTN or Airtel mobile money. Every deposit is charged by
                the network and credited once the payment is confirmed — never
                before.
              </p>
              <button type="button" onClick={() => go('#topup')} className="btn-primary mt-3 h-10 w-full !text-[12.5px]">
                <IconBolt size={15} /> Top up
              </button>
            </div>
          )}

          {tab === 'topup' && (
            <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
              <p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">Mobile money</p>
              <p className="text-[11.5px] leading-relaxed text-slate-400">
                Minimum UGX 500. You will get a prompt on your phone — approve it
                and the balance updates when the network confirms.
              </p>
              <button type="button" onClick={() => go('#topup')} className="btn-primary mt-3 h-10 w-full !text-[12.5px]">
                <IconBolt size={15} /> Enter an amount
              </button>
            </div>
          )}

          {tab === 'cashout' && (
            <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
              <p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">Withdraw to mobile money</p>
              <p className="text-[11.5px] leading-relaxed text-slate-400">
                Minimum UGX 1,000. Paid out to the mobile money number you enter.
              </p>
              <button type="button" onClick={() => go('#cashout')} className="btn-primary mt-3 h-10 w-full !text-[12.5px]">
                <IconBolt size={15} /> Request a cashout
              </button>
            </div>
          )}
        </>
      )}

      <p className="mt-3 text-center text-[10px] text-slate-600">
        Balances change only when a payment is confirmed by the network. 18+ · Play responsibly.
      </p>
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

/*
 * THE REWARDS HUB IS GONE.
 *
 * It listed four "rewards" with amounts summing to UGX 7,090, all from hardcoded
 * data — a "Daily login · streak day 3 of 7", a rakeback percentage, a race rank,
 * a VIP tier. None of it was computed from anything. Pressing "Collect all"
 * called the local `deposit()` and added the total to the player's balance.
 *
 * It also contradicted the app: the real daily bonus is the server-side
 * claim_daily_px, and the home page's own rakeback tile is not a claimable
 * amount. Two systems awarded the same thing, and only one of them had a
 * database behind it.
 *
 * The real daily bonus lives in the bar at the top of the app and is granted by
 * the server, once per Kampala day. There is no second place to claim money, so
 * there is nothing here to remove but the printer.
 */

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
