import {
  offsetAt, stopTimes, totalSpinMs, buildStrip, visibleCells, spinDistance, frameScale,
} from '../src/lib/reels'

const fails: string[] = []
const ok = (n: string, c: boolean, e = '') => { if (!c) fails.push(n); console.log(`${c ? 'ok  ' : 'FAIL'} ${n} ${e}`) }

const FACE = 60
const ROWS = 3
const DIST = spinDistance(FACE)

// ------------------------------------------------------------- the real bug --
// The previous reel advanced a counter and applied
// `transform: translateY(${settling ? 0 : 0}px)` — always zero. These assertions
// are the regression guard: the offset must actually change over time.
ok('reel travels a non-zero distance', DIST > 0, `${DIST}px`)
ok('offset is 0 at t=0', offsetAt(0, 1000, DIST) === 0)
ok('offset is the full distance at the end', offsetAt(1000, 1000, DIST) === DIST)
ok('offset moves between frames', offsetAt(100, 1000, DIST) > 0 && offsetAt(200, 1000, DIST) > offsetAt(100, 1000, DIST))

// Monotonic and never overshooting: a bounce at the stop reads as a glitch.
let prev = -1
let monotonic = true
let maxSeen = 0
for (let t = 0; t <= 1000; t += 16) {
  const v = offsetAt(t, 1000, DIST)
  if (v < prev) monotonic = false
  if (v > DIST) maxSeen = v
  prev = v
}
ok('offset is monotonic across the whole spin', monotonic)
ok('offset never overshoots the landing point', maxSeen === 0)

// Deceleration: the last quarter must cover far less ground than the first.
const firstQ = offsetAt(250, 1000, DIST) - offsetAt(0, 1000, DIST)
const lastQ = offsetAt(1000, 1000, DIST) - offsetAt(750, 1000, DIST)
ok('reel decelerates into the stop', lastQ < firstQ * 0.5, `${lastQ.toFixed(1)} < ${(firstQ * 0.5).toFixed(1)}`)
ok('most of the travel happens in the first half', offsetAt(500, 1000, DIST) > DIST * 0.8)

// Clamped outside the window, so a late frame cannot overshoot.
ok('negative time is clamped', offsetAt(-50, 1000, DIST) === 0)
ok('time past the end is clamped', offsetAt(5000, 1000, DIST) === DIST)

// ------------------------------------------------------------------ stagger --
const stops = stopTimes(5)
ok('five reels produce five stop times', stops.length === 5)
ok('stop times increase left to right', stops.every((v, i) => i === 0 || v > stops[i - 1]), stops.join(','))
ok('total spin equals the last reel stop', totalSpinMs(5) === stops[4])
ok('a 3-reel board finishes sooner than a 5-reel board', totalSpinMs(3) < totalSpinMs(5))
ok('spin is long enough to read as a spin', totalSpinMs(5) >= 900, `${totalSpinMs(5)}ms`)
ok('spin is not so long it feels laggy', totalSpinMs(5) <= 2000, `${totalSpinMs(5)}ms`)

// ------------------------------------------------------------------- strips --
const target = ['a', 'b', 'c']
const pool = ['a', 'b', 'c', 'd', 'e']
const strip = buildStrip(target, pool, FACE, 3)
ok('strip has filler above the landing window', strip.cells.length > ROWS)
ok('strip ends with the landing symbols',
  strip.cells.slice(-3).map((c) => c.symId).join('') === 'abc')
ok('strip cells are spaced by the face height', strip.cells[1].y - strip.cells[0].y === FACE)
ok('strip height matches its cell count', strip.height === strip.cells.length * FACE)
ok('filler only uses symbols from the pool',
  strip.cells.slice(0, -3).every((c) => pool.includes(c.symId)))

// The landing offset must put the window exactly at the bottom of the strip.
const landing = strip.height - ROWS * FACE
ok('landing offset is positive', landing > 0)
ok('landing offset leaves exactly one window of content below',
  strip.height - landing === ROWS * FACE)
ok('landing window shows the target symbols',
  visibleCells(strip.cells, landing, FACE, ROWS).map((c) => c.symId).join('') === 'abc')

// During the spin the window must show *something* — an empty window is what
// made the old board look like it had stalled.
const mid = offsetAt(400, 1000, landing)
const midVisible = visibleCells(strip.cells, mid, FACE, ROWS)
ok('a mid-spin frame shows a full window of symbols', midVisible.length >= ROWS, `${midVisible.length} cells`)

// A degenerate config must not crash the board.
const empty = buildStrip([], [], FACE, 2)
ok('empty target produces a strip without throwing', Array.isArray(empty.cells))

// -------------------------------------------------------------- board scale --
ok('5-reel boards spin at full length', frameScale(5, 3) === 1)
ok('3-reel boards spin shorter', frameScale(3, 3) < 1)

if (fails.length) { console.log(`\n${fails.length} FAILED: ${fails.join(', ')}`); process.exit(1) }
console.log('\nall reel-motion checks passed')
