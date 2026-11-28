// supabase/functions/_shared/games.ts
//
// THE payout rules, as one function, shared by the server that settles and the
// browser that animates.
//
// WHY THIS MODULE EXISTS
//
// The arcade used to settle entirely in the browser: `settleRound` credited
//   payout = floor(wager * multiplier)
// with `multiplier` supplied by the caller. That is a printer. It also meant a
// game result lived only in one browser's localStorage, which is why a refresh
// appeared to erase a win and why the same deposit could be staked twice.
//
// The fix is that the SERVER decides. It holds the seed, derives the floats,
// applies these rules, and writes the balance. The browser receives an outcome
// and animates it; it never sends a multiplier.
//
// To keep the animation honest the browser must be able to predict the result
// before the server replies, so both sides run THIS code over the same inputs.
// Divergence would show as a wheel landing on a number the server did not pay
// for, so there is exactly one implementation and the client imports it.
//
// The type shapes are deliberately plain (no imports from either side) so this
// file compiles under both `tsc -b` and the Deno edge bundler.

/**
 * Must stay a superset of `src/lib/types.ts` GameId. That type is the arcade's
 * catalogue; this one only has to be able to *name* anything in it, because most
 * of the catalogue is not server-settled. A slot board cannot be derived from a
 * single float without rewriting its rules here, so it is named and refused
 * rather than silently improvised.
 */
export type GameId =
  | 'dice' | 'limbo' | 'wheel' | 'plinko' | 'roulette' | 'crash'
  | 'mines' | 'tower' | 'bonni' | 'craters'
  | 'chape' | 'bluemountain' | 'bazaar' | 'boda'

/**
 * Every game on the floor settles on the server.
 *
 * The six video slots were the last holdouts: their rules lived in src/lib/slots
 * and the browser spun them, so they could not be played for money and the app
 * had to label them "demo". That label was never the fix. The rules turned out
 * to be portable — pure functions, no DOM, with the artwork the only thing tying
 * them to Vite — and the edge bundle now runs the SAME code via
 * _shared/slots.ts. `npm run test:slotvalue` compares 720 spins between the
 * server and the board and requires identical multipliers.
 */
export const SERVER_SETTLED: readonly GameId[] = [
  'dice', 'limbo', 'wheel', 'plinko', 'roulette', 'crash', 'mines', 'tower',
  'bonni', 'craters', 'chape', 'bluemountain', 'bazaar', 'boda',
]

/**
 * Games that settle in the browser. Empty, and kept so that adding one has a
 * named place to go — with the consequence spelled out: anything here cannot be
 * played for money.
 */
export const LOCAL_ONLY: readonly GameId[] = []

/**
 * House edge, matching the arcade's existing tables.
 *
 * Dice and limbo both use 0.99. Roulette returns the same rate through its
 * wheel: 37 slots paying 36x on a straight is 36/37 = 0.973, which is what the
 * published table already implies, so nothing here changes a player's odds.
 */
export const EDGE = 0.99

export const MIN_BET = 100
export const MAX_BET = 100_000

/**
 * A bet parameter, validated.
 *
 * Every one of these is checked on the server. A `target` outside the legal
 * range is not a cosmetic problem: dice pays 0.99 / (target/100), so a target of
 * 0.01 would pay 9900x.
 */
export type Params = {
  /** dice: roll over/under `target` (0–100, exclusive bounds enforced) */
  mode?: 'under' | 'over'
  target?: number
  /** wheel: segment to land on; plinko: row bucket; roulette: wheel index */
  index?: number
  /** plinko: number of rows */
  rows?: number
  /** plinko: risk level, which selects the paytable */
  risk?: PlinkoRisk
  /** crash: the multiplier the player cashed out at, as a string-free number */
  cashedAt?: number
  /** roulette: the slip. Each leg is a bet kind and a stake; never a payout. */
  bets?: RouletteBet[]
}

export type Outcome = {
  game: GameId
  /** The float the outcome came from, [0,1). Published so the result is checkable. */
  u: number
  /** Total return as a multiple of the stake. 0 means a loss. */
  multiplier: number
  /** Human-readable detail, stored on the round for the player's history. */
  detail: string
  /** Any extra the UI needs to animate the same result (wheel index, etc). */
  payload?: Record<string, number | string>
}

export const r2 = (n: number) => Math.round(n * 100) / 100
const clampInt = (n: unknown, lo: number, hi: number, fallback: number) => {
  const v = typeof n === 'number' && Number.isFinite(n) ? Math.trunc(n) : fallback
  return Math.min(hi, Math.max(lo, v))
}

/** Validate the parameters a game needs. Throws with a player-readable reason. */
export function validateParams(game: GameId, p: Params): Params {
  switch (game) {
    case 'dice': {
      const mode = p.mode === 'over' ? 'over' : 'under'
      const target = typeof p.target === 'number' && Number.isFinite(p.target) ? p.target : 50
      // Both the chance and the payout depend on this, so a bad window is a
      // money bug: target 0 would divide by zero, target 0.5 pays 198x.
      if (!(target >= 2 && target <= 98)) {
        throw new Error('dice target must be between 2 and 98')
      }
      return { mode, target: r2(target) }
    }
    case 'limbo': {
      const target = typeof p.target === 'number' && Number.isFinite(p.target) ? p.target : 2
      if (!(target >= 1.01 && target <= 1_000_000)) throw new Error('limbo target must be between 1.01 and 1,000,000')
      return { target: r2(target) }
    }
    case 'wheel': {
      const index = clampInt(p.index, 0, WHEEL_SEGMENTS.length - 1, -1)
      if (index < 0) throw new Error('choose a wheel segment')
      return { index }
    }
    case 'plinko': {
      const rows = [8, 12, 16].includes(Number(p.rows)) ? Number(p.rows) : 12
      const risk: PlinkoRisk = p.risk === 'low' || p.risk === 'high' ? p.risk : 'medium'
      // The bucket is the SERVER's to derive from the float; a caller-supplied
      // one would be naming its own payout.
      return { rows, risk }
    }
    case 'roulette': {
      if (!Array.isArray(p.bets) || p.bets.length === 0) throw new Error('place at least one bet')
      if (p.bets.length > 24) throw new Error('too many separate bets on one spin')
      const bets = p.bets.map((b) => {
        const kind = String(b?.kind || '')
        if (!(kind in ROULETTE_PAYOUTS)) throw new Error('unknown roulette bet')
        const amount = Math.round(Number(b?.amount))
        if (!Number.isFinite(amount) || amount <= 0) throw new Error('every bet needs a stake')
        if (kind === 'straight') {
          const n = Math.trunc(Number(b?.n))
          if (!(n >= 0 && n <= 36)) throw new Error('straight bets need a number from 0 to 36')
          return { kind, n, amount }
        }
        return { kind, amount }
      })
      return { bets }
    }
    case 'crash': {
      const raw = typeof p.cashedAt === 'number' && Number.isFinite(p.cashedAt) ? p.cashedAt : -1
      // 0 is a real answer: "the player never cashed out", which loses. Anything
      // else must be a legal multiplier.
      if (raw !== 0 && !(raw >= 1 && raw <= 1_000_000)) {
        throw new Error('cash out at 1.00x or higher')
      }
      return { cashedAt: raw === 0 ? 0 : r2(raw) }
    }
    default:
      throw new Error('that game is not settled by the server')
  }
}

// ---------------------------------------------------------------- the maths --

export const limboPoint = (u: number) => Math.max(1, Math.floor((EDGE / (1 - u)) * 100) / 100)
export const crashPoint = (u: number) => (u < 0.03 ? 1 : Math.max(1, Math.floor((EDGE / (1 - u)) * 100) / 100))
export const diceRoll = (u: number) => Math.round(u * 10000) / 100

/**
 * Fortune Wheel: 80 physical slices, audited layout, EV exactly 0.99.
 *
 *   0x x19 · 0.5x x10 · 1.2x x26 · 1.5x x22 · 2x x1 · 3x x1 · 5x x1
 *
 * The order is built the same deterministic way the board builds it (seeded
 * Fisher-Yates with the jackpot forced last), so a slot index means the same
 * thing on both sides. An earlier draft of this file carried a different wheel;
 * that would have paid a multiplier the board never showed, which is the exact
 * class of bug reading the real table prevents.
 */
export const WHEEL_LAYOUT: readonly [number, number][] = [
  [0, 19], [0.5, 10], [1.2, 26], [1.5, 22], [2, 1], [3, 1], [5, 1],
]

export const WHEEL_SEGMENTS: readonly number[] = (() => {
  const TOTAL = 80
  const NULLS = 19
  const wins: number[] = []
  for (const [m, n] of WHEEL_LAYOUT) if (m > 0) for (let i = 0; i < n; i++) wins.push(m)

  // Same PRNG and same shuffle as src/games/Wheel.tsx. It must be identical:
  // the index the server picks is the slice the board rotates to.
  let seed = 1337
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
  for (let i = wins.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[wins[i], wins[j]] = [wins[j], wins[i]]
  }

  const out: number[] = []
  let nullsUsed = 0
  let wi = 0
  for (let p = 0; p < TOTAL; p++) {
    if (p % 4 === 0 && nullsUsed < NULLS) {
      out.push(0)
      nullsUsed++
    } else if (wi < wins.length) {
      out.push(wins[wi++])
    }
  }
  while (out.length < TOTAL) out.push(0)

  const big = out.lastIndexOf(5)
  if (big >= 0 && big !== out.length - 1) {
    out[big] = out[out.length - 1]
    out[out.length - 1] = 5
  }
  return out
})()

/**
 * Plinko paytables, ported verbatim from the board.
 *
 * Three risk levels x three row counts. Every one sums to 0.99 under the
 * binomial bucket distribution, which is why they must not be "approximated" on
 * the server: a single wrong coefficient pays the wrong multiplier on a board
 * the player can see. An earlier draft of this file carried one invented table,
 * which is exactly the failure this comment exists to prevent.
 */
export type PlinkoRisk = 'low' | 'medium' | 'high'

export const PLINKO_TABLES: Record<PlinkoRisk, Record<number, readonly number[]>> = {
  low: {
    8: [2.02, 1.33, 1.05, 0.94, 0.91, 0.94, 1.05, 1.33, 2.02],
    12: [2.09, 1.55, 1.25, 1.08, 0.99, 0.96, 0.94, 0.96, 0.99, 1.08, 1.25, 1.55, 2.09],
    16: [2.12, 1.68, 1.4, 1.21, 1.1, 1.02, 0.98, 0.97, 0.96, 0.97, 0.98, 1.02, 1.1, 1.21, 1.4, 1.68, 2.12],
  },
  medium: {
    8: [10.14, 3.18, 1.27, 0.67, 0.52, 0.67, 1.27, 3.18, 10.14],
    12: [15.47, 6.56, 3.11, 1.67, 1.02, 0.72, 0.62, 0.72, 1.02, 1.67, 3.11, 6.56, 15.47],
    16: [20.52, 10.29, 5.51, 3.16, 1.95, 1.3, 0.94, 0.76, 0.68, 0.76, 0.94, 1.3, 1.95, 3.16, 5.51, 10.29, 20.52],
  },
  high: {
    8: [23.01, 4.93, 1.25, 0.4, 0.2, 0.4, 1.25, 4.93, 23.01],
    12: [69.35, 19.98, 6.26, 2.17, 0.84, 0.38, 0.24, 0.38, 0.84, 2.17, 6.26, 19.98, 69.35],
    16: [166.75, 58.71, 21.6, 8.34, 3.41, 1.49, 0.7, 0.37, 0.24, 0.37, 0.7, 1.49, 3.41, 8.34, 21.6, 58.71, 166.75],
  },
}

export const plinkoTable = (risk: PlinkoRisk, rows: number): readonly number[] =>
  PLINKO_TABLES[risk]?.[rows] ?? PLINKO_TABLES.medium[12]

/**
 * The bucket a float sends the ball to.
 *
 * The board walks the float's binary expansion — each row is one bit — and the
 * number of right-hand steps is the bucket. Reimplemented here so the server
 * picks the same bucket the animation lands in; a flat `floor(u * buckets)`
 * would look identical on average and disagree on every individual ball.
 */
export function plinkoBucket(u: number, rows: number, buckets: number): number {
  let bits = u
  let sum = 0
  for (let i = 0; i < rows; i++) {
    bits = bits * 2
    if (bits >= 1) {
      sum++
      bits -= 1
    }
  }
  return Math.max(0, Math.min(buckets - 1, sum))
}

// ------------------------------------------------------- board games ---------
//
// MINES and TOWER are different from the games above: their outcome is not one
// float but a hidden BOARD that a player explores over several moves. The server
// must hold the board and reveal one cell at a time, because a client that knows
// where the mines are will always cash out on time.
//
// Everything below is ported from src/games/Mines.tsx and src/games/Tower.tsx,
// including the shuffle, so the layout the server builds is the layout the board
// draws. An approximation here pays the wrong multiplier, which is exactly the
// wheel bug again.

export const MINE_GRID = 25
export const MINE_CHOICES = [1, 3, 5, 10, 15, 20, 24] as const

/**
 * Standard mines payout: 0.99 / P(surviving n picks),
 * P = prod (safeRemaining / tilesRemaining) — matches C(25-mines, picks)/C(25, picks).
 */
export function minesMultiplier(mines: number, picks: number): number {
  if (picks <= 0) return 1
  let p = 1
  for (let i = 0; i < picks; i++) p *= (MINE_GRID - mines - i) / (MINE_GRID - i)
  if (p <= 0) return 0
  return Math.max(1, Math.round((EDGE / p) * 100) / 100)
}

/**
 * Unbiased Fisher-Yates, one float per step.
 *
 * Identical to the component's: it consumes GRID floats and walks from the end,
 * which is why the server needs 25 of them and not one.
 */
export function mineLayout(floats: number[], mines: number): number[] {
  const positions = Array.from({ length: MINE_GRID }, (_, i) => i)
  for (let i = positions.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(floats[i] * (i + 1)))
    ;[positions[i], positions[j]] = [positions[j], positions[i]]
  }
  return positions.slice(0, mines)
}

export const TOWER_LEVELS = 8

/** Easy: 4 tiles / 3 safe · Medium: 3 / 2 · Hard: 2 / 1. */
export const towerCols = (difficulty: number) => 5 - difficulty

export function towerLevelMultiplier(difficulty: number, level: number): number {
  const cols = towerCols(difficulty)
  const safe = cols - 1
  let m = EDGE
  for (let i = 0; i < level; i++) m *= cols / safe
  return Math.round(Math.max(1, m) * 100) / 100
}

/**
 * One safe tile per floor, exactly as the component draws it.
 *
 * The component calls this the "safe set" and reveals the tile for the floor the
 * player is on; a floor's other tiles are fatal. Built from LEVELS floats.
 */
export function towerLayout(floats: number[], difficulty: number): number[] {
  const cols = towerCols(difficulty)
  const safe: number[] = []
  for (let i = 0; i < TOWER_LEVELS; i++) {
    const u = floats[i] ?? 0
    safe.push(Math.min(cols - 1, Math.floor(u * cols)))
  }
  return safe
}

/** How many floats each board game needs from the seed stream. */
export const floatsNeeded = (game: GameId): number => {
  if (game === 'mines') return MINE_GRID
  if (game === 'tower') return TOWER_LEVELS
  return 1
}

export const RED_NUMBERS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36])

/** European wheel order. The index the server picks maps to this array. */
export const ROULETTE_WHEEL: readonly number[] = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5,
  24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
]

export const rouletteColour = (n: number) => (n === 0 ? 'green' : RED_NUMBERS.has(n) ? 'red' : 'black')

export const ROULETTE_PAYOUTS: Record<string, number> = {
  straight: 36, red: 2, black: 2, odd: 2, even: 2, low: 2, high: 2,
  dozen1: 3, dozen2: 3, dozen3: 3,
}

/** One leg of a roulette slip. */
export type RouletteBet = { kind: string; n?: number; amount: number }

/**
 * What a slip returns for the number that came up, as a total return on the
 * stake.
 *
 * Roulette is not one bet, so it cannot be settled from a single multiplier: a
 * player can cover a dozen and a colour at once. The slip is validated and
 * priced here, from the number the server drew, which is the only way the
 * payout can depend on something the player does not choose.
 */
export function rouletteReturn(bets: RouletteBet[], n: number, stake: number): number {
  const colour = rouletteColour(n)
  let payout = 0
  for (const b of bets) {
    const won =
      (b.kind === 'straight' && b.n === n) ||
      (b.kind === 'red' && colour === 'red') ||
      (b.kind === 'black' && colour === 'black') ||
      (b.kind === 'odd' && n !== 0 && n % 2 === 1) ||
      (b.kind === 'even' && n !== 0 && n % 2 === 0) ||
      (b.kind === 'low' && n >= 1 && n <= 18) ||
      (b.kind === 'high' && n >= 19 && n <= 36) ||
      (b.kind === 'dozen1' && n >= 1 && n <= 12) ||
      (b.kind === 'dozen2' && n >= 13 && n <= 24) ||
      (b.kind === 'dozen3' && n >= 25 && n <= 36)
    if (won) payout += b.amount * (ROULETTE_PAYOUTS[b.kind] ?? 0)
  }
  return stake > 0 ? Math.round((payout / stake) * 100) / 100 : 0
}

/**
 * Turn a float into a settled outcome.
 *
 * Pure: same inputs, same answer, on the server and in the browser. Everything
 * that decides money is here, and none of it reads a parameter the player could
 * use to name their own payout.
 */
export function resolveBet(game: GameId, p: Params, u: number): Outcome {
  const safeU = Math.min(0.999999999, Math.max(0, u))
  switch (game) {
    case 'dice': {
      const mode = p.mode === 'over' ? 'over' : 'under'
      const target = p.target as number
      const roll = diceRoll(safeU)
      const won = mode === 'under' ? roll < target : roll > target
      const chance = mode === 'under' ? target : 100 - target
      const mult = won ? r2(EDGE / (chance / 100)) : 0
      return { game, u: safeU, multiplier: mult, detail: `Rolled ${roll.toFixed(2)} · ${mode} ${target}`, payload: { roll } }
    }
    case 'limbo': {
      const target = p.target as number
      const point = limboPoint(safeU)
      const won = point >= target
      return {
        game, u: safeU, multiplier: won ? target : 0,
        detail: `${point}x result · target ${target}x`,
        payload: { point },
      }
    }
    case 'wheel': {
      const index = p.index as number
      const mult = WHEEL_SEGMENTS[index] ?? 0
      return {
        game, u: safeU, multiplier: mult,
        detail: `Wheel landed ${mult}x`,
        payload: { index, multiplier: mult },
      }
    }
    case 'plinko': {
      const rows = (p.rows as number) ?? 12
      const risk = (p.risk as PlinkoRisk) ?? 'medium'
      const table = plinkoTable(risk, rows)
      const index = plinkoBucket(safeU, rows, table.length)
      const mult = table[index] ?? 0
      return {
        game, u: safeU, multiplier: mult,
        detail: `${rows} rows · ${risk} risk · ${mult}x`,
        payload: { index, rows, risk },
      }
    }
    case 'roulette': {
      const bets = (p.bets ?? []) as RouletteBet[]
      // The INDEX on the wheel is drawn, not the number: the ball lands on a
      // physical slot, and the number printed there follows from it.
      const idx = Math.min(ROULETTE_WHEEL.length - 1, Math.floor(safeU * ROULETTE_WHEEL.length))
      const number = ROULETTE_WHEEL[idx]
      const stake = bets.reduce((sum, b) => sum + b.amount, 0)
      const mult = rouletteReturn(bets, number, stake)
      return {
        game, u: safeU, multiplier: mult,
        detail: `Ball landed on ${number} ${rouletteColour(number)} · ${bets.length} bet${bets.length > 1 ? 's' : ''}`,
        payload: { index: idx, number, colour: rouletteColour(number) },
      }
    }
    case 'crash': {
      const point = crashPoint(safeU)
      const cashedAt = p.cashedAt as number
      // Nothing is paid unless the player was still in when the curve died.
      const won = cashedAt >= 1 && cashedAt <= point
      return {
        game, u: safeU, multiplier: won ? cashedAt : 0,
        detail: won
          ? `Crashed at ${point}x · cashed out ${cashedAt}x`
          : cashedAt >= 1
            ? `Crashed at ${point}x · cashed out too late at ${cashedAt}x`
            : `Crashed at ${point}x`,
        payload: { point, cashedAt },
      }
    }
    default:
      throw new Error('that game is not settled by the server')
  }
}

/**
 * Why a game is not server-settled, in the operator's words.
 *
 * Mines, tower and the two slot boards resolve through multi-step state (a
 * board of revealed cells, a chase across reels). Settling those from one float
 * would mean rewriting each board's rules on the server, and doing it badly is
 * worse than the current gap: those rounds are still play-money only. Stated
 * here rather than buried, so it is a known limit and not a surprise.
 */
export function unsupportedReason(game: GameId): string {
  return `${game} resolves through multi-step board state and is not settled by the server yet`
}
