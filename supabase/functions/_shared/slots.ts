// supabase/functions/_shared/slots.ts
//
// One place where the SERVER decides a slot spin, importing the very same maths
// the reels on screen use.
//
// WHY THIS EXISTS
//
// The six video slots were browser-settled, so they could not be played for
// money and the app had to refuse them and label them "demo". That is a bad
// product, and labelling it more loudly — which is what the last change did — is
// not a fix. The rules were never the problem: they are pure functions with no
// DOM, no React and no `import.meta.env` (the artwork now goes through
// `assetBase` instead). So the server can call exactly what the board calls.
//
// The contract mirrors the Originals: one spin, one uniform float from the
// player's seed, and the server derives the grid and pays it. The browser is
// handed an outcome to animate, never a multiplier to trust.

/*
 * The rules, and ONLY the rules.
 *
 * The obvious import — everything from src/lib/slot.ts and src/lib/slots/*.ts —
 * does not work: each module has its own `buildGrid`, `resolve`, `symbolFromFloat`
 * and `r2`, and splicing them into one file is a duplicate declaration that
 * throws on load. It also drags in the symbol tables, which are artwork metadata
 * the server never uses.
 *
 * So the edge bundle gets what a settlement actually needs:
 *
 *   bonni    its own card-table model (src/lib/slot.ts)
 *   craters  its own ways model, reels x rows
 *   the rest the generic ways engine (src/lib/slots/engine.ts) plus a paytable
 *
 * `npm run test:slotvalue` proves the three generic tables here produce byte-identical
 * multipliers to the configs in src/lib/slots/games*.ts, so this is a mirror that
 * is CHECKED, not a hand-copied paytable.
 */
import {
  buildGrid as bonniGrid,
  resolve as resolveBonni,
  MAX_WIN as BONNI_MAX,
  REELS as BONNI_REELS,
  ROWS as BONNI_ROWS,
} from '../../../src/lib/slot.ts'
import { buildGrid, resolve as engineResolve } from '../../../src/lib/slots/engine.ts'
import { CHAPE, BLUE_MOUNTAIN, BAZAAR, BODA, CRATERS_CONFIG } from './slot-configs.ts'
import type { SlotConfig } from './slot-configs.ts'
// `r2` and `isServerSettled` come from games.ts: the edge bundle is one flat
// file, so a second `const r2` is a duplicate declaration, not a shadow.
import { r2 } from './games.ts'
// Craters resolves its own crate/boda features; the generic engine has no
// concept of them.
import { resolveCraters } from '../../../src/lib/slots/craters.ts'

export type SlotId = 'bonni' | 'craters' | 'chape' | 'bluemountain' | 'bazaar' | 'boda'

export const SLOT_IDS: readonly SlotId[] = ['bonni', 'craters', 'chape', 'bluemountain', 'bazaar', 'boda']

export const isSlot = (game: string): game is SlotId => (SLOT_IDS as readonly string[]).includes(game)

/**
 * Cells a spin needs floats for.
 *
 * Bonni and the three engine slots draw one float per cell. Craters does too —
 * its round multiplier and delivery flag are carried on the round, not drawn.
 */
export function slotFloats(id: SlotId): number {
  switch (id) {
    case 'bonni':
      return 15
    case 'craters':
      return CRATERS_CONFIG.reels * CRATERS_CONFIG.rows
    case 'chape':
      return CHAPE.reels * CHAPE.rows
    case 'bluemountain':
      return BLUE_MOUNTAIN.reels * BLUE_MOUNTAIN.rows
    case 'bazaar':
      return BAZAAR.reels * BAZAAR.rows
    case 'boda':
      return BODA.reels * BODA.rows
  }
}

export type SlotSpin = {
  /** Symbol ids, [reel][row]. The board renders from exactly this. */
  grid: string[][]
  /** Total return in bet multiples, stake included. The server pays this. */
  multiplier: number
  /** One line for the round row. */
  detail: string
  /** Extra facts the UI shows but must not trust for money. */
  extra: Record<string, number | string>
}

/**
 * Resolve one spin from the floats the server derived.
 *
 * `round` carries Craters' free-spin state, which is the only slot with a
 * multi-spin round. It is supplied by the server from the round row, never by
 * the caller.
 */
export function resolveSlotSpin(
  id: SlotId,
  floats: number[],
  round: { multiplier?: number; delivery?: boolean } = {},
): SlotSpin {
  if (id === 'bonni') {
    const grid = bonniGrid(floats.slice(0, 15))
    const out = resolveBonni(grid)
    return {
      grid: grid.map((reel) => reel.map((c) => c.id)),
      multiplier: r2(Math.min(BONNI_MAX, out.totalMultiplier)),
      detail: `Bonni & Clyve · ${out.wins.length} win${out.wins.length === 1 ? '' : 's'}`,
      extra: { scatters: out.scatters ?? 0, wins: out.wins.length },
    }
  }

  if (id === 'craters') {
    /*
     * Craters has its own reel strips and its own crate/boda features, so it
     * runs on its own resolver. The symbol table is generated from the real
     * config (see scripts/gen-slot-configs.mjs); the strips themselves are a
     * plain weighted pick here, which is what `buildCratersGrid` does.
     */
    const cfg = CRATERS_CONFIG as unknown as SlotConfig
    const grid = buildGrid(cfg, floats)
    const out = resolveCraters(cfg, grid, round)
    return {
      grid: grid.map((reel) => reel.map((c) => c.id)),
      multiplier: r2(Math.min(cfg.maxWin, out.total)),
      detail: `Craters · ${out.crates} crate${out.crates === 1 ? '' : 's'}`,
      extra: { crates: out.crates, bodas: out.bodas, freeSpins: out.freeSpins ?? 0 },
    }
  }

  const cfg =
    id === 'chape' ? CHAPE : id === 'bluemountain' ? BLUE_MOUNTAIN : id === 'bazaar' ? BAZAAR : BODA
  const grid = buildGrid(cfg, floats)
  const out = engineResolve(cfg, grid)
  return {
    grid: grid.map((reel) => reel.map((c) => c.id)),
    multiplier: r2(Math.min(cfg.maxWin, out.totalMultiplier)),
    detail: `${cfg.name} · ${out.wins.length} win${out.wins.length === 1 ? '' : 's'}`,
    extra: {
      scatters: out.scatters,
      omenCount: out.omenCount,
      freeSpins: out.freeSpins,
    },
  }
}
