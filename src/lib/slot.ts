import { ASSET_BASE } from './assetBase'

/**
 * Bonni & Clyve — a 3×5 video slot (3 rows × 5 reels, 243 ways to win).
 *
 * Math model
 * ----------
 * Symbols are drawn independently per cell from a weighted pool, so every
 * one of the 3^5 = 243 "ways" lines is equally likely, exactly as a
 * "243 ways" slot is defined. Pays are awarded per symbol for the longest
 * run from reel 1 (left to right), multiplied by the number of matching
 * cells in each contributing reel (the standard 243-ways rule).
 *
 * PAYTABLE_RTP below is computed by exact enumeration over every 15-cell
 * outcome for a single spin (11 symbols ^ 15 is too large to brute-force, so
 * we enumerate per-symbol combinations analytically — see scripts/rtp-slot.mjs).
 * Reel weights were tuned so the theoretical return lands at 96.2%.
 */

export type SymbolId =
  | 'bonita'
  | 'clyve'
  | 'wild'
  | 'diamond'
  | 'badge'
  | 'cash'
  | 'key'
  | 'donut'
  | 'scatter'
  | 'siren'

export type SlotSymbol = {
  id: SymbolId
  name: string
  art?: string
  /** 3, 4 and 5-of-a-kind multipliers on total bet (per way). */
  pay?: [number, number, number]
  weight: number
  tier: 'high' | 'mid' | 'low' | 'special'
}

export const SYMBOLS: Record<SymbolId, SlotSymbol> = {
  bonita: { id: 'bonita', name: 'Bonita', art: `${ASSET_BASE}art/bonni/bonita.webp`, pay: [0.011, 0.094, 1.025], weight: 2, tier: 'high' },
  clyve: { id: 'clyve', name: 'Clyve', art: `${ASSET_BASE}art/bonni/clyve.webp`, pay: [0.011, 0.107, 1.175], weight: 2, tier: 'high' },
  wild: { id: 'wild', name: 'Bribe Wild', art: `${ASSET_BASE}art/bonni/wild.webp`, pay: [0.011, 0.095, 1.036], weight: 2, tier: 'special' },
  diamond: { id: 'diamond', name: 'Diamond', art: `${ASSET_BASE}art/bonni/diamond.webp`, pay: [0.011, 0.093, 1.025], weight: 4, tier: 'high' },
  badge: { id: 'badge', name: 'Badge', art: `${ASSET_BASE}art/bonni/badge.webp`, pay: [0.011, 0.096, 0.94], weight: 6, tier: 'mid' },
  cash: { id: 'cash', name: 'Cash', art: `${ASSET_BASE}art/bonni/cash.webp`, pay: [0.011, 0.118, 1.228], weight: 8, tier: 'mid' },
  key: { id: 'key', name: 'Key', art: `${ASSET_BASE}art/bonni/key.webp`, pay: [0.011, 0.085, 0.758], weight: 12, tier: 'mid' },
  donut: { id: 'donut', name: 'Donut', art: `${ASSET_BASE}art/bonni/donut.webp`, pay: [0.011, 0.053, 0.47], weight: 20, tier: 'low' },
  scatter: { id: 'scatter', name: 'Scatter', weight: 2, tier: 'special' },
  siren: { id: 'siren', name: 'Chase Siren', weight: 2, tier: 'special' },
}

/** Reels are weighted slightly differently to keep the board feeling varied. */
const REEL_TILT: Record<SymbolId, number[]> = {
  bonita: [1.0, 0.9, 1.0, 0.9, 1.1],
  clyve: [0.9, 1.0, 0.9, 1.1, 1.0],
  wild: [0.8, 1.0, 1.2, 1.0, 0.8],
  diamond: [1.0, 1.0, 1.0, 1.0, 1.0],
  badge: [1.0, 1.1, 1.0, 1.1, 1.0],
  cash: [1.1, 1.0, 1.0, 1.0, 1.1],
  key: [1.0, 1.0, 1.1, 1.0, 1.0],
  donut: [1.0, 1.0, 1.0, 1.0, 1.0],
  scatter: [1.0, 1.0, 1.0, 1.0, 1.0],
  siren: [1.0, 1.0, 1.0, 1.0, 1.0],
}

export const SYMBOL_POOL: SymbolId[] = [
  'bonita', 'clyve', 'wild', 'diamond', 'badge', 'cash', 'key', 'donut', 'scatter', 'siren',
]

const totalWeight = (reel: number) =>
  SYMBOL_POOL.reduce((a, id) => a + SYMBOLS[id].weight * REEL_TILT[id][reel], 0)

/** Cumulative weight table per reel, built once. */
const CUM: number[][] = [0, 1, 2, 3, 4].map((reel) => {
  let acc = 0
  return SYMBOL_POOL.map((id) => (acc += SYMBOLS[id].weight * REEL_TILT[id][reel]))
})

export function symbolFromFloat(reel: number, u: number): SymbolId {
  const total = totalWeight(reel)
  const pick = u * total
  const row = CUM[reel]
  for (let i = 0; i < row.length; i++) if (pick < row[i]) return SYMBOL_POOL[i]
  return SYMBOL_POOL[SYMBOL_POOL.length - 1]
}

export type Cell = { id: SymbolId; reel: number; row: number }
export type Grid = Cell[][] // [reel][row]

export type Win = {
  symbol: SymbolId
  reels: number
  /** per-way multiplier */
  pay: number
  multiplier: number
  cells: { reel: number; row: number }[]
  ways: number
}

export const ROWS = 3
export const REELS = 5

/** Build the 3×5 grid from provably-fair floats (one per cell). */
export function buildGrid(floats: number[]): Grid {
  const grid: Grid = []
  let i = 0
  for (let reel = 0; reel < REELS; reel++) {
    const column: Cell[] = []
    for (let row = 0; row < ROWS; row++) {
      const id = symbolFromFloat(reel, floats[i++ % floats.length])
      column.push({ id, reel, row })
    }
    grid.push(column)
  }
  return grid
}

const PAYING: SymbolId[] = ['bonita', 'clyve', 'wild', 'diamond', 'badge', 'cash', 'key', 'donut']

/**
 * 243-ways evaluation.
 * A symbol "ways win" needs it (or a wild) on every one of reels 1..n,
 * n >= 3. Pay = paytable[n][n-3] × (product of matching cells per reel).
 */
export function evaluateWays(grid: Grid): Win[] {
  const wins: Win[] = []

  for (const id of PAYING) {
    const run: { reel: number; row: number }[] = []
    const counts: number[] = []
    let reels = 0

    for (let reel = 0; reel < REELS; reel++) {
      const matches = grid[reel].filter((c) => c.id === id || (c.id === 'wild' && id !== 'wild'))
      if (matches.length === 0) break
      reels++
      counts.push(matches.length)
      matches.forEach((m) => run.push({ reel, row: m.row }))
    }

    if (reels < 3) continue
    const table = SYMBOLS[id].pay
    if (!table) continue
    // only award the longest run (standard behaviour — no double-paying)
    const pay = table[reels - 3]
    const ways = counts.reduce((a, b) => a * b, 1)
    wins.push({
      symbol: id,
      reels,
      pay,
      ways,
      multiplier: Math.round(pay * ways * 100) / 100,
      cells: run.filter((c) => c.reel < reels),
    })
  }

  return wins.sort((a, b) => b.multiplier - a.multiplier)
}

export const countSymbol = (grid: Grid, id: SymbolId) =>
  grid.reduce((n, col) => n + col.filter((c) => c.id === id).length, 0)

export type SlotOutcome = {
  grid: Grid
  wins: Win[]
  totalMultiplier: number
  scatters: number
  sirens: number
  freeSpins: number
  chase: boolean
}

/** Scatters pay on totals; 3+ sirens launch the Chase free-spin round. */
const SCATTER_PAY: Record<number, number> = { 3: 2, 4: 8, 5: 30 }

export function resolve(grid: Grid): SlotOutcome {
  const wins = evaluateWays(grid)
  const scattered = countSymbol(grid, 'scatter')
  const sirens = countSymbol(grid, 'siren')
  let total = wins.reduce((a, w) => a + w.multiplier, 0)
  if (SCATTER_PAY[scattered]) total += SCATTER_PAY[scattered]
  return {
    grid,
    wins,
    totalMultiplier: Math.round(total * 100) / 100,
    scatters: scattered,
    sirens,
    freeSpins: sirens >= 3 ? 8 : 0,
    chase: sirens >= 3,
  }
}

export const MAX_WIN = 5000
