import React, { useEffect, useMemo, useState } from 'react'
import { GAMES, LIVE_WINS, asset } from '../lib/games'
import { SPORTS_HERO } from '../lib/fixtureArt'
import type { GameId } from '../lib/types'
import { compact, money, mult } from '../lib/format'
import { useStore } from '../lib/store'
import { IconArrowUpRight, IconBolt, IconCheck, IconChevronLeft, IconDiamond, IconFlame, IconLive, IconPlay, IconSearch, IconShield, IconSpade, IconTrophy } from '../components/Icons'
import { WinTicker } from '../components/Chrome'
import { sfx } from '../lib/sound'

type Props = { onPlay: (id: GameId) => void; onSearch: () => void; onFair: () => void; onProxiCash?: () => void; onSports?: () => void }

const TABS = ['All', 'Slots', 'Originals', 'Instant', 'Table'] as const

export function Home({ onPlay, onSearch, onFair, onProxiCash, onSports }: Props) {
  const { mode, playBalance, playStats, username } = useStore()
  const [tab, setTab] = useState<(typeof TABS)[number]>('All')
  const [slide, setSlide] = useState(0)

  const games = useMemo(() => (tab === 'All' ? GAMES : GAMES.filter((g) => g.category === tab)), [tab])

  const slides = [
    {
      kicker: 'Welcome to FloatBet Gaming',
      title: 'Float above the house',
      body: '8 provably fair originals. Instant settlement in UGX and up to 1,000,000× multipliers.',
      cta: 'Start playing',
      badge: '8 ORIGINAL GAMES',
      art: asset('/art/hero.webp'),
      onClick: () => onPlay('crash'),
      accent: '#c6f24e',
    },
    {
      kicker: 'Flagship original',
      title: 'Lift Off is live',
      body: 'Ride the multiplier as high as you dare. Cash out before the rocket flies away.',
      cta: 'Play Lift Off',
      badge: 'UP TO 1,000,000×',
      art: asset('/art/crash.webp'),
      onClick: () => onPlay('crash'),
      accent: '#3ad7ff',
    },
    {
      kicker: 'Weekly leaderboard',
      title: 'UGX 50,000 prize pool',
      body: 'Race the top 100 players across all originals. New leaderboard every Monday, 00:00 UTC.',
      cta: 'View leaderboard',
      badge: 'NEW BOARD MONDAY',
      art: asset('/art/wheel.webp'),
      onClick: () => onPlay('crash'),
      accent: '#ffcf5c',
    },
  ]

  useEffect(() => {
    const iv = window.setInterval(() => setSlide((s) => (s + 1) % slides.length), 6500)
    return () => window.clearInterval(iv)
  }, [slides.length])

  const current = slides[slide]

  return (
    <div>
      <WinTicker />

      <div className="mx-auto max-w-[1500px] px-3 pb-16 pt-4 sm:px-5">
        {/* hero */}
        <div className="grid gap-3 lg:grid-cols-[1fr_312px]">
          <div
            className="relative min-h-[300px] overflow-hidden rounded-2xl border border-white/[0.07] bg-ink-900 sm:min-h-[340px]"
            style={{ boxShadow: '0 30px 80px -40px #000' }}
          >
            <img
              key={current.art}
              src={current.art}
              alt=""
              className={`absolute inset-0 h-full w-full object-cover ${current.art === asset('/art/hero.webp') ? 'object-[66%_center]' : 'object-center opacity-70'}`}
            />
            <div className="absolute inset-0 bg-gradient-to-r from-ink-950 via-ink-950/85 to-transparent" />
            <div className="absolute inset-0 bg-gradient-to-t from-ink-950/90 via-transparent to-transparent" />
            <div className="relative flex h-full flex-col justify-center p-5 sm:p-8 lg:max-w-[58%]">
              <span className="chip w-fit !border-neon-lime/30 !bg-neon-lime/10 !text-neon-lime">
                <IconBolt size={11} /> {current.badge}
              </span>
              <p className="mt-3 text-[11px] font-bold uppercase tracking-[.22em] text-slate-400">{current.kicker}</p>
              <h1 className="mt-1.5 max-w-md animate-rise text-[30px] font-extrabold leading-[1.08] tracking-tight text-white sm:text-[42px]">
                {current.title}
              </h1>
              <p className="mt-2 max-w-sm text-[12.5px] leading-relaxed text-slate-400 sm:text-[13.5px]">{current.body}</p>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => { sfx.click(); current.onClick() }} className="btn-primary h-11 px-5">
                  <IconPlay size={15} /> {current.cta}
                </button>
                <button type="button" onClick={onSearch} className="btn-ghost h-11 px-4">
                  <IconSearch size={15} /> Browse games
                </button>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[10.5px] text-slate-500">
                <span className="flex items-center gap-1"><IconShield size={11} className="text-emerald-400" /> Provably fair</span>
                <span className="flex items-center gap-1"><IconCheck size={11} className="text-emerald-400" /> Instant withdrawals</span>
                <span className="flex items-center gap-1"><IconLive size={11} className="text-emerald-400" /> {compact(142318)} playing</span>
              </div>
            </div>

            {/* slide dots */}
            <div className="absolute bottom-4 right-4 flex items-center gap-1.5">
              {slides.map((s, i) => (
                <button
                  key={i}
                  type="button"
                  aria-label={`Slide ${i + 1}`}
                  onClick={() => setSlide(i)}
                  className={`h-1.5 rounded-full transition-all ${i === slide ? 'w-6 bg-neon-lime' : 'w-1.5 bg-white/30 hover:bg-white/60'}`}
                />
              ))}
            </div>
          </div>

          {/* right stack */}
          <div className="grid gap-3">
            <div className="rounded-2xl border border-white/[0.07] bg-ink-850/80 p-4">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-bold uppercase tracking-[.18em] text-slate-500">Your session</p>
                <span className="chip !px-2 !py-0.5 !text-[9.5px] normal-case tracking-normal">{username}</span>
              </div>
              <div className="mt-3 space-y-2">
                {[
                  { l: mode === 'free' ? 'Free credits' : 'Balance', v: `UGX ${money(playBalance)}`, c: mode === 'free' ? 'text-amber-200' : 'text-white' },
                  { l: 'Rounds played', v: String(playStats.rounds), c: 'text-slate-200' },
                  { l: 'Net profit', v: `${playStats.profit >= 0 ? '+' : ''}UGX ${money(playStats.profit)}`, c: playStats.profit >= 0 ? 'text-neon-lime' : 'text-rose-400' },
                ].map((r) => (
                  <div key={r.l} className="flex items-center justify-between text-[11.5px]">
                    <span className="text-slate-500">{r.l}</span>
                    <span className={`num font-bold ${r.c}`}>{r.v}</span>
                  </div>
                ))}
              </div>
              <div className="mt-3 rounded-lg bg-white/[0.03] p-2">
                <div className="flex items-center justify-between text-[10px] text-slate-500">
                  <span>VIP Platinum</span>
                  <span className="num">76%</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10">
                  <div className="h-full w-[76%] rounded-full bg-gradient-to-r from-neon-lime to-gold" />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <button type="button" onClick={onFair} className="group rounded-2xl border border-white/[0.07] bg-ink-850/80 p-3 text-left transition hover:border-neon-lime/30">
                <IconShield size={18} className="text-emerald-400" />
                <p className="mt-2 text-[12px] font-bold text-white">Proof center</p>
                <p className="text-[10.5px] text-slate-500">Verify any round</p>
              </button>
              <button type="button" onClick={() => onPlay('mines')} className="group rounded-2xl border border-white/[0.07] bg-ink-850/80 p-3 text-left transition hover:border-neon-violet/30">
                <IconFlame size={18} className="text-gold" />
                <p className="mt-2 text-[12px] font-bold text-white">Hot streak</p>
                <p className="text-[10.5px] text-slate-500">Deep Mines</p>
              </button>
            </div>
          </div>
        </div>

        {/* quick launcher */}
        <div className="mt-4 flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
          <span className="shrink-0 text-[10.5px] font-bold uppercase tracking-[.16em] text-slate-500">Jump in</span>
          {GAMES.map((g) => (
            <button
              key={g.id}
              type="button"
              onClick={() => onPlay(g.id)}
              className="group flex shrink-0 items-center gap-2 rounded-full border border-white/[0.07] bg-white/[0.03] py-1 pl-1 pr-3 transition hover:border-white/20 hover:bg-white/[0.07]"
            >
              <img src={g.art} alt="" className="h-6 w-6 rounded-full object-cover" />
              <span className="text-[11.5px] font-semibold text-slate-300 group-hover:text-white">{g.name}</span>
            </button>
          ))}
        </div>

        {/* games section */}
        <div className="mt-8 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-[19px] font-extrabold tracking-tight">
              <IconDiamond size={17} className="text-neon-lime" /> FloatBet Originals
            </h2>
            <p className="text-[11.5px] text-slate-500">8 in-house games · provably fair · 99% RTP</p>
          </div>
          <div className="flex items-center gap-1 rounded-full border border-white/[0.07] bg-ink-850/80 p-1">
            {TABS.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => { setTab(t); sfx.click() }}
                className={`rounded-full px-3 py-1.5 text-[11.5px] font-bold transition ${
                  tab === t ? 'bg-neon-lime text-ink-950' : 'text-slate-400 hover:text-white'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {games.map((g) => (
            <button
              key={g.id}
              type="button"
              onClick={() => onPlay(g.id)}
              className="group relative overflow-hidden rounded-2xl border border-white/[0.07] bg-ink-850 text-left transition duration-300 hover:-translate-y-1.5 hover:border-white/20"
              style={{ transformStyle: 'preserve-3d' }}
            >
              {/* 3D card body — bevel + lift shadow */}
              <span
                aria-hidden
                className="pointer-events-none absolute inset-0 rounded-2xl opacity-0 transition duration-300 group-hover:opacity-100"
                style={{ boxShadow: `0 22px 48px -18px ${g.accent}88, inset 0 1px 0 rgba(255,255,255,.22), inset 0 -2px 0 rgba(0,0,0,.6)` }}
              />
              <div className="relative aspect-[4/3] overflow-hidden">
                <img
                  src={g.art}
                  alt={g.name}
                  loading="lazy"
                  className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.07]"
                  style={{ filter: 'saturate(1.08) contrast(1.04)' }}
                />
                {/* glass sheen across the art */}
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-0 opacity-0 transition duration-500 group-hover:opacity-100"
                  style={{ background: 'linear-gradient(115deg, rgba(255,255,255,.28) 0%, rgba(255,255,255,.06) 28%, transparent 46%)' }}
                />
                <div className="absolute inset-0 bg-gradient-to-t from-ink-950 via-ink-950/25 to-transparent" />
                <div className="absolute left-2 top-2 flex gap-1">
                  {g.hot && (
                    <span className="flex items-center gap-1 rounded-md bg-ink-950/80 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide text-gold backdrop-blur">
                      <IconFlame size={9} /> Hot
                    </span>
                  )}
                  {g.isNew && (
                    <span className="flex items-center gap-1 rounded-md bg-neon-lime px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide text-ink-950">
                      New
                    </span>
                  )}
                </div>
                <div className="absolute right-2 top-2 flex items-center gap-1 rounded-md bg-ink-950/70 px-1.5 py-0.5 text-[9.5px] font-bold text-slate-300 backdrop-blur">
                  <span className="h-1 w-1 rounded-full bg-emerald-400" /> {compact(g.players)}
                </div>
                <div className="absolute inset-0 grid place-items-center opacity-0 transition duration-300 group-hover:opacity-100">
                  <span className="grid h-11 w-11 place-items-center rounded-full bg-neon-lime text-ink-950 shadow-glow">
                    <IconPlay size={17} />
                  </span>
                </div>
              </div>
              <div className="relative -mt-6 px-3 pb-3">
                <p className="text-[13px] font-bold text-white">{g.name}</p>
                <p className="truncate text-[10.5px] text-slate-500">{g.tagline}</p>
                <div className="mt-2 flex items-center justify-between">
                  <span className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[9.5px] font-bold text-slate-400">{g.rtp} RTP</span>
                  <span className="num rounded bg-neon-lime/12 px-1.5 py-0.5 text-[9.5px] font-bold text-neon-lime">{g.maxWin}</span>
                </div>
              </div>
            </button>
          ))}
        </div>

        {/* sports feature -- the board is the growth lever, so it gets a
            full-width band with its own art rather than another grid tile. */}
        <div className="mt-8">
          <a
            href="#sports"
            onClick={(e) => { e.preventDefault(); onSports?.() }}
            className="group relative block overflow-hidden rounded-2xl border border-white/[0.07]"
          >
            <img
              src={SPORTS_HERO}
              alt=""
              loading="lazy"
              decoding="async"
              className="h-[170px] w-full object-cover object-center transition duration-500 group-hover:scale-[1.03] sm:h-[210px]"
            />
            <div className="absolute inset-0 bg-gradient-to-r from-[#070b14] via-[#070b14]/80 to-transparent" />
            <div className="absolute inset-0 flex flex-col justify-center px-5 sm:px-7">
              <span className="mb-1.5 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[.18em] text-neon-lime">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-neon-lime" /> Live this week
              </span>
              <p className="max-w-[260px] text-[19px] font-black leading-tight text-white sm:text-[23px]">
                Premier League, priced to the minute
              </p>
              <p className="mt-1 max-w-[280px] text-[11.5px] leading-relaxed text-slate-400">
                Real bookmaker prices, settled automatically. Bet in UGX, no deposit needed.
              </p>
              <span className="mt-3 inline-flex w-fit items-center gap-1 rounded-lg bg-neon-lime px-3 py-1.5 text-[11.5px] font-black text-ink-950 transition group-hover:brightness-110">
                Open the board <IconArrowUpRight size={13} />
              </span>
            </div>
          </a>
        </div>

        {/* promo strip */}
        <div className="mt-8 grid gap-3 md:grid-cols-3">
          {[
            { icon: <IconBolt size={18} />, t: 'Daily Rakeback', d: 'Up to 12% back on every wager, paid hourly.', cta: 'View games', c: 'from-neon-lime/15', onClick: () => onPlay('crash') },
            { icon: <IconTrophy size={18} />, t: 'Weekly Race', d: 'UGX 50,000 across 100 winners. Ends Sunday.', cta: 'Play now', c: 'from-neon-violet/20', onClick: () => onPlay('crash') },
            { icon: <IconSpade size={18} />, t: 'VIP Club', d: 'Personal host, custom limits and faster payouts.', cta: 'Play now', c: 'from-neon-cyan/20', onClick: () => onPlay('crash') },
            { icon: <IconBolt size={18} />, t: 'ProxiCash', d: 'Convert crypto to UGX on MTN MoMo & Airtel Money.', cta: 'Open ProxiCash', c: 'from-[#26a17b]/25', onClick: () => onProxiCash?.() },
          ].map((p) => (
            <div key={p.t} className={`group relative overflow-hidden rounded-2xl border border-white/[0.07] bg-gradient-to-br ${p.c} via-ink-850 to-ink-850 p-4`}>
              <div className="flex items-center gap-2 text-neon-lime">{p.icon}<span className="text-[13px] font-bold text-white">{p.t}</span></div>
              <p className="mt-1.5 text-[11.5px] leading-relaxed text-slate-400">{p.d}</p>
              <button type="button" onClick={p.onClick} className="mt-3 flex items-center gap-1 text-[11.5px] font-bold text-white transition group-hover:text-neon-lime">
                {p.cta} <IconArrowUpRight size={13} />
              </button>
            </div>
          ))}
        </div>

        {/* live wins table */}
        <div className="mt-8 grid gap-3 lg:grid-cols-[1.5fr_1fr]">
          <div className="panel overflow-hidden">
            <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
              <h3 className="flex items-center gap-2 text-[13px] font-bold text-white"><IconLive size={14} className="text-neon-lime" /> Live wins</h3>
              <span className="chip !border-white/[0.07] normal-case tracking-normal"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" /> streaming</span>
            </div>
            <div className="divide-y divide-white/[0.04]">
              {LIVE_WINS.slice(0, 6).map((w, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="grid h-7 w-7 place-items-center rounded-full bg-gradient-to-br from-neon-cyan/25 to-neon-violet/25 text-[10px] font-black text-white">
                    {w.user.slice(0, 2).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[11.5px] text-slate-300">{w.user}</span>
                  <span className="hidden truncate text-[11px] text-slate-500 sm:block">{w.game}</span>
                  <span className="num text-[11.5px] font-bold text-white">UGX {money(w.amount)}</span>
                  <span className="num w-14 shrink-0 rounded bg-neon-lime/15 py-0.5 text-center text-[10px] font-bold text-neon-lime">{mult(w.mult)}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="panel p-4">
            <h3 className="flex items-center gap-2 text-[13px] font-bold text-white"><IconShield size={14} className="text-emerald-400" /> Why FloatBet</h3>
            <div className="mt-3 space-y-2.5">
              {[
                'Provably fair HMAC-SHA256 engine on every game',
                'Instant deposits & zero-fee withdrawals (~42s)',
                '8 originals + live tables and table games',
                '24/7 support with a dedicated VIP host',
              ].map((t) => (
                <div key={t} className="flex items-start gap-2">
                  <span className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full bg-emerald-500/15 text-emerald-400"><IconCheck size={10} /></span>
                  <p className="text-[11.5px] leading-relaxed text-slate-400">{t}</p>
                </div>
              ))}
            </div>
            <button type="button" onClick={onFair} className="btn-ghost mt-3 w-full !py-2 !text-[11.5px]">
              Inspect the fairness engine <IconChevronLeft size={13} className="rotate-180" />
            </button>
          </div>
        </div>
      </div>

    </div>
  )
}
