import React, { useEffect, useMemo, useState } from 'react'
import { GAMES, LIVE_WINS } from '../lib/games'
import { compact, money, mult, shortHash, timeAgo } from '../lib/format'
import type { GameId } from '../lib/types'
import { useStore } from '../lib/store'
import {
  IconBolt, IconChat, IconCheck, IconChevronDown, IconClose, IconCopy, IconEye, IconEyeOff, IconGift,
  IconHistory, IconHome, IconLive, IconMenu, IconMuted, IconSearch, IconShield, IconSpade, IconTrophy,
  IconVolume, IconWallet, IconDiamond, IconInfo, IconGrid, IconGamepad,
} from './Icons'

/* ------------------------------------------------------------------ Header */

type HeaderProps = {
  view: 'home' | 'game' | 'proxicash'
  onNavigate: (v: 'home' | 'game' | 'proxicash', id?: GameId) => void
  onSearch: () => void
}

export function Header({ view, onNavigate, onSearch }: HeaderProps) {
  const { balance, balanceHidden, toggleBalanceHidden, setWalletOpen, setHistoryOpen, setFairOpen, setRewardsOpen, sound, toggleSound, username, bets } = useStore()
  const [accountOpen, setAccountOpen] = useState(false)
  const [mobileNav, setMobileNav] = useState(false)

  useEffect(() => {
    if (!accountOpen) return
    const close = () => setAccountOpen(false)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [accountOpen])

  const lastBet = bets[0]

  return (
    <header className="sticky top-0 z-40 border-b border-white/[0.06] glass">
      <div className="mx-auto flex h-[62px] max-w-[1500px] items-center gap-2 px-3 sm:gap-4 sm:px-5">
        <button
          type="button"
          onClick={() => onNavigate('home')}
          className="group flex shrink-0 items-center gap-2.5"
          aria-label="FloatBet Gaming home"
        >
          <Logo />
          <span className="hidden text-[17px] font-extrabold tracking-tight text-white sm:block">
            Float<span className="text-neon-lime">Bet</span>
            <span className="ml-1 hidden text-[10px] font-bold uppercase tracking-[.2em] text-slate-500 lg:inline">Gaming</span>
          </span>
        </button>

        <nav className="ml-1 hidden items-center gap-0.5 lg:flex">
          <NavItem active={view === 'home'} onClick={() => onNavigate('home')} icon={<IconHome size={17} />}>
            Casino
          </NavItem>
          <NavItem onClick={onSearch} icon={<IconGamepad size={17} />}>Originals</NavItem>
          <NavItem active={view === 'proxicash'} onClick={() => onNavigate('proxicash')} icon={<IconBolt size={17} />}>ProxiCash</NavItem>
          <NavItem onClick={() => setFairOpen(true)} icon={<IconShield size={17} />}>Fairness</NavItem>
          <NavItem onClick={() => setRewardsOpen(true)} icon={<IconGift size={17} />}>Rewards</NavItem>
          <NavItem onClick={() => setHistoryOpen(true)} icon={<IconTrophy size={17} />}>Leaderboard</NavItem>
        </nav>

        <button
          type="button"
          onClick={onSearch}
          className="ml-auto hidden h-9 max-w-[260px] flex-1 items-center gap-2 rounded-full border border-white/[0.07] bg-white/[0.03] px-3.5 text-[13px] text-slate-500 transition hover:border-white/15 hover:text-slate-300 md:flex"
        >
          <IconSearch size={15} />
          <span>Search games</span>
          <kbd className="ml-auto rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-400">/</kbd>
        </button>

        <div className="ml-auto flex items-center gap-1.5 md:ml-0">
          <button
            type="button"
            onClick={toggleSound}
            aria-label={sound ? 'Mute sound' : 'Enable sound'}
            className="hidden h-9 w-9 place-items-center rounded-full text-slate-400 transition hover:bg-white/5 hover:text-white sm:grid"
          >
            {sound ? <IconVolume size={18} /> : <IconMuted size={18} />}
          </button>
          <button
            type="button"
            onClick={() => setRewardsOpen(true)}
            aria-label="Rewards and bonuses"
            className="relative grid h-9 w-9 place-items-center rounded-full text-slate-400 transition hover:bg-white/5 hover:text-gold"
          >
            <IconGift size={18} />
            <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-rose-400 ring-2 ring-ink-900" />
          </button>
          <button
            type="button"
            onClick={() => setFairOpen(true)}
            className="hidden h-9 items-center gap-1.5 rounded-full border border-white/[0.07] bg-white/[0.03] px-3 text-[11.5px] font-semibold text-slate-300 transition hover:border-neon-lime/40 hover:text-white xl:flex"
          >
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-neon-lime opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-neon-lime" />
            </span>
            Provably Fair
          </button>

          <div className="flex items-stretch overflow-hidden rounded-full border border-white/[0.09] bg-ink-800/90">
            <button
              type="button"
              onClick={() => setWalletOpen(true)}
              className="flex items-center gap-1.5 pl-3 pr-2.5 text-[13px] font-bold text-white transition hover:bg-white/[0.06]"
            >
              <span className="grid h-5 w-5 place-items-center rounded-full bg-gradient-to-br from-neon-lime to-neon-green text-[9px] font-black text-ink-950">PX</span>
              <span className="num">{balanceHidden ? '••••••' : money(balance)}</span>
            </button>
            <button
              type="button"
              onClick={toggleBalanceHidden}
              aria-label="Toggle balance visibility"
              className="hidden w-7 place-items-center text-slate-500 transition hover:text-white sm:grid"
            >
              {balanceHidden ? <IconEyeOff size={14} /> : <IconEye size={14} />}
            </button>
            <button
              type="button"
              onClick={() => setWalletOpen(true)}
              className="flex items-center gap-1 bg-gradient-to-b from-neon-green to-[#8fdc1f] px-3 text-[12.5px] font-extrabold text-ink-950 transition hover:brightness-105"
            >
              <IconWallet size={15} /> <span className="hidden sm:inline">Wallet</span>
            </button>
          </div>

          <div className="relative" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => setAccountOpen((v) => !v)}
              aria-label="Account menu"
              className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-neon-violet/80 to-neon-cyan/70 text-[12px] font-black text-ink-950 ring-2 ring-white/10 transition hover:ring-neon-lime/60"
            >
              {username.slice(0, 2).toUpperCase()}
            </button>
            {accountOpen && (
              <div className="absolute right-0 top-11 w-64 animate-popIn overflow-hidden rounded-2xl border border-white/10 bg-ink-850 p-1.5 shadow-pop">
                <div className="border-b border-white/[0.07] px-3 py-2.5">
                  <p className="text-[10px] font-bold uppercase tracking-[.16em] text-slate-500">Signed in</p>
                  <p className="truncate text-sm font-semibold text-white">{username}</p>
                  <p className="num mt-0.5 text-[11px] text-slate-400">Level 24 · VIP Platinum</p>
                </div>
                <MenuItem icon={<IconHistory size={15} />} onClick={() => { setHistoryOpen(true); setAccountOpen(false) }}>Bet history</MenuItem>
                <MenuItem icon={<IconShield size={15} />} onClick={() => { setFairOpen(true); setAccountOpen(false) }}>Provably fair</MenuItem>
                <MenuItem icon={<IconGift size={15} />} onClick={() => { setRewardsOpen(true); setAccountOpen(false) }}>Rewards & bonuses</MenuItem>
                <MenuItem icon={<IconTrophy size={15} />} onClick={() => { setHistoryOpen(true); setAccountOpen(false) }}>Rank & leaderboard</MenuItem>
                <div className="divider my-1" />
                <div className="flex items-center justify-between px-3 py-2">
                  <span className="text-[12px] text-slate-400">Sound</span>
                  <button type="button" onClick={toggleSound} aria-label="Toggle sound" className="text-slate-300 hover:text-neon-lime">
                    {sound ? <IconVolume size={16} /> : <IconMuted size={16} />}
                  </button>
                </div>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => setMobileNav(true)}
            aria-label="Open menu"
            className="grid h-9 w-9 place-items-center rounded-full text-slate-300 transition hover:bg-white/5 lg:hidden"
          >
            <IconMenu size={20} />
          </button>
        </div>
      </div>

      {/* secondary category bar */}
      <div className="hidden border-t border-white/[0.05] md:block">
        <div className="mx-auto flex max-w-[1500px] items-center gap-1 overflow-x-auto px-5 py-1.5 no-scrollbar">
          <CatPill active icon={<IconFlameBag />}>Popular</CatPill>
          <CatPill icon={<IconSpade size={13} />}>Slots</CatPill>
          <CatPill icon={<IconLive size={13} />}>Live Casino</CatPill>
          <CatPill icon={<IconDiamond size={13} />}>Originals</CatPill>
          <CatPill icon={<IconGrid size={13} />}>Table Games</CatPill>
          <CatPill icon={<IconBolt size={13} />}>Instant Win</CatPill>
          <CatPill icon={<IconGift size={13} />}>Bonus Buy</CatPill>
          <CatPill icon={<IconTrophy size={13} />}>Tournaments</CatPill>
          <div className="ml-auto flex items-center gap-2 pl-4">
            {lastBet && (
              <span className="chip !border-white/[0.07] !px-2.5 normal-case tracking-normal">
                <span className="text-slate-500">Last</span>
                <span className={lastBet.won ? 'font-bold text-neon-lime' : 'font-bold text-rose-400'}>{mult(lastBet.multiplier)}</span>
              </span>
            )}
            <span className="chip normal-case tracking-normal">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> {compact(142318)} online
            </span>
          </div>
        </div>
      </div>

      {mobileNav && <MobileDrawer onClose={() => setMobileNav(false)} onNavigate={onNavigate} />}
    </header>
  )
}

const IconFlameBag = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.5s5.5 4.2 5.5 9.5a5.5 5.5 0 0 1-11 0C6.5 9.6 8 7.8 8 7.8s.8 2 2.2 2.4C10.2 7 12 2.5 12 2.5Z" /></svg>
)

function MobileDrawer({ onClose, onNavigate }: { onClose: () => void; onNavigate: HeaderProps['onNavigate'] }) {
  return (
    <div className="fixed inset-0 z-50 lg:hidden">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="absolute right-0 top-0 h-full w-[82%] max-w-sm animate-popIn border-l border-white/10 bg-ink-900 p-4">
        <div className="mb-4 flex items-center justify-between">
          <span className="text-sm font-bold text-white">Menu</span>
          <button type="button" onClick={onClose} aria-label="Close menu" className="grid h-8 w-8 place-items-center rounded-full bg-white/5 text-slate-300">
            <IconClose size={16} />
          </button>
        </div>
        <div className="space-y-1.5">
          {GAMES.map((g) => (
            <button
              key={g.id}
              type="button"
              onClick={() => { onNavigate('game', g.id); onClose() }}
              className="flex w-full items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.025] p-2 text-left transition hover:bg-white/[0.06]"
            >
              <img src={g.art} alt="" className="h-10 w-10 rounded-lg object-cover" />
              <span>
                <span className="block text-[13px] font-semibold text-white">{g.name}</span>
                <span className="block text-[11px] text-slate-500">{g.rtp} RTP · {g.maxWin}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function MenuItem({ children, icon, onClick }: { children: React.ReactNode; icon: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium text-slate-300 transition hover:bg-white/[0.06] hover:text-white"
    >
      <span className="text-slate-500">{icon}</span>
      {children}
    </button>
  )
}

function NavItem({ children, icon, onClick, active }: { children: React.ReactNode; icon: React.ReactNode; onClick: () => void; active?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-[13px] font-semibold transition ${
        active ? 'bg-white/[0.07] text-white' : 'text-slate-400 hover:bg-white/5 hover:text-white'
      }`}
    >
      <span className={active ? 'text-neon-lime' : ''}>{icon}</span>
      {children}
    </button>
  )
}

function CatPill({ children, icon, active }: { children: React.ReactNode; icon: React.ReactNode; active?: boolean }) {
  return (
    <button
      type="button"
      className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold transition ${
        active ? 'bg-neon-lime/12 text-neon-lime' : 'text-slate-400 hover:bg-white/[0.05] hover:text-slate-200'
      }`}
    >
      {icon}
      {children}
    </button>
  )
}

/* ------------------------------------------------------------------ Logo */

export function Logo({ size = 34 }: { size?: number }) {
  return (
    <span
      className="relative grid place-items-center rounded-xl"
      style={{
        width: size, height: size,
        background: 'linear-gradient(150deg,#e5ff9b,#b6ee3f 45%,#7dd31c)',
        boxShadow: '0 8px 22px -10px rgba(182,238,63,.9), inset 0 1px 0 rgba(255,255,255,.6)',
      }}
    >
      <svg width={size * 0.62} height={size * 0.62} viewBox="0 0 24 24" fill="none" stroke="#0b0d15" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6.5 8h11a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2Z" />
        <path d="M8.5 12h7M10.5 9.6 8.2 12l2.3 2.4M13.5 9.6 15.8 12l-2.3 2.4" />
      </svg>
    </span>
  )
}

/* ------------------------------------------------------------------ Live win ticker */

export function WinTicker() {
  const rows = useMemo(() => [...LIVE_WINS, ...LIVE_WINS], [])
  return (
    <div className="relative overflow-hidden border-b border-white/[0.05] bg-ink-900/60">
      <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-16 bg-gradient-to-r from-ink-950 to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-16 bg-gradient-to-l from-ink-950 to-transparent" />
      <div className="flex w-max animate-marquee items-center gap-2 py-2">
        {rows.map((w, i) => (
          <div key={i} className="flex items-center gap-2 whitespace-nowrap rounded-full border border-white/[0.05] bg-white/[0.02] px-3 py-1">
            <span className="grid h-5 w-5 place-items-center rounded-full bg-gradient-to-br from-neon-cyan/30 to-neon-violet/30 text-[9px] font-black text-white">
              {w.user.slice(0, 2).toUpperCase()}
            </span>
            <span className="text-[11px] text-slate-400">{w.user}</span>
            <span className="text-[11px] text-slate-600">won</span>
            <span className="num text-[11px] font-bold text-white">{money(w.amount)} PX</span>
            <span className="num rounded bg-neon-lime/15 px-1.5 py-0.5 text-[10px] font-bold text-neon-lime">{mult(w.mult)}</span>
            <span className="hidden text-[11px] text-slate-600 sm:inline">on {w.game}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ Chat */

const CHAT_SEED = [
  { user: 'Nakato_UG', msg: 'that 842x on Lift Off was unreal 🤯', vip: true },
  { user: 'zeroCool', msg: 'anyone hitting plinko 16 rows high risk tonight?' },
  { user: 'KampalaKid', msg: 'withdrew in 40 seconds. floatbet is fast', attached: true },
  { user: 'Achieng', msg: 'rain incoming, get in the chat' },
  { user: 'moon_vault', msg: 'mines 3 bombs 12 gems = printer' },
  { user: 'slyfox', msg: 'kk everyone gl' },
]

export function ChatDock() {
  const [open, setOpen] = useState(false)
  const [msgs, setMsgs] = useState(CHAT_SEED)
  const [text, setText] = useState('')
  const { username, toast } = useStore()

  const send = () => {
    if (!text.trim()) return
    setMsgs((m) => [...m, { user: username, msg: text.trim(), vip: false }])
    setText('')
    toast({ kind: 'success', title: 'Message sent', body: 'You earned +2 XP for chatting.' })
  }

  return (
    <div className="fixed bottom-4 right-4 z-30 hidden xl:block">
      {open ? (
        <div className="w-[320px] animate-popIn overflow-hidden rounded-2xl border border-white/10 bg-ink-850/95 shadow-pop backdrop-blur-xl">
          <div className="flex items-center justify-between border-b border-white/[0.07] px-3.5 py-2.5">
            <div className="flex items-center gap-2">
              <IconChat size={15} className="text-neon-lime" />
              <span className="text-[12.5px] font-bold text-white">English Chat</span>
              <span className="chip !px-2 !py-0.5 !text-[10px] normal-case tracking-normal">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />2.1k
              </span>
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close chat" className="text-slate-500 hover:text-white">
              <IconClose size={15} />
            </button>
          </div>
          <div className="h-56 space-y-2 overflow-y-auto px-3.5 py-3">
            {msgs.map((m, i) => (
              <div key={i} className="text-[12px] leading-relaxed">
                <span className={`font-bold ${m.vip ? 'text-gold' : 'text-neon-cyan'}`}>{m.user}</span>
                {m.vip && <span className="ml-1 rounded bg-gold/15 px-1 text-[9px] font-black uppercase text-gold">vip</span>}
                <span className="ml-1 text-slate-400">{m.msg}</span>
                {m.attached && (
                  <div className="mt-1 flex items-center gap-2 rounded-lg border border-white/[0.07] bg-white/[0.03] px-2 py-1.5 text-[10.5px] text-slate-400">
                    <IconCheck size={12} className="text-emerald-400" /> Withdrawal completed · 4,210 PX
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="flex gap-1.5 border-t border-white/[0.07] p-2.5">
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && send()}
              placeholder="Say something…"
              className="field !py-2 !text-[12px]"
            />
            <button type="button" onClick={send} className="btn-primary !px-3 !py-2 !text-[12px]">Send</button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex items-center gap-2 rounded-full border border-white/10 bg-ink-850/95 px-4 py-2.5 text-[12.5px] font-bold text-white shadow-pop backdrop-blur-xl transition hover:border-neon-lime/40"
        >
          <IconChat size={16} className="text-neon-lime" /> Chat
          <span className="rounded-full bg-white/10 px-1.5 text-[10px]">2.1k</span>
        </button>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ Footer */

export function Footer() {
  const cols = [
    { title: 'Casino', items: ['Originals', 'Slots', 'Live Casino', 'Table Games', 'Instant Win', 'Bonus Buy'] },
    { title: 'Support', items: ['Help Center', 'Live Chat', 'Responsible Gaming', 'Self Exclusion', 'Contact Us'] },
    { title: 'Company', items: ['About FloatBet', 'VIP Club', 'Affiliates', 'Careers', 'Press Kit'] },
    { title: 'Legal', items: ['Terms of Service', 'Privacy Policy', 'AML Policy', 'Provably Fair', 'Licenses'] },
  ]
  return (
    <footer className="mt-16 border-t border-white/[0.06] bg-ink-950/80">
      <div className="mx-auto max-w-[1500px] px-5 py-12">
        <div className="grid gap-10 lg:grid-cols-[1.3fr_repeat(4,1fr)]">
          <div>
            <div className="flex items-center gap-2.5">
              <Logo size={32} />
              <span className="text-[15px] font-extrabold text-white">Float<span className="text-neon-lime">Bet</span> <span className="text-[10px] font-bold uppercase tracking-[.18em] text-slate-500">Gaming</span></span>
            </div>
            <p className="mt-3 max-w-xs text-[12.5px] leading-relaxed text-slate-500">
              Provably fair crypto casino. 8 original games, instant settlement and the fastest withdrawals in the industry.
            </p>
            <div className="mt-4 flex flex-wrap gap-1.5">
              {['BTC', 'ETH', 'USDT', 'TRX', 'SOL', 'LTC'].map((c) => (
                <span key={c} className="rounded-md border border-white/[0.07] bg-white/[0.03] px-2 py-1 text-[10px] font-bold text-slate-400">{c}</span>
              ))}
            </div>
            <div className="mt-4 flex items-center gap-2 text-[11px] text-slate-500">
              <IconShield size={14} className="text-emerald-400" /> Audited RNG · 18+ only
            </div>
          </div>
          {cols.map((c) => (
            <div key={c.title}>
              <h4 className="mb-3 text-[11px] font-bold uppercase tracking-[.16em] text-slate-400">{c.title}</h4>
              <ul className="space-y-2">
                {c.items.map((i) => (
                  <li key={i}>
                    <button type="button" className="text-[12.5px] text-slate-500 transition hover:text-white">{i}</button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="divider my-8" />
        <div className="flex flex-col items-start justify-between gap-3 text-[11.5px] text-slate-600 sm:flex-row sm:items-center">
          <p>© 2026 FloatBet Gaming. Demo experience — no real money is wagered in this build.</p>
          <p className="flex items-center gap-2">
            <span className="num">{shortHash('a91f3c7d2e')}</span> · v1.4.2
          </p>
        </div>
      </div>
    </footer>
  )
}

/* ------------------------------------------------------------------ Bottom bar (mobile) */

export function BottomBar({ view, onNavigate }: { view: 'home' | 'game' | 'proxicash'; onNavigate: HeaderProps['onNavigate'] }) {
  const { setWalletOpen, setHistoryOpen, setRewardsOpen } = useStore()
  const items: { label: string; icon: React.ReactNode; onClick: () => void; active?: boolean }[] = [
    { label: 'Home', icon: <IconHome size={19} />, onClick: () => onNavigate('home'), active: view === 'home' },
    { label: 'Wallet', icon: <IconWallet size={19} />, onClick: () => setWalletOpen(true) },
    { label: 'Rewards', icon: <IconGift size={19} />, onClick: () => setRewardsOpen(true) },
    { label: 'ProxiCash', icon: <IconBolt size={19} />, onClick: () => onNavigate('proxicash'), active: view === 'proxicash' },
  ]
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 grid grid-cols-4 border-t border-white/[0.07] glass pb-[env(safe-area-inset-bottom)] md:hidden">
      {items.map((i) => (
        <button
          key={i.label}
          type="button"
          onClick={i.onClick}
          className={`flex flex-col items-center gap-0.5 py-2.5 text-[10px] font-semibold transition ${
            i.active ? 'text-neon-lime' : 'text-slate-500'
          }`}
        >
          {i.icon}
          {i.label}
        </button>
      ))}
    </nav>
  )
}

/* ------------------------------------------------------------------ Win flash overlay */

export function WinFlash() {
  const { winFlash, lossFlash } = useStore()
  if (lossFlash) {
    return (
      <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center">
        <div className="absolute inset-0 animate-[pulseGlow_.42s_ease-out_1] bg-rose-600/[0.16]" />
        <p className="relative animate-popIn text-[12px] font-black uppercase tracking-[.3em] text-rose-300/90">No win</p>
      </div>
    )
  }
  if (winFlash == null) return null
  return (
    <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center">
      <div className="absolute inset-0 animate-popIn bg-gradient-to-b from-neon-lime/[0.07] via-transparent to-neon-violet/[0.07]" />
      <div className="relative animate-popIn rounded-3xl border border-neon-lime/30 bg-ink-900/90 px-8 py-5 text-center shadow-glow backdrop-blur-xl">
        <p className="text-[11px] font-bold uppercase tracking-[.28em] text-neon-lime/80">Big win</p>
        <p className="num mt-1 text-4xl font-black text-white glow-text">+{money(winFlash)} PX</p>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ Toasts */

export function Toasts() {
  const { toasts, dismissToast } = useStore()
  return (
    <div className="fixed bottom-4 left-1/2 z-[60] flex w-[92%] max-w-sm -translate-x-1/2 flex-col gap-2 md:bottom-6 md:left-6 md:translate-x-0">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`animate-rise overflow-hidden rounded-xl border px-3.5 py-2.5 shadow-pop backdrop-blur-xl ${
            t.kind === 'success'
              ? 'border-emerald-400/25 bg-emerald-500/10'
              : t.kind === 'error'
                ? 'border-rose-400/25 bg-rose-500/10'
                : t.kind === 'win'
                  ? 'border-neon-lime/30 bg-neon-lime/10'
                  : 'border-white/10 bg-ink-850/95'
          }`}
        >
          <div className="flex items-start gap-2.5">
            <span className={`mt-0.5 ${t.kind === 'error' ? 'text-rose-400' : t.kind === 'success' ? 'text-emerald-400' : 'text-neon-lime'}`}>
              {t.kind === 'error' ? <IconInfo size={15} /> : <IconCheck size={15} />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[12.5px] font-bold text-white">{t.title}</p>
              {t.body && <p className="text-[11.5px] leading-snug text-slate-400">{t.body}</p>}
            </div>
            <button type="button" onClick={() => dismissToast(t.id)} aria-label="Dismiss" className="text-slate-500 hover:text-white">
              <IconClose size={13} />
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ Reusable copy field */

export function CopyField({ label, value, mono = true, masked }: { label: string; value: string; mono?: boolean; masked?: boolean }) {
  const [copied, setCopied] = useState(false)
  const [reveal, setReveal] = useState(!masked)
  const shown = reveal ? value : `${'•'.repeat(Math.min(28, value.length))}`
  return (
    <div>
      <div className="label">{label}</div>
      <div className="flex items-stretch gap-1.5 rounded-xl border border-white/10 bg-ink-900/80 p-1.5">
        <code className={`flex-1 overflow-hidden text-ellipsis whitespace-nowrap px-1.5 py-2 text-[11.5px] ${mono ? 'font-num' : ''} text-slate-300`}>
          {shown}
        </code>
        {masked && (
          <button type="button" onClick={() => setReveal((v) => !v)} aria-label="Reveal" className="grid w-8 place-items-center rounded-lg text-slate-500 hover:bg-white/5 hover:text-white">
            {reveal ? <IconEyeOff size={14} /> : <IconEye size={14} />}
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(value).catch(() => {})
            setCopied(true)
            window.setTimeout(() => setCopied(false), 1400)
          }}
          aria-label={`Copy ${label}`}
          className="grid w-8 place-items-center rounded-lg text-slate-500 transition hover:bg-white/5 hover:text-neon-lime"
        >
          {copied ? <IconCheck size={14} className="text-neon-lime" /> : <IconCopy size={14} />}
        </button>
      </div>
    </div>
  )
}

export function BetFeed({ limit = 8 }: { limit?: number }) {
  const { bets } = useStore()
  if (!bets.length) {
    return (
      <div className="rounded-xl border border-dashed border-white/10 px-4 py-8 text-center text-[12px] text-slate-500">
        Your settled bets will appear here.
      </div>
    )
  }
  return (
    <div className="space-y-1">
      {bets.slice(0, limit).map((b) => (
        <div key={b.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 transition hover:bg-white/[0.03]">
          <img src={GAMES.find((g) => g.id === b.game)?.art} alt="" className="h-7 w-7 rounded-md object-cover" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[11.5px] font-semibold text-slate-200">{b.gameName}</p>
            <p className="truncate text-[10px] text-slate-500">{b.detail}</p>
          </div>
          <div className="text-right">
            <p className={`num text-[11.5px] font-bold ${b.won ? 'text-neon-lime' : 'text-slate-500'}`}>{mult(b.multiplier)}</p>
            <p className="num text-[10px] text-slate-500">{timeAgo(b.ts)}</p>
          </div>
        </div>
      ))}
    </div>
  )
}
