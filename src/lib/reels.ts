// src/lib/reels.ts
//
// Motion model for the engine slots.
//
// Why this exists: the previous implementation incremented a counter 12 times
// and then applied a single CSS transition. Because the rows are absolutely
// positioned by `top`, that transition animated nothing — the reels jumped
// rather than spun. (`transform: translateY(${settling ? 0 : 0}px)` was always
// zero, which is the tell.)
//
// The model here is deliberately simple and testable: each reel has a
// continuous pixel position that advances once per animation frame, and the
// strip is a repeating loop of symbols. Everything below is pure so it can be
// tested without a browser.

/** One visible cell of a strip, with the pixel offset it occupies. */
export type StripCell = {
  index: number
  /** symbol id, repeated so the loop can be windowed */
  symId: string
  /** pixel position of the cell's top inside the strip, before modulo */
  y: number
}

/**
 * How far a reel travels before it starts easing out, in "symbols".
 * Enough full turns that the strip visibly loops even on a slow spin.
 */
export const SPIN_DISTANCE_SYMBOLS = 10

/** Total travel for a reel, in pixels. */
export function spinDistance(face: number): number {
  return face * SPIN_DISTANCE_SYMBOLS
}

/**
 * Position of the reel at time `t`, in ms, for a spin of `durationMs`.
 *
 * Uses an ease-out over the whole travel, so the reel is fastest at the start
 * and decelerates into its final position. That reads as a physical drum
 * slowing under friction rather than a linear slide.
 *
 * Clamped at both ends: before 0 it is at 0, after durationMs it is exactly at
 * `distance`. No overshoot, because a visible bounce at the stop looks like a
 * rendering glitch on a 5-reel board.
 */
export function offsetAt(t: number, durationMs: number, distance: number): number {
  if (t <= 0) return 0
  if (t >= durationMs) return distance
  const p = t / durationMs
  // easeOutQuart: strong initial velocity, long calm settle
  const eased = 1 - Math.pow(1 - p, 4)
  return distance * eased
}

/**
 * When each reel stops, in ms from the start of the spin.
 *
 * Staggered left to right so the board reads as five separate drums. The last
 * reel is the slowest because that is where anticipation lives.
 */
export function stopTimes(reels: number, base = 620, step = 170): number[] {
  return Array.from({ length: reels }, (_, i) => base + i * step)
}

/**
 * Total spin length for a board, i.e. when the last reel has stopped.
 */
export function totalSpinMs(reels: number, base = 620, step = 170): number {
  return base + (reels - 1) * step
}

/**
 * Build the looping strip for one reel.
 *
 * `visible` is the landing window (top to bottom). We prepend enough filler
 * above it that the strip never runs out during the slowest spin, and repeat
 * the symbol list so the loop looks seamless.
 */
export function buildStrip(
  target: string[],
  pool: string[],
  face: number,
  repeats = 3,
): { cells: StripCell[]; height: number } {
  const rows = target.length
  const cycle = pool.length > 0 ? pool : target
  // filler above the landing window: enough that the first frame has content
  const lead = rows * repeats
  const ids: string[] = []
  for (let i = 0; i < lead; i++) ids.push(cycle[i % cycle.length])
  for (const id of target) ids.push(id)

  const cells: StripCell[] = ids.map((symId, index) => ({
    index,
    symId,
    y: index * face,
  }))

  return { cells, height: cells.length * face }
}

/**
 * The pixel offset that shows the landing window with no gap, given how far the
 * reel has travelled.
 */
export function landingOffset(stripHeight: number, rows: number, face: number): number {
  // The landing window sits at the end of the strip, so the offset is whatever
  // puts its first row at y=0.
  return stripHeight - rows * face
}

/**
 * Which strip cells are visible at a given offset, for rendering a window of
 * the loop rather than the whole strip.
 */
export function visibleCells(
  cells: StripCell[],
  offset: number,
  face: number,
  rows: number,
): StripCell[] {
  const out: StripCell[] = []
  const startY = offset
  const endY = offset + rows * face
  for (const c of cells) {
    if (c.y + face > startY && c.y < endY) out.push(c)
  }
  return out
}

/** Clamp a spin to something the hardware can actually animate. */
export function frameScale(reelCount: number, rows: number): number {
  // Five reels of three rows is the heaviest board we ship; scale durations a
  // little so a 3x3 game feels lighter than a 5x3 one.
  return reelCount >= 5 ? 1 : 0.85 + rows * 0.02
}
