/**
 * Generic ways-slot engine.
 *
 * Bonni & Clyve has its own bespoke model in `lib/slot.ts`. Everything else on
 * the floor runs through this engine, which takes a per-game config so new
 * games are data rather than code.
 *
 * Mechanics: 3 rows x N reels, "243 ways" evaluation (adjacent reels, at least
 * one matching cell per reel, only the longest run pays), optional wild, plus
 * two special hooks:
 *   - scatter  : N+ anywhere triggers free spins
 *   - omen     : N+ anywhere fines the player (a negative payout)
 */

export type SlotSymbolDef = {
  id: string
  name: string
  /** 3 / 4 / 5-of-a-kind multipliers per way. Absent => non-paying blocker. */
  pay?: [number, number, number]
  weight: number
  tier: 'high' | 'mid' | 'low' | 'special'
  /** emoji/glyph used by the vector symbol renderer */
  glyph: string
  /** accent colour for the symbol card */
  color: string
  /** optional generated portrait (falls back to the glyph) */
  art?: string
}

export type SlotConfig = {
  id: string
  name: string
  tagline: string
  reels: number
  rows: number
  symbols: SlotSymbolDef[]
  wild: string
  scatter: string
  scatterTrigger: number
  freeSpins: number
  /** scatter pay on 3/4/5 */
  scatterPay: [number, number, number]
  /** heavy bad omen: N+ anywhere fines the player */
  omen?: { symbol: string; trigger: number; fine: number }
  /** low-weight bad luck blockers, surfaced in the UI as a warning */
  badLuck?: string[]
  maxWin: number
  volatility: 'low' | 'medium' | 'high'
}

export type Cell = { id: string; reel: number; row: number }
export type Grid = Cell[][]

export type Win = {
  symbol: string
  reels: number
  pay: number
  ways: number
  multiplier: number
  cells: { reel: number; row: number }[]
}

export type SlotOutcome = {
  grid: Grid
  wins: Win[]
  /** sum of ways wins + scatter pay, BEFORE any omen fine */
  gross: number
  /** omen fine in bet multiples (0 when no omen) */
  fine: number
  /** gross - fine, floored at 0 */
  totalMultiplier: number
  scatters: number
  omenCount: number
  freeSpins: number
  triggered: boolean
}

const byId = (c: SlotConfig, id: string) => c.symbols.find((s) => s.id === id)

/** Weighted pick for one cell, given a uniform float in [0,1). */
export function symbolFromFloat(c: SlotConfig, u: number): string {
  const total = c.symbols.reduce((a, s) => a + s.weight, 0)
  let pick = u * total
  for (const s of c.symbols) {
    if (pick < s.weight) return s.id
    pick -= s.weight
  }
  return c.symbols[c.symbols.length - 1].id
}

/** Build the grid from `reels * rows` provably-fair floats. */
export function buildGrid(c: SlotConfig, floats: number[]): Grid {
  const grid: Grid = []
  let i = 0
  for (let reel = 0; reel < c.reels; reel++) {
    const col: Cell[] = []
    for (let row = 0; row < c.rows; row++) {
      col.push({ id: symbolFromFloat(c, floats[i++] ?? 0.5), reel, row })
    }
    grid.push(col)
  }
  return grid
}

/** Longest-run ways evaluation across every paying symbol. */
export function evaluateWays(c: SlotConfig, grid: Grid): Win[] {
  const wins: Win[] = []

  for (const sym of c.symbols) {
    if (!sym.pay) continue
    const isWild = sym.id === c.wild
    const counts: number[] = []
    const run: { reel: number; row: number }[] = []

    for (let reel = 0; reel < c.reels; reel++) {
      const matches = grid[reel].filter(
        (cell) => cell.id === sym.id || (!isWild && cell.id === c.wild),
      )
      if (matches.length === 0) break
      counts.push(matches.length)
      matches.forEach((m) => run.push({ reel, row: m.row }))
    }

    if (counts.length < 3) continue
    const pay = sym.pay[counts.length - 3]
    if (pay == null) continue
    const ways = counts.reduce((a, b) => a * b, 1)
    wins.push({
      symbol: sym.id,
      reels: counts.length,
      pay,
      ways,
      multiplier: Math.round(pay * ways * 100) / 100,
      cells: run,
    })
  }

  return wins.sort((a, b) => b.multiplier - a.multiplier)
}

export const countSymbol = (grid: Grid, id: string) =>
  grid.reduce((n, col) => n + col.filter((cell) => cell.id === id).length, 0)

export function resolve(c: SlotConfig, grid: Grid): SlotOutcome {
  const wins = evaluateWays(c, grid)
  const scatters = countSymbol(grid, c.scatter)
  let gross = wins.reduce((a, w) => a + w.multiplier, 0)

  if (scatters >= 3) {
    const idx = Math.min(scatters, 5) - 3
    gross += c.scatterPay[idx] ?? 0
  }

  const omenCount = c.omen ? countSymbol(grid, c.omen.symbol) : 0
  const fine = c.omen && omenCount >= c.omen.trigger ? c.omen.fine : 0

  return {
    grid,
    wins,
    gross: Math.round(gross * 100) / 100,
    fine,
    totalMultiplier: Math.round(Math.max(0, gross - fine) * 100) / 100,
    scatters,
    omenCount,
    freeSpins: scatters >= c.scatterTrigger ? c.freeSpins : 0,
    triggered: scatters >= c.scatterTrigger,
  }
}

/** Expected return of one spin, by Monte Carlo. Used by the tuning script. */
export function simulate(c: SlotConfig, spins: number, seed = 0x9e3779b9) {
  let s = seed >>> 0
  const rnd = () => {
    s = (s + 0x9e3779b9) | 0
    let t = s ^ (s >>> 16)
    t = Math.imul(t, 0x21f0aaad)
    t = t ^ (t >>> 15)
    t = Math.imul(t, 0x735a2d97)
    return ((t = t ^ (t >>> 15)) >>> 0) / 4294967296
  }
  let sum = 0, gross = 0, fined = 0, hits = 0, triggered = 0, maxWin = 0
  const n = c.reels * c.rows
  for (let i = 0; i < spins; i++) {
    const floats = Array.from({ length: n }, rnd)
    const out = resolve(c, buildGrid(c, floats))
    sum += out.totalMultiplier
    gross += out.gross
    if (out.fine > 0) fined++
    if (out.totalMultiplier > 0) hits++
    if (out.triggered) triggered++
    if (out.totalMultiplier > maxWin) maxWin = out.totalMultiplier
  }
  return {
    rtp: sum / spins,
    grossRtp: gross / spins,
    fineRate: fined / spins,
    hitRate: hits / spins,
    triggerRate: triggered / spins,
    maxWin,
  }
}
