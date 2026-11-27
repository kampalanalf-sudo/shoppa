import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../lib/store'
import { sfx } from '../lib/sound'
import { crashPoint } from '../lib/fair'
import { money, mult } from '../lib/format'
import { gameById } from '../lib/games'
import { BetAmount, BetButton } from '../components/BetControls'
import { GameShell, PayoutRow } from '../components/GameShell'
import { IconBolt, IconFlame } from '../components/Icons'

const CW = 700
const CH = 300
const GROWTH = 0.155

const mAt = (t: number) => Math.exp(GROWTH * t)
const tAt = (m: number) => Math.log(m) / GROWTH

type Phase = 'idle' | 'running' | 'crashed' | 'cashed'

export function Crash({ onBack, onFair }: { onBack: () => void; onFair: () => void }) {
  const game = gameById('crash')!
  const { placeBet, settleBet, nextFloats, balance, sound, toast, flashLoss } = useStore()
  const [bet, setBet] = useState(1000)
  const [autoCash, setAutoCash] = useState(2)
  const [autoEnabled, setAutoEnabled] = useState(false)
  const [phase, setPhase] = useState<Phase>('idle')
  const [m, setM] = useState(1)
  const [crashAt, setCrashAt] = useState<number | null>(null)
  const [cashedAt, setCashedAt] = useState<number | null>(null)
  const [history, setHistory] = useState<number[]>([2.41, 1.08, 14.7, 1.92, 3.05, 1.21, 8.44, 1.66])
  const [payout, setPayout] = useState(0)
  const [trail, setTrail] = useState<{ t: number; m: number }[]>([])

  const raf = useRef<number>(0)
  const start = useRef(0)
  const target = useRef(1)
  const cashed = useRef(false)
  const autoRef = useRef({ enabled: false, at: 2 })

  useEffect(() => {
    autoRef.current = { enabled: autoEnabled, at: autoCash }
  }, [autoEnabled, autoCash])

  const settle = useCallback(
    (at: number) => {
      if (cashed.current) return
      cashed.current = true
      const pay = settleBet({ game: 'crash', wager: bet, multiplier: at, detail: `Cashed out at ${mult(at)}` })
      setCashedAt(at)
      setPayout(pay)
      setPhase('cashed')
      if (sound) sfx.cashout()
    },
    [settleBet, bet, sound],
  )

  const play = useCallback(async () => {
    if (phase === 'running') return
    if (bet > balance) {
      toast({ kind: 'error', title: 'Insufficient balance', body: 'Lower your bet or top up your wallet.' })
      return
    }
    if (!placeBet('crash', bet)) return
    sfx.place()
    const [u] = await nextFloats(1)
    const cp = crashPoint(u)
    target.current = cp
    cashed.current = false
    setCrashAt(null)
    setCashedAt(null)
    setPayout(0)
    setTrail([])
    setM(1)
    setPhase('running')
    start.current = performance.now()

    const tick = () => {
      const t = (performance.now() - start.current) / 1000
      const cur = mAt(t)
      if (cur >= target.current) {
        setM(target.current)
        setTrail((p) => [...p.slice(-400), { t: tAt(target.current), m: target.current }])
        setCrashAt(target.current)
        setPhase('crashed')
        setHistory((h) => [target.current, ...h].slice(0, 14))
        if (!cashed.current) {
          settleBet({ game: 'crash', wager: bet, multiplier: 0, detail: `Crashed at ${mult(target.current)}` })
          flashLoss()
          if (sound) sfx.crash()
        }
        return
      }
      setM(cur)
      setTrail((p) => [...p.slice(-400), { t, m: cur }])
      if (autoRef.current.enabled && !cashed.current && cur >= autoRef.current.at && autoRef.current.at < target.current) {
        settle(autoRef.current.at)
      }
      raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
  }, [phase, bet, balance, placeBet, nextFloats, settleBet, sound, toast, settle])

  useEffect(() => () => cancelAnimationFrame(raf.current), [])

  const cashout = () => {
    if (phase !== 'running') return
    settle(m)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return
      if (e.code === 'Space') { e.preventDefault(); if (phase === 'running') cashout(); else void play() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, m, play])

  const maxT = Math.max(6, trail.length ? trail[trail.length - 1].t * 1.12 : 6)
  const maxM = Math.max(2, m * 1.25)
  const path = useMemo(() => {
    if (!trail.length) return ''
    return trail
      .map((p, i) => {
        const x = (p.t / maxT) * CW
        const y = CH - (Math.log(Math.max(1, p.m)) / Math.log(maxM)) * CH
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
      })
      .join(' ')
  }, [trail, maxT, maxM])

  const currentX = ((trail.at(-1)?.t ?? 0) / maxT) * CW
  const currentY = CH - (Math.log(Math.max(1, m)) / Math.log(maxM)) * CH
  const potential = Math.round(bet * m * 100) / 100

  const statusText =
    phase === 'running' ? (cashedAt ? 'Cashed out' : 'In flight')
      : phase === 'crashed' ? 'Flew away'
        : phase === 'cashed' ? 'Secured'
          : 'Ready for takeoff'

  return (
    <GameShell
      game={game}
      onBack={onBack}
      onFair={onFair}
      aside={
        <div className="space-y-3.5">
          <BetAmount value={bet} onChange={setBet} disabled={phase === 'running'} />
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <span className="label">Auto cash out</span>
              <div className="flex items-stretch rounded-xl border border-white/10 bg-ink-900/80 p-1.5">
                <button
                  type="button"
                  onClick={() => setAutoEnabled((v) => !v)}
                  aria-label="Toggle auto cashout"
                  className={`grid h-9 w-9 place-items-center rounded-lg transition ${autoEnabled ? 'bg-neon-lime text-ink-950' : 'bg-white/[0.05] text-slate-400'}`}
                >
                  <IconBolt size={15} />
                </button>
                <input
                  inputMode="decimal"
                  value={autoCash}
                  onChange={(e) => setAutoCash(Math.max(1.01, Math.min(10000, parseFloat(e.target.value.replace(/[^0-9.]/g, '')) || 1.01)))}
                  className="num w-full bg-transparent text-center text-[15px] font-bold text-white focus:outline-none"
                />
                <span className="grid place-items-center pr-1 text-[12px] font-bold text-neon-lime/70">×</span>
              </div>
            </div>
          </div>

          {phase === 'running' && !cashedAt ? (
            <BetButton variant="danger" onClick={cashout} sub={`$UGX {money(potential)}`}>
              Cash out {mult(m)}
            </BetButton>
          ) : (
            <BetButton onClick={() => void play()} loading={false} sub={cashedAt ? `Won $UGX {money(payout)}` : 'Space to launch'}>
              {phase === 'crashed' ? 'Next round' : phase === 'cashed' ? 'Play again' : 'Place bet'}
            </BetButton>
          )}

          {crashAt && (
            <div className="animate-popIn rounded-xl border border-rose-500/25 bg-rose-500/[0.08] px-3 py-2 text-center">
              <p className="text-[10px] uppercase tracking-wider text-rose-300/70">Crashed at</p>
              <p className="num text-xl font-black text-rose-300">{mult(crashAt)}</p>
            </div>
          )}
          {cashedAt && (
            <div className="animate-popIn rounded-xl border border-neon-lime/30 bg-neon-lime/10 px-3 py-2 text-center">
              <p className="text-[10px] uppercase tracking-wider text-neon-lime/70">Cashed out</p>
              <p className="num text-xl font-black text-neon-lime">{mult(cashedAt)}</p>
              <p className="num text-[11px] text-slate-300">+UGX {money(payout)}</p>
            </div>
          )}
          <div className="space-y-1.5">
            <PayoutRow label="House edge" value="1.0%" />
            <PayoutRow label="Max multiplier" value="1,000,000×" />
            <PayoutRow label="Instant cash out" value="Yes" />
          </div>
        </div>
      }
      footer={
        <div className="panel p-3.5">
          <p className="mb-2 text-[11px] font-bold uppercase tracking-[.14em] text-slate-400">Recent rounds</p>
          <div className="flex flex-wrap gap-1">
            {history.slice(0, 12).map((h, i) => (
              <span
                key={`${h}-${i}`}
                className={`num rounded-md px-1.5 py-0.5 text-[10.5px] font-bold ${
                  h >= 10 ? 'bg-neon-violet/20 text-neon-violet'
                    : h >= 2 ? 'bg-neon-lime/15 text-neon-lime'
                      : 'bg-rose-500/15 text-rose-300'
                }`}
              >
                {h.toFixed(2)}×
              </span>
            ))}
          </div>
        </div>
      }
      mobileAction={
        <div className="flex items-center gap-1.5">
          <div className="flex items-center gap-1 rounded-xl border border-white/10 bg-ink-900/90 px-2">
            <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500">Bet</span>
            <input
              inputMode="decimal"
              value={bet}
              onChange={(e) => setBet(Math.max(0, parseFloat(e.target.value.replace(/[^0-9.]/g, '')) || 0))}
              className="num w-16 bg-transparent py-2 text-center text-[13px] font-bold text-white focus:outline-none"
            />
            <span className="text-[9px] font-bold text-neon-lime/70">UGX</span>
          </div>
          {phase === 'running' && !cashedAt ? (
            <button type="button" onClick={cashout} className="btn-danger h-10 flex-1 !text-[13px]">
              Cash out {mult(m)}
            </button>
          ) : (
            <button type="button" onClick={() => void play()} className="btn-primary h-10 flex-1 !text-[13px]">
              {phase === 'crashed' ? 'Next round' : 'Place bet'}
            </button>
          )}
        </div>
      }
    >
      <div className="mb-2 flex items-center justify-between px-1">
        <span className={`flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-[.14em] ${
          phase === 'running' ? 'text-neon-lime' : phase === 'crashed' ? 'text-rose-400' : 'text-slate-500'
        }`}>
          <span className="relative flex h-1.5 w-1.5">
            <span className={`absolute inline-flex h-full w-full rounded-full ${phase === 'running' ? 'animate-ping bg-neon-lime' : 'bg-slate-600'}`} />
            <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${phase === 'running' ? 'bg-neon-lime' : 'bg-slate-600'}`} />
          </span>
          {statusText}
        </span>
        <span className="chip !border-white/[0.07] normal-case tracking-normal">
          <IconFlame size={11} className="text-gold" /> 9,632 in round
        </span>
      </div>

      <div className="relative overflow-hidden rounded-xl border border-white/[0.06] bg-gradient-to-b from-ink-950/80 to-ink-900/40">
        <svg viewBox={`0 0 ${CW} ${CH}`} className="w-full" role="img" aria-label="Multiplier graph">
          <defs>
            <linearGradient id="crashLine" x1="0" y1="1" x2="1" y2="0">
              <stop offset="0" stopColor="#3ad7ff" />
              <stop offset="0.55" stopColor="#c6f24e" />
              <stop offset="1" stopColor="#ff4fa3" />
            </linearGradient>
            <linearGradient id="crashFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="rgba(198,242,78,.28)" />
              <stop offset="1" stopColor="rgba(198,242,78,0)" />
            </linearGradient>
          </defs>

          {[0.25, 0.5, 0.75, 1].map((f) => (
            <line key={f} x1={0} x2={CW} y1={CH * f} y2={CH * f} stroke="rgba(255,255,255,.05)" strokeWidth={1} />
          ))}
          {[0.25, 0.5, 0.75, 1].map((f) => (
            <line key={f} x1={CW * f} x2={CW * f} y1={0} y2={CH} stroke="rgba(255,255,255,.04)" strokeWidth={1} />
          ))}

          {path && (
            <>
              <path d={`${path} L${currentX},${CH} L0,${CH} Z`} fill="url(#crashFill)" />
              <path d={path} fill="none" stroke="url(#crashLine)" strokeWidth={3.4} strokeLinecap="round" style={{ filter: 'drop-shadow(0 0 10px rgba(198,242,78,.65))' }} />
            </>
          )}

          {phase !== 'idle' && (
            <g transform={`translate(${Math.min(currentX, CW - 6)},${Math.max(6, currentY)})`}>
              <circle r={9} fill="rgba(198,242,78,.22)" />
              <circle r={4.6} fill="#c6f24e" />
            </g>
          )}
        </svg>

        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="text-center">
            <p
              className={`num text-[46px] font-black leading-none tracking-tight sm:text-[62px] ${
                phase === 'crashed' ? 'text-rose-400' : 'text-white'
              }`}
              style={{ textShadow: phase === 'running' ? '0 0 40px rgba(198,242,78,.55)' : phase === 'crashed' ? '0 0 40px rgba(244,63,94,.5)' : 'none' }}
            >
              {phase === 'crashed' ? `${mult(crashAt ?? 1)}` : `${mult(m)}`}
            </p>
            <p className={`mt-1 text-[11px] font-bold uppercase tracking-[.2em] ${
              phase === 'crashed' ? 'text-rose-300/80' : phase === 'cashed' ? 'text-neon-lime/80' : 'text-slate-500'
            }`}>
              {phase === 'crashed' ? 'Flew away' : phase === 'cashed' ? `Cashed out ${mult(cashedAt ?? 1)}` : phase === 'running' ? 'Rising' : 'Place a bet to launch'}
            </p>
          </div>
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2">
        <span className="text-[11px] text-slate-500">Potential payout</span>
        <span className="num text-[13px] font-bold text-neon-lime">UGX {money(potential)}</span>
      </div>
    </GameShell>
  )
}
