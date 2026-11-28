import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { freshSeeds, floats, randomHex, sha256 } from './fair'
import type { BetRecord, FairSeedState, GameId, Stats, Toast } from './types'
import { gameById } from './games'
import { uid } from './format'
import type { ExchangeOrder } from './proxicash'
import {
  FREE_PLAY_REFILL, FREE_PLAY_START, MAX_BET, MIN_BET, type PlayMode,
} from './currency'
import { useAuth } from './auth'

/** Real wallet. Migrated from PX, so the key is bumped deliberately. */
const KEY = 'floatbet.v2'

/**
 * Every new player is granted UGX 1,000 of real money, and the daily bonus is
 * larger than that — deliberately: signing up should not be the reward, showing
 * up should.
 *
 * This replaced a 10,000 PX grant. The migration multiplies any existing PX by
 * the last peg the platform actually used for display (100 PX = 1 UGX), so a
 * player who held 100,000 PX sees UGX 1,000, which is exactly what the UI always
 * told them it was worth.
 */
export const STARTING_UGX = 1000

/** What one PX became on conversion, matching the peg the UI advertised. */
export const PX_PER_UGX_AT_MIGRATION = 100

/** The fake wallet. Separate object, separate key, never mixed with real money. */
type FreePlay = {
  credits: number
  bets: BetRecord[]
  stats: Stats
}

type Persisted = {
  /** Real balance, in whole shillings. */
  balance: number
  mode: PlayMode
  free: FreePlay
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

const emptyFreePlay = (): FreePlay => ({
  credits: FREE_PLAY_START,
  bets: [],
  stats: { ...emptyStats },
})

const defaults = (): Persisted => ({
  balance: STARTING_UGX,
  mode: 'real',
  free: emptyFreePlay(),
  bets: [],
  stats: emptyStats,
  seeds: { serverSeed: randomHex(32), serverSeedHash: '', clientSeed: randomHex(8), nonce: 0, prevServerSeed: null },
  clientSeed: randomHex(8),
  username: '',
  sound: true,
  totalDeposited: 0,
  balanceHidden: false,
  exchanges: [],
})

/**
 * Read a pre-PX-removal wallet and convert it.
 *
 * The old key held PX. Every player-facing surface declared 100 PX = 1 UGX, so
 * that is the rate the conversion uses — a player who saw "100,000 PX" and
 * "≈ UGX 1,000" keeps exactly UGX 1,000. Anything else would be a silent haircut.
 *
 * Bets and stats are converted the same way so the history still adds up.
 */
function migrateLegacy(): Persisted | null {
  try {
    const raw = localStorage.getItem('floatbet.v1')
    if (!raw) return null
    const old = JSON.parse(raw) as Record<string, unknown> & { balance?: number; bets?: BetRecord[] }

    const toUgx = (px: unknown) => Math.max(0, Math.round(Number(px ?? 0) / PX_PER_UGX_AT_MIGRATION))

    const oldBets = Array.isArray(old.bets) ? old.bets : []
    const bets = oldBets.slice(0, 120).map((b) => ({
      ...b,
      wager: toUgx(b.wager),
      payout: toUgx(b.payout),
    }))
    const oldStats = (old.stats ?? {}) as Partial<Stats>

    const d = defaults()
    return {
      ...d,
      ...(old as object),
      // The converted balance is the point of this function; it must win over
      // whatever `...old` would have spread in.
      balance: toUgx(old.balance),
      totalDeposited: toUgx(old.totalDeposited),
      bets,
      stats: {
        ...emptyStats,
        ...oldStats,
        wagered: toUgx(oldStats.wagered),
        profit: toUgx(oldStats.profit),
        biggestWin: toUgx(oldStats.biggestWin),
      },
      mode: 'real',
      free: emptyFreePlay(),
      // PX-era orders were quoted in PX; the page that shows them is gone.
      exchanges: [],
    } as Persisted
  } catch {
    return null
  }
}

function load(): Persisted {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) {
      // No v2 wallet: either brand new, or upgrading from the PX build.
      return migrateLegacy() ?? defaults()
    }
    const parsed = JSON.parse(raw) as Partial<Persisted>
    const d = defaults()
    return {
      ...d,
      ...parsed,
      // Free play must survive as its own object. A shallow spread of a corrupt
      // or partial value would leave `free` undefined and the games would read
      // a real balance for a fake one.
      free: {
        credits: Math.max(0, Math.round(Number(parsed.free?.credits ?? FREE_PLAY_START))),
        bets: Array.isArray(parsed.free?.bets) ? parsed.free!.bets.slice(0, 120) : [],
        stats: { ...emptyStats, ...(parsed.free?.stats ?? {}) },
      },
      mode: parsed.mode === 'free' ? 'free' : 'real',
      stats: { ...emptyStats, ...parsed.stats },
      bets: Array.isArray(parsed.bets) ? parsed.bets.slice(0, 120) : [],
    }
  } catch {
    return migrateLegacy() ?? defaults()
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
  setFairOpen: (v: boolean) => void
  toasts: Toast[]
  toast: (t: Omit<Toast, 'id'>) => void
  dismissToast: (id: string) => void
  /** The balance the games should show and spend: real or free, by mode. */
  playBalance: number
  /**
   * Credit on screen the platform has not recorded.
   *
   * The arcade settles in the browser and writes the result nowhere, so this is
   * the part of the displayed balance that `wallets.balance_px` does not
   * include -- and therefore the part a cashout cannot pay. It exists so the UI
   * can be honest about that instead of letting someone plan around it.
   */
  unsentCredit: number
  /** Stats for the active mode, so free play never inflates real stats. */
  playStats: Stats
  playBets: BetRecord[]
  setMode: (m: PlayMode) => void
  refillFreePlay: () => void
  placeBet: (game: GameId, wager: number) => boolean
  settleBet: (args: SettleArgs) => number
  refundBet: (game: GameId, wager: number) => void
  nextFloats: (count: number) => Promise<number[]>
  rotateSeed: () => Promise<void>
  updateClientSeed: (seed: string) => void
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
  /*
   * THE REAL BALANCE IS THE SERVER'S, NOT THIS FILE'S.
   *
   * The real wallet lived only in localStorage, seeded to STARTING_UGX, and was
   * never read back from the database. So a confirmed top-up credited
   * wallets.balance_px correctly -- order TOP-MWZSSJUU, 600 UGX, ledger +600 --
   * and the app carried on showing the local number. A player who paid and was
   * credited saw their balance not move.
   *
   * It is worse than a stale display: `placeBet` decrements the local balance,
   * so the app would happily let a player stake money the database says they do
   * not have, and block them from staking money it says they do.
   *
   * Free play is untouched. It is a separate object with no server row, which is
   * the whole point of it.
   */
  const { wallet: serverWallet, session } = useAuth()
  const [state, setState] = useState<Persisted>(() => defaults())
  const [hydrated, setHydrated] = useState(false)
  const [walletOpen, setWalletOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [fairOpen, setFairOpen] = useState(false)
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
  /** The last `wallets.balance_px` this tab adopted. Null until the first read. */
  const serverBaselineRef = useRef<number | null>(null)
  /** Gameplay credit the server does not know about yet (see the sync effect). */
  const staleCreditRef = useRef(0)
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

  /*
   * The real balance is the server's.
   *
   * It lived only in localStorage, seeded to STARTING_UGX, and was never read
   * back from the database. A confirmed top-up credited wallets.balance_px and
   * wrote a ledger row (order TOP-MWZSSJUU, UGX 600, +600) while the app went on
   * showing the local number, so a player who had paid saw nothing change.
   *
   * `placeBet` decrements this same value, so it was not only a display bug: the
   * app would let a player stake money the database says they do not have.
   *
   * Free play is untouched. It has no server row, which is the point of it.
   */
  useEffect(() => {
    if (!hydrated || !session?.user || !serverWallet) return
    const server = Math.round(serverWallet.balance_px ?? 0)
    if (!Number.isFinite(server)) return
    if (stateRef.current.balance === server) return

    /*
     * Keep anything the arcade added on top of the server figure.
     *
     * The arcade settles in the browser and writes the result nowhere, so the
     * local number is server + every game result since login. Overwriting it
     * with the server figure -- which is what this did, and what "the balance
     * goes back to the beginning of the session" looked like -- deleted real
     * winnings from the screen. A player who won, refreshed, and found their
     * balance restored to the pre-win figure was seeing this exact line.
     *
     * The distinction that keeps both properties at once:
     *
     *   the server value rising   -> a deposit, a gift or an admin credit.
     *                                Show it immediately. This is the bug that
     *                                started all of this.
     *   the local value rising    -> an arcade win we never sent anywhere.
     *                                Keep it, and remember the offset.
     *
     * The offset resets the moment the server moves, because a server change
     * means the row is authoritative again.
     */
    const prevServer = serverBaselineRef.current
    const local = stateRef.current.balance
    if (prevServer !== null && server === prevServer) {
      // Server has not moved: the difference is unsent gameplay. Preserve it.
      return
    }
    serverBaselineRef.current = server
    const unsent = prevServer === null ? 0 : local - prevServer
    if (unsent !== 0) staleCreditRef.current = unsent
    const next = Math.max(0, server + (unsent > 0 ? unsent : 0))
    stateRef.current = { ...stateRef.current, balance: next }
    setState((prev) => ({ ...prev, balance: next }))
  }, [serverWallet, session?.user, hydrated])

  /*
   * Tell the player when they are holding money the platform cannot see.
   *
   * This is not a display nicety. `wallets.balance_px` is what a cashout is
   * checked against, so arcade winnings above the server figure are not
   * withdrawable, and no code path writes them there. Rather than let someone
   * think they are owed money that will vanish at the cashout screen, the
   * wallet says so.
   */
  const [staleCredit, setStaleCredit] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => {
      const server = serverBaselineRef.current
      if (server === null) return
      const unsent = stateRef.current.balance - server
      if (unsent !== staleCredit) setStaleCredit(unsent > 0 ? unsent : 0)
    }, 2_000)
    return () => window.clearInterval(id)
  }, [staleCredit])

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
      // Real stakes are whole shillings. Free credits are too, so the games read
      // identically in both modes and no rounding difference can leak between
      // them.
      const stake = Math.round(wager)
      if (stake < MIN_BET) {
        toast({ kind: 'error', title: 'Bet too small', body: `The minimum bet is UGX ${MIN_BET}.` })
        return false
      }
      if (stake > MAX_BET) {
        toast({ kind: 'error', title: 'Bet too large', body: `The maximum bet is UGX ${MAX_BET.toLocaleString()}.` })
        return false
      }

      const free = stateRef.current.mode === 'free'
      // Read the balance from the live ref, never from inside the updater: the
      // updater is deferred, so a flag written in there is not visible by the
      // time this function returns.
      const balance = free ? stateRef.current.free.credits : stateRef.current.balance
      if (stake > balance) {
        toast({
          kind: 'error',
          title: 'Insufficient balance',
          body: free
            ? 'Refill your free credits to keep practising.'
            : 'Lower your bet or top up to keep playing.',
        })
        return false
      }

      const key = `${game}:${Date.now()}:${uid()}`
      pendingRef.current.set(key, { wager: stake, game })

      if (free) {
        const next = { ...stateRef.current, free: { ...stateRef.current.free, credits: balance - stake } }
        stateRef.current = next
        setState((s) => ({ ...s, free: { ...s.free, credits: Math.round(s.free.credits - stake) } }))
      } else {
        stateRef.current = { ...stateRef.current, balance: balance - stake }
        setState((s) => ({ ...s, balance: Math.round(s.balance - stake) }))
      }
      return true
    },
    [toast],
  )

  const settleBet = useCallback(
    ({ game, wager, multiplier, detail, silent, nonce }: SettleArgs) => {
      // Whole shillings, in both modes. A payout keeps its fraction until the
      // round is over, then rounds down -- rounding up would pay out more than
      // the multiplier says.
      const payout = Math.floor(wager * multiplier)
      const net = payout - wager
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

      const isFree = stateRef.current.mode === 'free'
      setState((s) => {
        const won = payout > 0
        const streak = won ? s.stats.streak + 1 : 0

        /*
         * Free play keeps its own bets AND its own stats.
         *
         * Mixing them would be the quiet version of the bug this whole change is
         * about: a player could inflate their real wagered/profit/biggest-win
         * numbers in free play, and those numbers drive the profile screen. Each
         * mode counts only itself.
         */
        /*
         * Both branches build their stats explicitly rather than through a
         * shared `bank` variable: the two wallets have different shapes (one has
         * `credits`, the other `balance`) and a union of the two does not
         * typecheck, which is the compiler correctly pointing out that they are
         * not interchangeable.
         */
        const nextStats = (stats: Stats): Stats => ({
          wagered: stats.wagered + wager,
          profit: stats.profit + net,
          biggestWin: Math.max(stats.biggestWin, payout),
          rounds: stats.rounds + 1,
          wins: stats.wins + (won ? 1 : 0),
          streak,
          bestStreak: Math.max(stats.bestStreak, streak),
        })

        // The seed stream is shared, so a free round still advances the
        // verifier. What it must not do is touch the real wallet.
        return isFree
          ? {
              ...s,
              free: {
                credits: Math.round(s.free.credits + payout),
                stats: nextStats(s.free.stats),
                bets: [record, ...s.free.bets].slice(0, 120),
              },
            }
          : {
              ...s,
              balance: Math.round(s.balance + payout),
              stats: nextStats(s.stats),
              bets: [record, ...s.bets].slice(0, 120),
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
    // Refund to whichever wallet was charged. Read from the ref, not inside the
    // updater, for the same reason placeBet does.
    if (stateRef.current.mode === 'free') {
      stateRef.current = {
        ...stateRef.current,
        free: { ...stateRef.current.free, credits: stateRef.current.free.credits + wager },
      }
      setState((s) => ({ ...s, free: { ...s.free, credits: Math.round(s.free.credits + wager) } }))
      return
    }
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

  /*
   * THERE IS NO `deposit` HERE ANY MORE, AND THERE MUST NOT BE.
   *
   * It was `balance += amount` in local state, followed by a toast saying
   * "Deposit confirmed". Nothing was charged, nothing was sent to a payment
   * provider, and the amount came from a number the player typed. The Wallet
   * sheet's Deposit tab called it, so typing any figure credited that figure.
   *
   * The same shape appeared twice more: the Rewards hub's "Collect all" and its
   * per-reward buttons each called it to mint promotional credit out of nothing.
   *
   * A local function that increases a balance without a payment is not a
   * deposit flow with a bug in it; it is a money printer. Balances are now only
   * ever credited by the server, after ZENGAPAY confirms a payment, through
   * apply_gateway_result.
   */

  /**
   * Record a ProxiCash exchange and credit the UGX balance when the payout
   * lands. Crypto converts into shillings; there is no coin to mint.
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
        // External crypto converts into shillings. There is no coin to send out
        // any more, so this is one-directional.
        const delta = Math.round(order.net)
        return { ...s, exchanges, balance: Math.max(0, Math.round(s.balance + delta)) }
      })
      toast({ kind: 'success', title: 'Paid to mobile money', body: 'Funds sent to the wallet.' })
    },
    [toast],
  )

  /**
   * Switch between real money and free play.
   *
   * Nothing is transferred. The two wallets are separate objects, so switching
   * is only a change of which one the games read -- which is exactly why a
   * free-play win can never become a real balance.
   */
  const setMode = useCallback(
    (m: PlayMode) => {
      setState((s) => ({ ...s, mode: m }))
      toast({
        kind: m === 'free' ? 'info' : 'success',
        title: m === 'free' ? 'Free play on' : 'Real money on',
        body: m === 'free'
          ? 'You are playing with practice credits. They cannot be withdrawn.'
          : 'You are playing with your real balance.',
      })
    },
    [toast],
  )

  /** Top free play back up. Touches only the fake wallet, by construction. */
  const refillFreePlay = useCallback(() => {
    setState((s) => ({ ...s, free: { ...s.free, credits: FREE_PLAY_REFILL } }))
    toast({ kind: 'info', title: 'Free credits refilled', body: 'Practice credits are not real money.' })
  }, [toast])

  const toggleSound = useCallback(() => setState((s) => ({ ...s, sound: !s.sound })), [])
  const toggleBalanceHidden = useCallback(() => setState((s) => ({ ...s, balanceHidden: !s.balanceHidden })), [])
  const setUsername = useCallback((v: string) => setState((s) => ({ ...s, username: v.slice(0, 18) })), [])

  const resetAccount = useCallback(() => {
    const d = defaults()
    d.seeds.serverSeedHash = state.seeds.serverSeedHash
    setState(d)
    toast({ kind: 'info', title: 'Account reset', body: `Balance restored to UGX ${STARTING_UGX.toLocaleString()}.` })
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
      toasts,
      toast,
      dismissToast,
      placeBet,
      settleBet,
      refundBet,
      nextFloats,
      rotateSeed,
      updateClientSeed,
      toggleSound,
      toggleBalanceHidden,
      setUsername,
      resetAccount,
      winFlash,
      lossFlash,
      flashLoss,
      recordExchange,
      settleExchange,
      // The games read these, never `balance` directly, so a free-play round
      // physically cannot spend real money.
      playBalance: state.mode === 'free' ? state.free.credits : state.balance,
      // Credit on screen that the platform has not recorded. Surfaced so the
      // wallet can say so instead of letting a player plan around money that
      // will not withdraw.
      unsentCredit: state.mode === 'free' ? 0 : staleCredit,
      playStats: state.mode === 'free' ? state.free.stats : state.stats,
      playBets: state.mode === 'free' ? state.free.bets : state.bets,
      setMode,
      refillFreePlay,
    }),
    [
      state, hydrated, walletOpen, historyOpen, fairOpen, toasts, toast, dismissToast, placeBet, settleBet,
      refundBet, nextFloats, rotateSeed, updateClientSeed, toggleSound, toggleBalanceHidden,
      setUsername, resetAccount, winFlash, lossFlash, flashLoss, recordExchange, settleExchange,
      setMode, refillFreePlay,
    ],
  )

  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>
}

export function useStore() {
  const ctx = useContext(StoreCtx)
  if (!ctx) throw new Error('useStore must be used inside StoreProvider')
  return ctx
}
