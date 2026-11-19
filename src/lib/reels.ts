// src/lib/reels.ts
//
// Motion model for BOTH slot boards.
//
// History, because it explains every constraint below:
//   1. The first implementation animated `translateY(${settling ? 0 : 0}px)` —
//      both branches zero, so nothing moved at all.
//   2. The second implementation drove a rAF loop, which did move, but the reel
//      strip was rebuilt for the *outcome* at the moment the spin began. The
//      symbols on screen were therefore replaced before the reel started
//      travelling, so the board visibly jumped, then span.
//
// The rule that fixes (2): the strip a reel spins must START on exactly the
// symbols the reel is already showing. The spin is then a pure continuation of
// what the player is looking at — no swap at t=0, no jump.
//
// How a spin is built, per reel:
//
//   [ prev , prev , prev ]  [ filler ... ]  [ next , next , next ]
//   \_____ visible now ___/                \____ where it lands ____/
//
//   offset 0                      →  shows `prev` (identical to the resting board)
//   offset (stripHeight - window) →  shows `next`
//
// The travel is a single GPU-composited CSS transition, not a JS animation:
// the compositor keeps it smooth even when the main thread is busy settling
// the round, which a rAF loop cannot promise on a mid-range Android.
//
// Everything here is pure so it can be tested without a browser.

/** A face on a spinning strip. `key` is stable across the whole spin. */
export type StripFace = {
  key: number
  symId: string
}

export type ReelPlan = {
  reel: number
  /** when this reel starts its anticipation nudge, from spin start */
  delayMs: number
  /** length of the anticipation nudge */
  nudgeMs: number
  /** length of the travel itself */
  travelMs: number
  /** delay + nudge + travel: the moment this reel is at rest */
  stopMs: number
  /** how far the strip moves, in px */
  travelPx: number
  /** how many faces of filler sit between `prev` and `next` */
  travelFaces: number
}

export type SpinPlan = {
  reels: ReelPlan[]
  /** when the last reel lands */
  totalMs: number
}

// ------------------------------------------------------------------ timing --

/** Reels are staggered so the board reads as separate drums. */
export const REEL_STAGGER_MS = 120
/** A drum pulls back a few px before it launches. Reads as "engaged". */
export const NUDGE_MS = 90
export const NUDGE_PX = 5
/** Travel length for one drum. Constant across reels: the stagger does the work. */
export const REEL_TRAVEL_MS = 1000
/**
 * Faces of filler between the visible symbols and the outcome. Enough that the
 * drum visibly makes two and a half turns, which is what sells the spin; more
 * than this is just DOM.
 */
export const TRAVEL_FACES = 10

/**
 * Ease for the travel: fast off the mark, long deceleration, lands with a
 * little speed still on it (like a real drum hitting its stop).
 */
export const SPIN_EASE = 'cubic-bezier(.14,.78,.26,1)'
/** Ease for the anticipation nudge. */
export const NUDGE_EASE = 'cubic-bezier(.4,0,.7,1)'

/** Motion blur while a drum is travelling, in px. Cleared on landing. */
export const SPIN_BLUR = 'blur(0.7px)'

/**
 * Plan for a whole board.
 *
 * Deliberately *not* scaled by reel count or row count: the previous version
 * multiplied every duration by a `frameScale` factor below 1 for 3-reel boards,
 * which made small boards snap in ~850ms. A three-reel board should feel the
 * same weight as a five-reel one, just with fewer drums.
 */
export function spinPlan(
  reels: number,
  opts: {
    stagger?: number
    nudge?: number
    travelMs?: number
    travelFaces?: number
    facePx?: number
  } = {},
): SpinPlan {
  const {
    stagger = REEL_STAGGER_MS,
    nudge = NUDGE_MS,
    travelMs = REEL_TRAVEL_MS,
    travelFaces = TRAVEL_FACES,
    facePx = 0,
  } = opts

  const plan: ReelPlan[] = Array.from({ length: Math.max(1, reels) }, (_, reel) => {
    const delayMs = reel * stagger
    return {
      reel,
      delayMs,
      nudgeMs: nudge,
      travelMs,
      stopMs: delayMs + nudge + travelMs,
      // `travelFaces` of filler plus one window of `rows` for the outcome, so
      // the drum turns a little more than the face count suggests.
      travelPx: (travelFaces + 3) * facePx,
      travelFaces,
    }
  })

  return { reels: plan, totalMs: plan[plan.length - 1].stopMs }
}

/** Stop times only, in ms from spin start. Ascending, left to right. */
export function stopTimes(reels: number): number[] {
  return spinPlan(reels).reels.map((r) => r.stopMs)
}

/** When the last reel is at rest. */
export function totalSpinMs(reels: number): number {
  return spinPlan(reels).totalMs
}

// ------------------------------------------------------------------- strips --

const fillFrom = (pool: string[], target: string | undefined, n: number): string[] => {
  // Never start the filler with the symbol the reel is about to land on in a
  // different row: it reads as a near-miss that never pays.
  const src = pool.length ? pool : target ? [target] : ['?']
  return Array.from({ length: n }, (_, i) => src[i % src.length])
}

/**
 * Build the strip a reel spins on.
 *
 * `prev` MUST be the symbols the reel is currently showing; the first faces of
 * the strip are exactly those, which is what removes the start-of-spin jump.
 */
export function buildSpinStrip(
  prev: string[],
  next: string[],
  pool: string[],
  opts: { travelFaces?: number; rows?: number } = {},
): StripFace[] {
  const { travelFaces = TRAVEL_FACES, rows = 3 } = opts
  const rowsP = rows > 0 ? rows : 3
  // A reel always needs `prev` at the top; fall back to filler if we don't know
  // what it was showing (first render, or a grid that changed while idle).
  const top = prev.length === rowsP ? prev : fillFrom(pool, next[0], rowsP)
  const middle = fillFrom(pool, next[0], travelFaces)
  const bottom = next.length ? next : fillFrom(pool, undefined, rowsP)

  const ids = [...top, ...middle, ...bottom]
  return ids.map((symId, key) => ({ key, symId }))
}

/**
 * Pixel offset that shows the landing window (the last `rows` faces).
 *
 * Counted in whole faces, not in strip height: a face occupies `face` px but
 * its slot occupies `step` = face + gap. Deriving this from the strip height
 * (height - rows * step) is off by `rows` gaps and pulls one extra symbol into
 * the window — which is exactly the sort of near-miss artefact that makes a
 * board look wrong at rest.
 */
export function restOffsetPx(faces: number, rows: number, step: number): number {
  return Math.max(0, (faces - rows) * step)
}

/** Height of a strip, in px, including the gap between faces. */
export function stripHeightPx(faces: number, face: number, gap: number): number {
  if (faces <= 0) return 0
  return faces * face + (faces - 1) * gap
}

/**
 * How far a reel travels, given the strip it is spinning on.
 * Derived from the strip rather than assumed, so a change to TRAVEL_FACES can
 * never leave the reel short of its target.
 */
export function travelPx(faces: number, rows: number, step: number): number {
  return restOffsetPx(faces, rows, step)
}

/**
 * Which faces are visible for a given offset — used by the tests to prove the
 * drum shows a full window the whole way down, and lands on the outcome.
 */
export function visibleFaces(
  faces: StripFace[],
  offsetPx: number,
  step: number,
  rows: number,
  face = step,
): StripFace[] {
  const out: StripFace[] = []
  // The window is `rows` faces plus the gaps between them, not `rows` slots.
  const windowEnd = offsetPx + (rows - 1) * step + face
  for (let k = 0; k < faces.length; k++) {
    const top = k * step
    if (top + face > offsetPx + 0.001 && top < windowEnd - 0.001) out.push(faces[k])
  }
  return out
}

/** The transform a reel rests at. Must never be a zero translate. */
export function restTransform(offsetPx: number): string {
  return `translate3d(0,${-Math.round(offsetPx * 100) / 100}px,0)`
}

/** The transform a reel starts its travel from: exactly where it sits. */
export const START_TRANSFORM = 'translate3d(0,0,0)'

/** The transform for the anticipation pull-back. */
export const NUDGE_TRANSFORM = `translate3d(0,${-NUDGE_PX}px,0)`

/** A ready-to-spread CSS transition property string. */
export function transitionFor(propertyMs: number, durMs: number, ease: string): string {
  return `transform ${Math.max(1, Math.round(durMs))}ms ${ease}`
}
