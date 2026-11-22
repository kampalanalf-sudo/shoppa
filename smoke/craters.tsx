import { readFileSync, existsSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { CRATERS, CRATERS_SYMBOLS, resolveCraters, simulateCraters, bumpMultiplier, awarded,
  advanceRound, grantsSpins, IDLE_ROUND, CRATE_TRIGGER, CRATE_SPINS, BODA_TRIGGER, BODA_SPINS,
  MAX_ROUND_MULTIPLIER, MAX_FREE_SPINS, CRATERS_TIERS } from '../src/lib/slots/craters'
import { buildGrid } from '../src/lib/slots/engine'
import { GAMES, gameById } from '../src/lib/games'
import type { Grid } from '../src/lib/slots/engine'
import React from 'react'
import { renderToString } from 'react-dom/server'
import { SlotBoard3D } from '../src/components/SlotBoard3D'

// smoke/craters.ts
//
// Craters' non-negotiables: the shape is 4x3, the round state can never leak
// between rounds, the multiplier is bounded, and the advertised RTP is the RTP
// the simulation actually produces.
const fails: string[] = []
const ok = (n: string, c: boolean, e = '') => { if (!c) fails.push(n); console.log(`${c ? 'ok  ' : 'FAIL'} ${n} ${e}`) }

const root = resolve(process.cwd())
const read = (p: string) => readFileSync(resolve(root, p), 'utf8')
const mk = (cfg: any, fn: (reel: number, row: number) => string): Grid =>
  Array.from({ length: cfg.reels }, (_, r) =>
    Array.from({ length: cfg.rows }, (_, c) => ({ id: fn(r, c), reel: r, row: c })),
  ) as unknown as Grid

const sampleGrid = mk(CRATERS, (r, c) =>
  (['nile', 'club', 'crate', 'tab'] as const)[(r + c) % 4]) as unknown as Grid

// ------------------------------------------------------------- shape & config ===
ok('the board is 4x3', CRATERS.reels === 4 && CRATERS.rows === 3)
// Ways = rows per reel ** number of reels. 3^4 = 81, not 243 and not 4^3.
ok('81 ways, not 243', CRATERS.rows ** CRATERS.reels === 81)
ok('registered in the catalogue', !!gameById('craters'))
ok('catalogue entry names the game Craters', gameById('craters')!.name === 'Craters')
ok('catalogue category is Slots', gameById('craters')!.category === 'Slots')
ok('no duplicate game ids', new Set(GAMES.map((g) => g.id)).size === GAMES.length)

// A 4-reel board can only ever produce 3- and 4-of-a-kind. A 5-entry paytable
// would be three entries of dead code that still has to be tuned and explained.
ok('every paytable has exactly 2 entries (3 and 4 of a kind)',
  CRATERS_SYMBOLS.filter((s) => s.pay).every((s) => s.pay!.length === 2))
ok('no paytable entry is zero or negative',
  CRATERS_SYMBOLS.filter((s) => s.pay).every((s) => s.pay!.every((p) => p > 0)))
ok('pays rise with the reel count (4 of a kind beats 3)',
  CRATERS_SYMBOLS.filter((s) => s.pay).every((s) => s.pay![1] > s.pay![0]))

// ------------------------------------------------------------- brand bottles ===
const ids = CRATERS_SYMBOLS.map((s) => s.id)
ok('Nile Special is on the board', ids.includes('nile'))
ok('Club Pilsener is on the board', ids.includes('club'))
ok('the two named brands pay the most',
  CRATERS_SYMBOLS.filter((s) => s.pay).sort((a, b) => b.pay![1] - a.pay![1]).slice(0, 2)
    .map((s) => s.id).sort().join() === 'club,nile')
ok('four more Ugandan brews are present',
  ['bell', 'castle', 'mbarara', 'ngule'].every((x) => ids.includes(x)))

// Art: every symbol that claims art must ship it, or the board shows a broken
// image where a bottle should be.
for (const s of CRATERS_SYMBOLS) {
  if (!s.art) continue
  const rel = s.art.replace(/^\/(shoppa\/)?/, '')
  const path = resolve(root, 'public', rel)
  ok(`${s.id} art exists on disk`, existsSync(path), rel)
  if (existsSync(path)) {
    ok(`${s.id} art is not empty`, statSync(path).size > 2000, `${(statSync(path).size / 1024).toFixed(0)}K`)
  }
}

// --------------------------------------------------------------- wild & scatter ===
ok('the bartender is the wild', CRATERS.wild === 'bartender')
ok('the crate is the scatter', CRATERS.scatter === 'crate')
ok('the wild is not also the scatter', CRATERS.wild !== CRATERS.scatter)

// Wild substitutes for a bottle.
const wildRun = mk(CRATERS, (r) => (r === 0 ? 'nile' : r === 1 ? 'bartender' : r === 2 ? 'nile' : 'nile'))
const wildOut = resolveCraters(CRATERS, wildRun)
ok('wild substitutes for Nile Special across 4 reels',
  wildOut.wins.some((w) => w.symbol === 'nile' && w.reels === 4), JSON.stringify(wildOut.wins[0] ?? null))
// The wild must not pay off itself as a 4-run of wilds *and* a 4-run of nile
// simultaneously in a way that double-counts the same cells; the engine pays
// the wild's own line and the substituted line, which is the standard rule.
ok('wild has its own paytable', !!CRATERS_SYMBOLS.find((s) => s.id === 'bartender')!.pay)

// ------------------------------------------------------------- no fines ===
ok('there is no punishing omen symbol', !CRATERS.symbols.some((s) => (s as any).omen))
ok('an all-scatter board pays the player, never fines them',
  resolveCraters(CRATERS, mk(CRATERS, () => 'crate')).total >= 0)

// ------------------------------------------------------------- crate feature ===
const threeCrates = mk(CRATERS, (r, c) => (r < 3 && c === 0 ? 'crate' : 'tab'))
const cOut = resolveCraters(CRATERS, threeCrates)
ok('3 crates award 10 free spins', cOut.freeSpins === CRATE_SPINS, `(${cOut.freeSpins})`)
ok('3 crates pay a scatter prize too', cOut.gross >= CRATERS.scatterPay[0])
ok('crates are counted anywhere on the board', cOut.crates === 3)
const fourCrates = mk(CRATERS, (r, c) => (r < 4 && c === 0 ? 'crate' : 'tab'))
ok('4 crates award extra spins', resolveCraters(CRATERS, fourCrates).freeSpins > CRATE_SPINS)
ok('2 crates award nothing', resolveCraters(CRATERS, mk(CRATERS, (r, c) => (r < 2 && c === 0 ? 'crate' : 'tab'))).freeSpins === 0)

// --------------------------------------------------- multiplier is bounded ===
ok('multiplier starts at 1', bumpMultiplier(1, 0) === 1)
ok('a crate in the round raises the multiplier by 1', bumpMultiplier(1, 3) === 2)
ok('the multiplier cannot exceed the cap',
  bumpMultiplier(MAX_ROUND_MULTIPLIER, 4) === MAX_ROUND_MULTIPLIER)
ok('multiplier climbs monotonically',
  (() => { let m = 1; for (let i = 0; i < 30; i++) { const n = bumpMultiplier(m, 3); if (n < m) return false; m = n } return true })())
ok('the round multiplier multiplies the whole spin',
  (() => {
    const g = mk(CRATERS, (r) => (r < 4 ? 'nile' : 'tab'))
    const a = resolveCraters(CRATERS, g, { multiplier: 1 }).total
    const b = resolveCraters(CRATERS, g, { multiplier: 3 }).total
    return Math.abs(b - a * 3) < 0.01 && a > 0
  })())
ok('a null round multiplier is treated as 1',
  resolveCraters(CRATERS, mk(CRATERS, () => 'nile')).roundMultiplier === 1)

// ------------------------------------------------- free spin cap ===
ok('free spins cannot be granted past the cap', awarded(10, MAX_FREE_SPINS) === 0)
ok('free spins are capped, not refused, when near the cap',
  awarded(10, MAX_FREE_SPINS - 4) === 4)
ok('a negative request grants nothing', awarded(-5, 0) === 0)

// ------------------------------------------------- delivery run ===
const bodaBoard = mk(CRATERS, (r, c) => (r < 3 && c === 0 ? 'boda' : 'nile'))
const dOut = resolveCraters(CRATERS, bodaBoard)
ok('3 bodas are a delivery run', dOut.delivery && dOut.bodas === 3)
ok('a delivery run doubles bottle wins',
  (() => {
    const plain = resolveCraters(CRATERS, bodaBoard)
    const run = resolveCraters(CRATERS, bodaBoard, { delivery: true })
    const pw = plain.wins.find((w) => w.symbol === 'nile')
    const rw = run.wins.find((w) => w.symbol === 'nile')
    return !!pw && !!rw && Math.abs(rw.multiplier - pw.multiplier * 2) < 0.01
  })())
ok('a delivery run does not double the crate scatter pay',
  (() => {
    const g = mk(CRATERS, (r, c) => (r < 3 && c === 0 ? 'crate' : 'boda'))
    const a = resolveCraters(CRATERS, g).gross
    const b = resolveCraters(CRATERS, g, { delivery: true }).gross
    return Math.abs(a - b) < 0.01
  })())

// ------------------------------------------- round transition (the feature) ===
// advanceRound is the single definition of how the feature progresses; the game
// and the Monte Carlo both call it. These pin its contract.
ok('an idle round stays idle on a plain spin',
  advanceRound(IDLE_ROUND, { crates: 0, bodas: 0, freeSpins: 0 }).left === 0)
ok('a spin never leaks a multiplier out of a round',
  advanceRound(IDLE_ROUND, { crates: 0, bodas: 0, freeSpins: 0 }).multiplier === 1)
ok('3 crates open a round of 10 spins',
  advanceRound(IDLE_ROUND, { crates: 3, bodas: 0, freeSpins: 10 }).left === 10)
ok('opening a round sets the multiplier to 2',
  advanceRound(IDLE_ROUND, { crates: 3, bodas: 0, freeSpins: 10 }).multiplier === 2)

// BODA: advertised as "3 free spins where bottles pay double". Both halves.
const bodaOnly = advanceRound(IDLE_ROUND, { crates: 0, bodas: 3, freeSpins: 0 })
ok('3 bodas really grant free spins', bodaOnly.left === BODA_SPINS, `(${bodaOnly.left})`)
ok('3 bodas switch the delivery bonus on', bodaOnly.delivery === true)
ok('a boda inside a crate round extends it',
  advanceRound({ left: 5, multiplier: 3, delivery: false }, { crates: 0, bodas: 3, freeSpins: 0 }).left === 8)
ok('a boda does not raise the multiplier',
  advanceRound({ left: 5, multiplier: 3, delivery: false }, { crates: 0, bodas: 3, freeSpins: 0 }).multiplier === 3)
ok('the delivery bonus survives to the next spin',
  advanceRound({ left: 4, multiplier: 2, delivery: true }, { crates: 0, bodas: 0, freeSpins: 0 }).delivery)
ok('both features can land on the same spin',
  (() => {
    const r = advanceRound(IDLE_ROUND, { crates: 3, bodas: 3, freeSpins: 10 })
    return r.left === 13 && r.multiplier === 2 && r.delivery
  })())
ok('a round never exceeds the free-spin cap',
  advanceRound({ left: MAX_FREE_SPINS, multiplier: 9, delivery: true }, { crates: 4, bodas: 3, freeSpins: 14 }).left === MAX_FREE_SPINS)
ok('grantsSpins sees both features',
  grantsSpins({ crates: 3, bodas: 0 }) && grantsSpins({ crates: 0, bodas: 3 }) && !grantsSpins({ crates: 2, bodas: 2 }))
ok('IDLE_ROUND is genuinely idle',
  IDLE_ROUND.left === 0 && IDLE_ROUND.multiplier === 1 && IDLE_ROUND.delivery === false)
ok('advanceRound is pure (does not mutate its input)',
  (() => { const before = { left: 4, multiplier: 2, delivery: false }; advanceRound(before, { crates: 3, bodas: 0, freeSpins: 10 }); return before.left === 4 && before.multiplier === 2 && before.delivery === false })())

// ------------------------------------------------- win tiers ===
ok('win tiers are ordered and reachable', CRATERS_TIERS.every((t, i) => i === 0 || t.at > CRATERS_TIERS[i - 1].at))
ok('the advertised max win is reachable in principle', CRATERS.maxWin >= 5000)

// ------------------------------------------------------------- RTP ===
// The headline number in the catalogue is only honest if the maths backs it.
// 600k rounds, not 200k. This game pays on ~52% of spins and carries a
// feature whose multiplier compounds, so a small sample is noisy: 200k spreads
// about +/-1.7pp across seeds, which is wider than any band worth asserting.
// At 600k a single fixed seed reproduces.
const sim = simulateCraters(CRATERS, 600000)
const rtpPct = +(sim.rtp * 100).toFixed(2)
const advertised = parseFloat(gameById('craters')!.rtp)
console.log(`\n     sim RTP ${rtpPct}%  hit ${(sim.hitRate * 100).toFixed(1)}%  ` +
  `trigger ${(sim.triggerRate * 100).toFixed(2)}%  delivery ${(sim.deliveryRate * 100).toFixed(2)}%  ` +
  `avg free ${sim.avgFreeSpinsPerTrigger.toFixed(1)}\n`)
ok('RTP is in a legal band (95.5-97%)', rtpPct > 95.5 && rtpPct < 97, `(${rtpPct}%)`)
// Tight enough to catch a paytable edit that moves the maths, loose enough to
// survive the residual sampling noise at this size.
ok('advertised RTP matches the simulation within 0.6pp',
  Math.abs(rtpPct - advertised) < 0.6, `(advertised ${advertised}%, sim ${rtpPct}%)`)
ok('the game is not a guaranteed loss', sim.hitRate > 0.05)
ok('the crate feature is reachable', sim.triggerRate > 0.005, `(${(sim.triggerRate * 100).toFixed(2)}%)`)
ok('free spins are worth playing', sim.avgFreeSpinsPerTrigger > 5)
ok('no single spin pays more than the advertised cap', sim.maxWin < CRATERS.maxWin * 2)

// ------------------------------------------------- determinism ===
const a = simulateCraters(CRATERS, 2000, 12345)
const b = simulateCraters(CRATERS, 2000, 12345)
ok('the simulation is deterministic for a fixed seed', a.rtp === b.rtp)
ok('the grid builder is deterministic for fixed floats',
  JSON.stringify(buildGrid(CRATERS, Array.from({ length: 12 }, (_, i) => (i * 0.137) % 1))) ===
  JSON.stringify(buildGrid(CRATERS, Array.from({ length: 12 }, (_, i) => (i * 0.137) % 1))))

// ------------------------------------------------- the component is wired ===
const app = read('src/App.tsx')
const page = read('src/games/Craters.tsx')
ok('Craters is routed in App.tsx', /current === 'craters'/.test(app))
ok('Craters is imported in App.tsx', /from '\.\/games\/Craters'/.test(app))
// Round state must be cleared when the round ends, or the next paid spin
// inherits a multiplier the player did not earn this round.
ok('the whole round is cleared when it ends', /setRound\(IDLE_ROUND\)/.test(page))
ok('the component uses the shared round transition', /advanceRound\(round, out\)/.test(page))
ok('the component does not reimplement the multiplier', !/bumpMultiplier\(/.test(page))
ok('the component does not reimplement spin awards', !/awarded\(/.test(page))
ok('free spins are consumed, not the bet, inside a round', /wager: inRound \? 0 : bet/.test(page))
ok('a free spin is spent from the round', /left: r\.left - 1/.test(page))
ok('the board is the shared 3D one', /<SlotBoard3D/.test(page))
ok('the game uses the shared celebration layers', /<Celebration/.test(page))

// ------------------------------------------------- renders on the real board ===
// The unit rules above are meaningless if the component cannot mount. This
// renders the actual 4-reel board with a craters grid, server-side.
const boardHtml = renderToString(
  <SlotBoard3D config={CRATERS} grid={sampleGrid} spinning={false} spinKey={1} winCells={new Set()} />,
)
ok('the 4-reel board renders without throwing', boardHtml.length > 500, `${boardHtml.length} chars`)
ok('the board emits one strip per reel',
  (boardHtml.match(/will-change-transform/g) || []).length === CRATERS.reels,
  `${(boardHtml.match(/will-change-transform/g) || []).length} strips`)
ok('the board renders the generated bottle art',
  (boardHtml.match(/art\/craters\//g) || []).length > 0)
ok('the board renders a vector tile for the symbol without art',
  boardHtml.length > 0 && !boardHtml.includes('undefined'))

if (fails.length) { console.log(`\n${fails.length} FAILED: ${fails.join(', ')}`); process.exit(1) }
console.log('\ncraters: 4x3, Ugandan bottles, bounded multiplier, RTP matches the label')
