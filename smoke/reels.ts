import {
  buildSpinStrip, spinPlan, stopTimes, totalSpinMs, restOffsetPx, stripHeightPx,
  travelPx, visibleFaces, restTransform, START_TRANSFORM, TRAVEL_FACES, REEL_TRAVEL_MS,
} from '../src/lib/reels'

const fails: string[] = []
const ok = (n: string, c: boolean, e = '') => { if (!c) fails.push(n); console.log(`${c ? 'ok  ' : 'FAIL'} ${n} ${e}`) }

const FACE = 60
const GAP = 4
const STEP = FACE + GAP
const ROWS = 3
const PREV = ['donut', 'key', 'cash']
const NEXT = ['bonita', 'wild', 'siren']
const POOL = ['donut', 'key', 'cash', 'badge', 'diamond', 'bonita', 'wild']

// ============================================================ THE JUMP BUG ==
// The board used to rebuild its strip for the outcome the instant the spin
// began, so the visible symbols were replaced before any motion happened. The
// first window of a spin strip must therefore be the symbols already on screen.
const strip = buildSpinStrip(PREV, NEXT, POOL, { travelFaces: TRAVEL_FACES, rows: ROWS })
ok('strip opens on the symbols already on screen',
  strip.slice(0, ROWS).map((f) => f.symId).join(',') === PREV.join(','),
  strip.slice(0, ROWS).map((f) => f.symId).join(','))
ok('strip ends on the outcome',
  strip.slice(-ROWS).map((f) => f.symId).join(',') === NEXT.join(','))
ok('opening window differs from the outcome window (so it is a real spin)',
  strip.slice(0, ROWS).map((f) => f.symId).join(',') !== strip.slice(-ROWS).map((f) => f.symId).join(','))
ok('strip is long enough to look like it turns over',
  strip.length >= ROWS + TRAVEL_FACES + ROWS, `${strip.length} faces`)

// A fresh board with no known previous grid must not throw or open blank.
const noPrev = buildSpinStrip([], NEXT, POOL, { rows: ROWS })
ok('a board with no previous grid still fills its opening window',
  noPrev.slice(0, ROWS).every((f) => POOL.includes(f.symId)))
ok('an empty pool still produces a strip', buildSpinStrip(PREV, NEXT, [], { rows: ROWS }).length > 0)
ok('face keys are unique', new Set(strip.map((f) => f.key)).size === strip.length)

// ========================================================= the travel window ==
const height = stripHeightPx(strip.length, FACE, GAP)
const offset = restOffsetPx(strip.length, ROWS, STEP)
ok('strip height counts the gaps', height === strip.length * FACE + (strip.length - 1) * GAP)
ok('rest offset is positive', offset > 0, `${offset}px`)
ok('rest transform is never a zero translate', restTransform(offset) !== 'translate3d(0,0,0)')
ok('start transform is identity', START_TRANSFORM === 'translate3d(0,0,0)')

// The two ends of the travel must be exactly the two windows we asserted above.
const atStart = visibleFaces(strip, 0, STEP, ROWS, FACE).map((f) => f.symId).join(',')
const atEnd = visibleFaces(strip, offset, STEP, ROWS, FACE).map((f) => f.symId).join(',')
ok('offset 0 shows the previous symbols', atStart === PREV.join(','), atStart)
ok('rest offset shows the outcome', atEnd === NEXT.join(','), atEnd)

// A window must never run out of faces mid-travel: an empty window is what made
// the old board look like it had stalled.
let shortWindow = 0
for (let px = 0; px <= offset; px += 7) {
  if (visibleFaces(strip, px, STEP, ROWS, FACE).length < ROWS) shortWindow++
}
ok('the drum never runs out of symbols mid-travel', shortWindow === 0, `${shortWindow} short frames`)
ok('travel distance equals the rest offset', travelPx(strip.length, ROWS, STEP) === offset)

// The travel must actually cover ground: 10 faces of filler plus a window.
ok('travel is at least three faces', offset >= 3 * STEP, `${offset}px`)
ok('travel turns over more than a full window', offset > ROWS * STEP)
ok('landing window is exactly one window tall',
  height - offset === (ROWS - 1) * STEP + FACE, `${height - offset}px`)

// ================================================================ the timing ==
const plan = spinPlan(5)
ok('five reels produce five plans', plan.reels.length === 5)
ok('drums stop left to right', plan.reels.every((r, i) => i === 0 || r.stopMs > plan.reels[i - 1].stopMs),
  plan.reels.map((r) => r.stopMs).join(','))
ok('total equals the last drum stop', plan.totalMs === plan.reels[4].stopMs)
ok('every drum has an anticipation nudge before it travels', plan.reels.every((r) => r.nudgeMs > 0))
ok('stop time is delay + nudge + travel',
  plan.reels.every((r) => r.stopMs === r.delayMs + r.nudgeMs + r.travelMs))
ok('travel is long enough to read as a spin', REEL_TRAVEL_MS >= 700, `${REEL_TRAVEL_MS}ms`)
ok('a reel does not drift for ages after it looks stopped', plan.totalMs <= 2200, `${plan.totalMs}ms`)
ok('the whole spin is at least a second', plan.totalMs >= 1000, `${plan.totalMs}ms`)

// Regression: a smaller board must NOT be sped up into a snap. The old
// `frameScale` compressed 3-reel boards to ~850ms and they felt like a glitch.
const plan3 = spinPlan(3)
ok('a 3-reel board travels at the same speed as a 5-reel one',
  plan3.reels[0].travelMs === plan.reels[0].travelMs,
  `${plan3.reels[0].travelMs} vs ${plan.reels[0].travelMs}`)
ok('a 3-reel board still spins for at least a second', plan3.totalMs >= 1000, `${plan3.totalMs}ms`)

// Stop times must be usable as audio cues: ascending and matching the plan.
const stops = stopTimes(5)
ok('stopTimes matches spinPlan', stops.join(',') === plan.reels.map((r) => r.stopMs).join(','))
ok('totalSpinMs matches spinPlan', totalSpinMs(5) === plan.totalMs)

// Degenerate boards must not crash.
ok('a 1-reel board plans without throwing', spinPlan(1).reels.length === 1)
ok('a 0-reel board plans at least one drum', spinPlan(0).reels.length === 1)

if (fails.length) { console.log(`\n${fails.length} FAILED: ${fails.join(', ')}`); process.exit(1) }
console.log('all reel-motion checks passed')
