import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { freshSeeds, floats, randomHex, sha256 } from './fair'
import type { BetRecord, FairSeedState, GameId, Stats, Toast } from './types'
import { gameById } from './games'
import { uid } from './format'
import type { ExchangeOrder } from './proxicash'

const KEY = 'floatbet.v1'

type Persisted = {
  balance: number
  bets: BetRecord[]
  stats: Stats
  seeds: FairSeedState
  clientSeed: string
  username: string
  sound: boolean
  totalDeposited: number
  balanceHidden: boolean
  /** ProxiCash crypto -> mobile money orders */
  exchanges: ExchangeOrder[]
}

const emptyStats: Stats = {
  wagered: 0,
  profit: 0,
  biggestWin: 0,
  rounds: 0,
  wins: 0,
  streak: 0,
  bestStreak: 0,
}

const defaults = (): Persisted => ({
  balance: 2500000,
  bets: [],
  stats: emptyStats,
  seeds: { serverSeed: randomHex(32), serverSeedHash: '', clientSeed: randomHex(8), nonce: 0, prevServerSeed: null },
  clientSeed: randomHex(8),
  username: 'FloatGuest',
  sound: true,
  totalDeposited: 0,
  balanceHidden: false,
  exchanges: [],
})

function load(): Persisted {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return defaults()
    const parsed = JSON.parse(raw) as Persisted
    return {
      ...defaults(),
      ...parsed,
      stats: { ...emptyStats, ...parsed.stats },
      bets: Array.isArray(parsed.bets) ? parsed.bets.slice(0, 120) : [],
    }
  } catch {
    return defaults()
  }
}

type SettleArgs = {
  game: GameId
  wager: number
  multiplier: number
  detail: string
  /** Suppress celebration toasts/flashes (used for intermediate states). */
  silent?: boolean
  /** Nonce that produced this outcome (for the verifier). */
  nonce?: number
}

type Ctx = Persisted & {
  hydrated: boolean
  walletOpen: boolean
  setWalletOpen: (v: boolean) => void
  historyOpen: boolean
  setHistoryOpen: (v: boolean) => void
  fairOpen: boolean
  rewardsOpen: boolean
  setRewardsOpen: (v: boolean) => void
  setFairOpen: (v: boolean) => void
  toasts: Toast[]
  toast: (t: Omit<Toast, 'id'>) => void
  dismissToast: (id: string) => void
  placeBet: (game: GameId, wager: number) => boolean
  settleBet: (args: SettleArgs) => number
  refundBet: (game: GameId, wager: number) => void
  nextFloats: (count: number) => Promise<number[]>
  rotateSeed: () => Promise<void>
  updateClientSeed: (seed: string) => void
  deposit: (amount: number) => void
  withdraw: (amount: number) => boolean
  toggleSound: () => void
  toggleBalanceHidden: () => void
  setUsername: (v: string) => void
  resetAccount: () => void
  winFlash: number | null
  lossFlash: boolean
  flashLoss: () => void
  /** ProxiCash crypto -> mobile money orders */
  exchanges: ExchangeOrder[]
  recordExchange: (order: ExchangeOrder) => void
  settleExchange: (id: string) => void
}

const StoreCtx = createContext<Ctx | null>(null)

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<Persisted>(() => defaults())
  const [hydrated, setHydrated] = useState(false)
  const [walletOpen, setWalletOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [fairOpen, setFairOpen] = useState(false)
  const [rewardsOpen, setRewardsOpen] = useState(false)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [winFlash, setWinFlash] = useState<number | null>(null)
  const [lossFlash, setLossFlash] = useState(false)
  const pendingRef = useRef<Map<string, { wager: number; game: GameId }>>(new Map())
  const nonceRef = useRef(0)
  const clientSeedRef = useRef('')
  const prevBetsRef = useRef<BetRecord[]>([])
  /** Live mirror of persisted state. setState updaters run during render, so
   *  an action cannot rely on a flag it sets inside one to read back. */
  const stateRef = useRef<Persisted>(state)
  const nonceUsedRef = useRef(0)
  const flashTimer = useRef<number | null>(null)

  /* hydrate + commit server seed hash */
  useEffect(() => {
    let alive = true
    ;(async () => {
      const loaded = load()
      if (!loaded.seeds.serverSeedHash) loaded.seeds.serverSeedHash = await sha256(loaded.seeds.serverSeed)
      if (alive) {
        setState(loaded)
        setHydrated(true)
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  /* persist */
  useEffect(() => {
    if (!hydrated) return
    try {
      localStorage.setItem(KEY, JSON.stringify(state))
    } catch {
      /* storage full / disabled */
    }
  }, [state, hydrated])

  nonceRef.current = state.seeds.nonce
  clientSeedRef.current = state.clientSeed
  prevBetsRef.current = state.bets
  stateRef.current = state

  const toast = useCallback((t: Omit<Toast, 'id'>) => {
    const id = uid()
    setToasts((prev) => [...prev.slice(-3), { ...t, id }])
    window.setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), 4200)
  }, [])

  const dismissToast = useCallback((id: string) => setToasts((p) => p.filter((t) => t.id !== id)), [])

  const placeBet = useCallback(
    (game: GameId, wager: number) => {
      if (!(wager > 0)) {
        toast({ kind: 'error', title: 'Invalid bet', body: 'Enter a wager greater than zero.' })
        return false
      }
      // Read the balance from the live ref, never from inside the updater: the
      // updater is deferred, so a flag written in there is not visible by the
      // time this function returns.
      const balance = stateRef.current.balance
      if (wager > balance) {
        toast({ kind: 'error', title: 'Insufficient balance', body: 'Lower your bet or top up to keep playing.' })
        return false
      }
      const key = `${game}:${Date.now()}:${uid()}`
      pendingRef.current.set(key, { wager, game })
      stateRef.current = { ...stateRef.current, balance: Math.round(balance - wager) }
      setState((s) => ({ ...s, balance: Math.round((s.balance - wager) * 100) / 100 }))
      return true
    },
    [toast],
  )

  const settleBet = useCallback(
    ({ game, wager, multiplier, detail, silent, nonce }: SettleArgs) => {
      const payout = Math.round(wager * multiplier * 100) / 100
      const net = Math.round((payout - wager) * 100) / 100
      const prevHash = prevBetsRef.current[0]?.hash ?? ''
      const record: BetRecord = {
        id: uid(),
        game,
        gameName: gameById(game)?.name ?? game,
        wager,
        payout,
        multiplier,
        detail,
        won: payout > 0,
        ts: Date.now(),
        nonce: nonce ?? nonceUsedRef.current,
        clientSeed: clientSeedRef.current,
        hash: prevHash,
      }
      setState((s) => {
        const won = payout > 0
        const streak = won ? s.stats.streak + 1 : 0
        return {
          ...s,
          balance: Math.round((s.balance + payout) * 100) / 100,
          bets: [record, ...s.bets].slice(0, 120),
          stats: {
            wagered: Math.round((s.stats.wagered + wager) * 100) / 100,
            profit: Math.round((s.stats.profit + net) * 100) / 100,
            biggestWin: Math.max(s.stats.biggestWin, payout),
            rounds: s.stats.rounds + 1,
            wins: s.stats.wins + (won ? 1 : 0),
            streak,
            bestStreak: Math.max(s.stats.bestStreak, streak),
          },
        }
      })
      if (multiplier >= 10 && !silent) {
        setWinFlash(payout)
        if (flashTimer.current) window.clearTimeout(flashTimer.current)
        flashTimer.current = window.setTimeout(() => setWinFlash(null), 2600)
      }
      return payout
    },
    [],
  )

  const flashLoss = useCallback(() => {
    setLossFlash(true)
    if (flashTimer.current) window.clearTimeout(flashTimer.current)
    flashTimer.current = window.setTimeout(() => setLossFlash(false), 420)
  }, [])

  const refundBet = useCallback((game: GameId, wager: number) => {
    setState((s) => ({ ...s, balance: Math.round(s.balance + wager) }))
  }, [])

  const nextFloats = useCallback(
    async (count: number) => {
      const { seeds, clientSeed } = state
      const nonce = seeds.nonce + 1
      // recorded synchronously so settleBet can attach the exact nonce used
      nonceUsedRef.current = nonce
      setState((s) => ({ ...s, seeds: { ...s.seeds, nonce } }))
      return floats(seeds.serverSeed, clientSeed, nonce, count)
    },
    [state.seeds, state.clientSeed],
  )

  const rotateSeed = useCallback(async () => {
    const fresh = await freshSeeds(state.clientSeed)
    setState((s) => ({
      ...s,
      seeds: {
        serverSeed: fresh.serverSeed,
        serverSeedHash: fresh.serverSeedHash,
        clientSeed: fresh.clientSeed,
        nonce: 0,
        prevServerSeed: s.seeds.serverSeed,
      },
    }))
    toast({ kind: 'success', title: 'Seed rotated', body: 'Previous server seed revealed below.' })
  }, [state.clientSeed, toast])

  const updateClientSeed = useCallback((seed: string) => {
    const clean = seed.trim().slice(0, 64) || randomHex(8)
    setState((s) => ({ ...s, clientSeed: clean, seeds: { ...s.seeds, clientSeed: clean, nonce: 0 } }))
  }, [])

  const deposit = useCallback(
    (amount: number) => {
      setState((s) => ({
        ...s,
        balance: Math.round(s.balance + amount),
        totalDeposited: Math.round(s.totalDeposited + amount),
      }))
      toast({ kind: 'success', title: 'Deposit confirmed', body: `${amount.toLocaleString()} PX added to your balance.` })
    },
    [toast],
  )

  const withdraw = useCallback(
    (amount: number) => {
      const balance = stateRef.current.balance
      if (!(amount > 0) || amount > balance) {
        toast({ kind: 'error', title: 'Insufficient balance', body: 'Reduce the amount and try again.' })
        return false
      }
      stateRef.current = { ...stateRef.current, balance: Math.round(balance - amount) }
      setState((s) => ({ ...s, balance: Math.round(s.balance - amount) }))
      toast({ kind: 'success', title: 'Withdrawal submitted', body: `${amount.toLocaleString()} PX is on the way.` })
      return true
    },
    [toast],
  )

  /**
   * Record a ProxiCash exchange and credit the ProxiCoin balance when the
   * payout lands. Sending ProxiCoin to mobile money spends from the balance;
   * sending external crypto mints ProxiCoin instead.
   */
  const recordExchange = useCallback(
    (order: ExchangeOrder) => {
      setState((s) => ({ ...s, exchanges: [order, ...s.exchanges].slice(0, 50) }))
      toast({
        kind: 'info',
        title: 'Exchange created',
        body: `${order.id} · ${order.rail} payout to ${order.phone}.`,
      })
    },
    [toast],
  )

  const settleExchange = useCallback(
    (id: string) => {
      setState((s) => {
        const order = s.exchanges.find((e) => e.id === id)
        if (!order || order.status === 'paid') return s
        const exchanges = s.exchanges.map((e) => (e.id === id ? { ...e, status: 'paid' as const } : e))
        // PX sent out reduces the coin balance; external crypto converts into PX
        const delta = order.asset === 'PX' ? -order.send : Math.round(order.net)
        return { ...s, exchanges, balance: Math.max(0, Math.round(s.balance + delta)) }
      })
      toast({ kind: 'success', title: 'Paid to mobile money', body: 'Funds sent to the wallet.' })
    },
    [toast],
  )

  const toggleSound = useCallback(() => setState((s) => ({ ...s, sound: !s.sound })), [])
  const toggleBalanceHidden = useCallback(() => setState((s) => ({ ...s, balanceHidden: !s.balanceHidden })), [])
  const setUsername = useCallback((v: string) => setState((s) => ({ ...s, username: v.slice(0, 18) })), [])

  const resetAccount = useCallback(() => {
    const d = defaults()
    d.seeds.serverSeedHash = state.seeds.serverSeedHash
    setState(d)
    toast({ kind: 'info', title: 'Demo account reset', body: 'Balance restored to 2,500,000 PX.' })
  }, [state.seeds.serverSeedHash, toast])

  const value = useMemo<Ctx>(
    () => ({
      ...state,
      hydrated,
      walletOpen,
      setWalletOpen,
      historyOpen,
      setHistoryOpen,
      fairOpen,
      setFairOpen,
      rewardsOpen,
      setRewardsOpen,
      toasts,
      toast,
      dismissToast,
      placeBet,
      settleBet,
      refundBet,
      nextFloats,
      rotateSeed,
      updateClientSeed,
      deposit,
      withdraw,
      toggleSound,
      toggleBalanceHidden,
      setUsername,
      resetAccount,
      winFlash,
      lossFlash,
      flashLoss,
      recordExchange,
      settleExchange,
    }),
    [
      state, hydrated, walletOpen, historyOpen, fairOpen, rewardsOpen, toasts, toast, dismissToast, placeBet, settleBet,
      refundBet, nextFloats, rotateSeed, updateClientSeed, deposit, withdraw, toggleSound, toggleBalanceHidden,
      setUsername, resetAccount, winFlash, lossFlash, flashLoss, recordExchange, settleExchange,
    ],
  )

  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>
}

export function useStore() {
  const ctx = useContext(StoreCtx)
  if (!ctx) throw new Error('useStore must be used inside StoreProvider')
  return ctx
}
