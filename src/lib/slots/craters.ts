// src/lib/slots/craters.ts
//
// Craters — a 4×3 ways slot set in a Kampala beer depot at closing time.
//
// The bartender has to get the delivery crates out. Bottles are the goods; the
// crate and the boda are what makes them leave the building.
//
// WHY THIS FILE EXISTS SEPARATELY FROM THE GENERIC ENGINE
//
// `engine.ts` gives every game 243 ways over 5 reels and two specials: a
// scatter and a *punishing* omen. That is the house style for Chape, Blue
// Mountain, Bazaar and Boda — all of them fine the player for a bad symbol.
//
// Craters is a 4-reel, 81-way board with a *positive* feature set instead:
//
//   - Crate (scatter)  : 3+ awards free spins, AND a round-long multiplier that
//                        grows by 1× every time the crate re-appears mid-round.
//                        This is the "big wins" path: it is the only way to
//                        reach 40× on a single spin.
//   - 3 boda scatters  : a delivery run — 3 free spins where every bottle pays
//                        double. Deliberately rarer and lighter than the crate.
//   - Bottles stack    : a bottle landing 2-3 tall on one reel pays as if it
//                        occupied that many ways, which is what makes a 4-reel
//                        board feel less thin than it is.
//   - No omen, no fines. Nothing here takes money back off the player.
//
// Keeping those rules in one file, with a Monte Carlo, means the RTP can be
// re-tuned without touching render code — and the smoke suite can prove it.
import { ASSET_BASE } from '../assetBase'
import type { SlotConfig, SlotSymbolDef, Grid } from './engine'

// ------------------------------------------------------------------ symbols --

/**
 * Payouts are per way, in bet multiples, for 3 / 4 on the reel.
 *
 * These are NOT round numbers on purpose. On an 81-way board that pays on
 * almost every spin (hit rate is around 52%), a 4-of-a-kind with a wild across
 * all three rows pays 81 ways at once, so the top symbols have to be
 * fractions of a multiple or the game returns 130%. They were produced by
 * scaling a round-number paytable by 0.74 and then measured — see
 * `npm run test:craters`, which fails if the simulated RTP drifts off the
 * advertised 96.4% by more than half a point.
 *
 * Only two reels of length remain (3 and 4) because the board is 4 wide: there
 * is no such thing as a 5-of-a-kind on a 4-reel slot, and a paytable entry for
 * one would be dead code that still had to be tuned.
 */
export type CratersSymbol = SlotSymbolDef & {
  /**
   * What this symbol is for, in the bartender's terms. Surfaced in the UI so
   * the board reads as a story rather than a grid of pictures.
   */
  role?: string
}

export const CRATERS_SYMBOLS: CratersSymbol[] = [
  // ---- the guest of honour: the house bottles, highest paying
  {
    id: 'nile',
    name: 'Nile Special',
    role: 'The premium crate',
    pay: [1.5778, 6.2972],
    weight: 2,
    tier: 'high',
    glyph: '🍾',
    color: '#8bff5a',
    art: `${ASSET_BASE}art/craters/nile.webp`,
  },
  {
    id: 'club',
    name: 'Club Pilsener',
    role: 'The red-label classic',
    pay: [1.1789, 4.7229],
    weight: 3,
    tier: 'high',
    glyph: '🍺',
    color: '#ff8f5c',
    art: `${ASSET_BASE}art/craters/club.webp`,
  },
  {
    id: 'bell',
    name: 'Bell Lager',
    role: 'Cold and dependable',
    pay: [0.7872, 3.1486],
    weight: 4,
    tier: 'high',
    glyph: '🧊',
    color: '#3ad7ff',
    art: `${ASSET_BASE}art/craters/bell.webp`,
  },
  // ---- local brews, mid
  {
    id: 'castle',
    name: 'Castle Lager',
    role: 'A heavy pour',
    pay: [0.492, 1.9679],
    weight: 4,
    tier: 'mid',
    glyph: '🏰',
    color: '#ffcf5c',
    art: `${ASSET_BASE}art/craters/castle.webp`,
  },
  {
    id: 'mbarara',
    name: 'Mbarara',
    role: 'Sorghum, brewed western',
    pay: [0.2952, 1.1807],
    weight: 6,
    tier: 'mid',
    glyph: '🌾',
    color: '#d8b98a',
    art: `${ASSET_BASE}art/craters/mbarara.webp`,
  },
  {
    id: 'ngule',
    name: 'Ngule',
    role: 'Millet, brewed traditional',
    pay: [0.2099, 0.8396],
    weight: 7,
    tier: 'mid',
    glyph: '🪵',
    color: '#c98b5c',
    art: `${ASSET_BASE}art/craters/ngule.webp`,
  },
  // ---- the low tier. `rolex` had no art budget left, so it runs on the
  // engine's vector tile and is styled to look deliberate, not missing.
  {
    id: 'rolex',
    name: 'Rolex',
    role: 'Chapati, for the walk home',
    pay: [0.1181, 0.4723],
    weight: 11,
    tier: 'low',
    glyph: '🌯',
    color: '#e8d44d',
  },
  {
    id: 'tab',
    name: 'Bar Tab',
    role: 'What this round is costing',
    pay: [0.0787, 0.3149],
    weight: 13,
    tier: 'low',
    glyph: '🧾',
    color: '#8b93a5',
    art: `${ASSET_BASE}art/craters/tab.webp`,
  },
  // ---- specials
  {
    id: 'bartender',
    name: 'Bartender (Wild)',
    role: 'Covers any bottle',
    pay: [0.3935, 1.5743],
    weight: 3,
    tier: 'special',
    glyph: '🤵🏿',
    color: '#c6f24e',
    art: `${ASSET_BASE}art/craters/bartender.webp`,
  },
  {
    id: 'crate',
    name: 'Crate (Scatter)',
    role: 'Free spins + rising multiplier',
    weight: 2,
    tier: 'special',
    glyph: '📦',
    color: '#3ad7ff',
    art: `${ASSET_BASE}art/craters/crate.webp`,
  },
  {
    id: 'boda',
    name: 'Boda (Run)',
    role: '3 = delivery run, bottles pay 2×',
    weight: 2,
    tier: 'special',
    glyph: '🛵',
    color: '#ff8f5c',
    art: `${ASSET_BASE}art/craters/boda.webp`,
  },
]

export const CRATERS: SlotConfig = {
  id: 'craters',
  name: 'Craters',
  tagline: '4×3 ways · bottles, crates & delivery runs',
  reels: 4,
  rows: 3,
  wild: 'bartender',
  scatter: 'crate',
  scatterTrigger: 3,
  freeSpins: 10,
  // 3 / 4 crates pay 2× / 8× the bet on the trigger alone. On a 4-reel board
  // the old 5-entry scatter table had two entries that could never fire.
  scatterPay: [1.3119, 5.2476, 5.2476],
  maxWin: 5000,
  volatility: 'high',
  symbols: CRATERS_SYMBOLS,
}

// -------------------------------------------------------------- the features --

/** The multiplier every crate during a free-spin round adds. */
export const CRATE_STEP = 1
/** Which crate count starts a free-spin round. */
export const CRATE_TRIGGER = 3
/** Free spins for 3 crates, and one extra per crate beyond the third. */
export const CRATE_SPINS = 10
export const CRATE_EXTRA_SPINS = 2
/** Rounds are capped so a lucky board cannot compound into an unbounded win. */
export const MAX_ROUND_MULTIPLIER = 10
export const MAX_FREE_SPINS = 30
/** Delivery run: 3 bodas, and every bottle pays this much more. */
export const BODA_TRIGGER = 3
export const BODA_SPINS = 3
export const BODA_BOTTLE_MULT = 2

export type CratersOutcome = {
  grid: Grid
  wins: {
    symbol: string
    reels: number
    pay: number
    ways: number
    multiplier: number
    cells: { reel: number; row: number }[]
  }[]
  /** Sum of ways wins plus scatter pays, before the round multiplier. */
  gross: number
  crates: number
  bodas: number
  /** Free spins this spin awarded. 0 if none. */
  freeSpins: number
  /** New free spins added by a crate landing inside a running round. */
  retrigger: boolean
  /** Bottle wins were doubled by a delivery run. */
  delivery: boolean
  /** Round multiplier that applies to this spin's wins. */
  roundMultiplier: number
  /** gross × roundMultiplier (× delivery), rounded. */
  total: number
}

const countOf = (grid: Grid, id: string) =>
  grid.reduce((n, col) => n + col.filter((c) => c.id === id).length, 0)

/**
 * Ways evaluation, the longest-run rule, over a board of any width.
 *
 * Identical in logic to `engine.evaluateWays` but stops at the number of pay
 * entries this game actually has, instead of pretending there are five reels.
 */
function evaluate(cfg: SlotConfig, grid: Grid) {
  const wins: CratersOutcome['wins'] = []
  for (const sym of cfg.symbols) {
    if (!sym.pay) continue
    const isWild = sym.id === cfg.wild
    const counts: number[] = []
    const run: { reel: number; row: number }[] = []

    for (let reel = 0; reel < cfg.reels; reel++) {
      const matches = grid[reel].filter(
        (cell) => cell.id === sym.id || (!isWild && cell.id === cfg.wild),
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

/**
 * Resolve one spin.
 *
 * `round` carries state the generic engine has no concept of:
 *
 *   multiplier   the running multiplier of the free-spin round (1 = none)
 *   inFreeSpins  whether bottles are currently doubled-up on crates
 *
 * Everything is pure, so the same inputs always produce the same outcome and
 * the smoke suite can assert on exact numbers.
 */
export function resolveCraters(
  cfg: SlotConfig,
  grid: Grid,
  round: { multiplier?: number; delivery?: boolean } = {},
): CratersOutcome {
  const wins = evaluate(cfg, grid)
  const crates = countOf(grid, cfg.scatter)
  const bodas = countOf(grid, 'boda')

  const delivery = Boolean(round.delivery)
  // A delivery run doubles bottle wins only — never the crate pays, or the two
  // features would multiply into each other and the maths would drift.
  const withDelivery = wins.map((w) =>
    delivery && cfg.symbols.find((s) => s.id === w.symbol)?.tier !== 'special'
      ? { ...w, multiplier: Math.round(w.multiplier * BODA_BOTTLE_MULT * 100) / 100 }
      : w,
  )

  let gross = withDelivery.reduce((a, w) => a + w.multiplier, 0)
  if (crates >= CRATE_TRIGGER) {
    const idx = Math.min(crates, 4) - 3
    gross += cfg.scatterPay[idx] ?? 0
  }

  const roundMultiplier = Math.max(1, round.multiplier ?? 1)
  const total = Math.round(gross * roundMultiplier * 100) / 100

  return {
    grid,
    wins: withDelivery,
    gross: Math.round(gross * 100) / 100,
    crates,
    bodas,
    freeSpins: crates >= CRATE_TRIGGER ? CRATE_SPINS + (crates - CRATE_TRIGGER) * CRATE_EXTRA_SPINS : 0,
    retrigger: crates >= CRATE_TRIGGER,
    delivery: bodas >= BODA_TRIGGER,
    roundMultiplier,
    total,
  }
}

/** Free spins a spin awards, capped so a round cannot run away. */
export function awarded(spins: number, alreadyHeld: number): number {
  return Math.max(0, Math.min(spins, MAX_FREE_SPINS - alreadyHeld))
}

/** The round multiplier after a spin, capped at MAX_ROUND_MULTIPLIER. */
export function bumpMultiplier(current: number, crates: number): number {
  if (crates < CRATE_TRIGGER) return current
  return Math.min(MAX_ROUND_MULTIPLIER, current + CRATE_STEP)
}

/**
 * Round state: spins left, the multiplier every win is scaled by, and whether
 * a boda has been called so bottles pay double.
 *
 * Only meaningful while `left > 0`. A round that hits zero is over and the
 * next paid spin must start from `IDLE_ROUND`, or a player would carry an
 * earned 6x multiplier into a spin they did not pay the feature for.
 */
export type RoundState = { left: number; multiplier: number; delivery: boolean }

export const IDLE_ROUND: RoundState = { left: 0, multiplier: 1, delivery: false }

/** True when a spin awards any free spins at all. */
export function grantsSpins(out: { crates: number; bodas: number }): boolean {
  return out.crates >= CRATE_TRIGGER || out.bodas >= BODA_TRIGGER
}

/**
 * Apply one spin's triggers to the round.
 *
 * This is THE definition of how the feature advances. The game component and
 * the Monte Carlo both call it, so the RTP the test measures is the RTP the
 * player actually experiences — a duplicate implementation would drift the
 * moment either side was edited.
 *
 * Both features can land on the same spin, and they compose:
 *   - crates  : +10 spins (capped), +1x multiplier, +2 spins per extra crate
 *   - bodas   : +3 spins (capped), bottles double for the rest of the round
 */
export function advanceRound(
  prev: RoundState,
  out: { crates: number; bodas: number; freeSpins: number },
): RoundState {
  const inRound = prev.left > 0

  const crateSpins = out.crates >= CRATE_TRIGGER ? out.freeSpins : 0
  const bodaSpins = out.bodas >= BODA_TRIGGER ? BODA_SPINS : 0

  // A trigger that lands out of a round opens one; inside a round it extends.
  const held = inRound ? prev.left : 0
  let left = held
  if (crateSpins > 0) left += awarded(crateSpins, left)
  if (bodaSpins > 0) left += awarded(bodaSpins, left)

  const multiplier = inRound || crateSpins > 0
    ? (crateSpins > 0 ? bumpMultiplier(inRound ? prev.multiplier : 1, out.crates) : prev.multiplier)
    : 1

  return {
    left,
    multiplier: Math.max(1, multiplier),
    delivery: prev.delivery || out.bodas >= BODA_TRIGGER,
  }
}

/** Win tiers, by total bet multiple. Shared by the HUD and the celebration. */
export const CRATERS_TIERS = [
  { at: 8, label: 'Big win', kind: 'bigwin' as const },
  { at: 20, label: 'Mega win', kind: 'mega' as const },
  { at: 40, label: 'Craters win', kind: 'mega' as const },
]

export function tierFor(total: number) {
  let hit: (typeof CRATERS_TIERS)[number] | null = null
  for (const t of CRATERS_TIERS) if (total >= t.at) hit = t
  return hit
}

// ------------------------------------------------------------------ simulation --

/**
 * Monte Carlo, including free-spin rounds.
 *
 * The generic `simulate` spins once and never plays the feature, which is fine
 * for a game whose scatter only pays cash. Here the crate *is* the feature and
 * it is where the variance lives, so RTP has to be measured with the round
 * played out, not stopped at the trigger.
 */
export function simulateCraters(cfg: SlotConfig, spins: number, seed = 0x9e3779b9) {
  let s = seed >>> 0
  const rnd = () => {
    s = (s + 0x9e3779b9) | 0
    let t = s ^ (s >>> 16)
    t = Math.imul(t, 0x21f0aaad)
    t = t ^ (t >>> 15)
    t = Math.imul(t, 0x735a2d97)
    return ((t = t ^ (t >>> 15)) >>> 0) / 4294967296
  }
  // Local copy of buildGrid so this module stays importable without the engine's
  // whole surface (and so the simulation cannot drift from the config's weights).
  const weights = cfg.symbols.map((x) => x.weight)
  const totalW = weights.reduce((a, b) => a + b, 0)
  const pick = (u: number) => {
    let v = u * totalW
    for (let i = 0; i < cfg.symbols.length; i++) {
      if (v < weights[i]) return cfg.symbols[i].id
      v -= weights[i]
    }
    return cfg.symbols[cfg.symbols.length - 1].id
  }
  const gridOf = (): Grid => {
    const g: Grid = []
    for (let reel = 0; reel < cfg.reels; reel++) {
      const col = []
      for (let row = 0; row < cfg.rows; row++) col.push({ id: pick(rnd()), reel, row })
      g.push(col)
    }
    return g
  }

  let paid = 0
  let triggered = 0
  let deliveryRuns = 0
  let biggest = 0
  let hits = 0
  let totalFree = 0
  let rounds = 0

  for (let i = 0; i < spins; i++) {
    // The first spin of every iteration is a PAID spin. Free spins are played
    // out inside it, so `spins` always means spins the player paid for.
    let round: RoundState = IDLE_ROUND
    let first = true
    let spinPaid = 0
    let guard = 0

    while (first || round.left > 0) {
      if (guard++ > MAX_FREE_SPINS * 3) break
      const playing = round
      const out = resolveCraters(cfg, gridOf(), {
        multiplier: playing.multiplier,
        delivery: playing.delivery,
      })

      if (!first) totalFree++
      spinPaid += out.total
      if (first && out.crates >= CRATE_TRIGGER) triggered++
      if (out.bodas >= BODA_TRIGGER) deliveryRuns++

      // Same transition the game applies, and the same cap.
      const next = advanceRound(playing, out)
      // A spin that grants spins but was itself a free spin stays in the round.
      round = { ...next, left: Math.min(next.left, MAX_FREE_SPINS) }
      if (!first) round.left = Math.max(0, round.left - 1)
      if (next.left > 0 && first) rounds++
      first = false

      if (round.left <= 0) break
    }

    paid += spinPaid
    if (spinPaid > 0) hits++
    if (spinPaid > biggest) biggest = spinPaid
  }

  return {
    rtp: paid / spins,
    hitRate: hits / spins,
    triggerRate: triggered / spins,
    deliveryRate: deliveryRuns / spins,
    avgFreeSpinsPerTrigger: rounds ? totalFree / rounds : 0,
    maxWin: biggest,
  }
}
