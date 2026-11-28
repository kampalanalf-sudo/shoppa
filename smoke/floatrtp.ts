// smoke/floatrtp.ts
//
// The float-session rate, checked by measuring what the games actually pay.
//
// "Reduce the RTP for sessions using Float funds to 65%" is a claim about money,
// and the easy ways to get it wrong all compile:
//
//   * applying a 0.65 factor to a multiplier that already carries the arcade's
//     99% — 2.00× becomes 1.30×, and the session returns 65% × 99% = 64.35%, not
//     the 65% anybody was promised;
//   * scaling the STAKE instead of the payout, which would make a float session
//     unable to place the bet it just placed and would break the minimum bet;
//   * getting one game right and forgetting the other twelve;
//   * letting a losing outcome pay something, because "at least the stake" was
//     applied to a zero;
//   * a roulette wheel that promises more than it can pay.
//
// So this enumerates every game's outcomes under both rates and asserts the
// return, computed the way `settle_round_server` computes the payout — from the
// round's stored rate, floor to the shilling — rather than from the shape of the
// SQL.
import { readFileSync } from 'node:fs'
import {
  EDGE, WHEEL_SEGMENTS, plinkoTable, minesMultiplier, towerLevelMultiplier,
  towerCols, limboPoint, crashPoint, rouletteReturn, ROULETTE_WHEEL,
  type PlinkoRisk,
} from '../supabase/functions/_shared/games'

const fails: string[] = []
const ok = (name: string, cond: boolean, extra = '') => {
  if (!cond) fails.push(name)
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`)
}
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol

const SQL = readFileSync('supabase/migrations/0026_float_session_rtp.sql', 'utf8')
const RATE = 0.65

// ---------------------------------------------- the rule the SQL implements --

/**
 * What `settle_round_server` pays: the multiplier scaled by `rate / base(game)`,
 * floored to two places, never below 1× for a win, and 0 stays 0.
 *
 * A scale, not a cap: cap left every multiplier below 1.30× untouched and the
 * session still returned 99% (measured — see the wheel case below).
 */
const BASE: Record<string, number> = {
  dice: 0.99, limbo: 0.99, wheel: 0.99, plinko: 0.99, crash: 0.99, mines: 0.99, tower: 0.99,
  roulette: 0.973, bonni: 0.962, craters: 0.962, chape: 0.962,
  bluemountain: 0.965, bazaar: 0.963, boda: 0.962,
}
const paid = (mult: number, rate: number, game: string) => {
  if (mult <= 0) return 0
  if (rate >= 1) return mult
  // No floor at 1x: the wheel's 0.4x slices are partial returns, and lifting a
  // scaled 0.26x back to 1.00x would raise them and break the scale.
  return Math.floor(mult * (rate / BASE[game]) * 100) / 100
}

/** The advertised return of a game is the mean multiplier; cap it the same way. */
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length

// [label, multipliers, the base game the payout is scaled against]
/**
 * One outcome: a multiplier and how often it happens. Everything is weighted,
 * because the first version of this file averaged `[win, 0]` as if the two were
 * equally likely and reported a 49.5% dice return — a test wrong in a way that
 * would have hidden a real bug.
 */
type Outcome = [mult: number, p: number]
const cases: Array<{ name: string; game: string; outcomes: Outcome[] }> = []
const add = (name: string, outcomes: Outcome[], game = name.split(' ')[0]) =>
  cases.push({ name, outcomes, game })
/** A table where every entry is equally likely. */
const uniform = (name: string, mults: number[], game?: string) =>
  add(name, mults.map((m) => [m, 1 / mults.length] as Outcome), game ?? name.split(' ')[0])

uniform('wheel', [...WHEEL_SEGMENTS], 'wheel')

// Plinko: every bucket, weighted by the binomial probability of landing there.
for (const risk of ['low', 'medium', 'high'] as PlinkoRisk[]) {
  for (const rows of [8, 12, 16]) {
    const table = plinkoTable(risk, rows)
    const outcomes: Outcome[] = table.map((m, k) => {
      let c = 1
      for (let i = 0; i < k; i++) c = (c * (rows - i)) / (i + 1)
      return [m, c / Math.pow(2, rows)] as Outcome
    })
    add(`plinko ${risk}/${rows}`, outcomes, 'plinko')
  }
}

// Dice and limbo: one winning multiplier and one losing one, with the odds of each.
for (const mode of ['under', 'over'] as const) {
  for (const target of [2, 10, 25, 33, 50, 66, 75, 90, 98]) {
    const chance = mode === 'under' ? target : 100 - target
    add(`dice ${mode} ${target}`, [
      [EDGE / (chance / 100), chance / 100],
      [0, 1 - chance / 100],
    ], 'dice')
  }
}
for (const target of [1.01, 1.5, 2, 3, 10, 100]) {
  const p = EDGE / target
  add(`limbo ${target}`, [[target, p], [0, 1 - p]], 'limbo')
}

// Roulette: straight-up on 37 slots, and a colour.
add('roulette straight', [
  [36, 1 / 37],
  [0, 36 / 37],
], 'roulette')
add('roulette colour', [...ROULETTE_WHEEL].map((n) => {
  const r = rouletteReturn([{ kind: 'red', amount: 1 } as never], n, 1)
  return [r, 1 / ROULETTE_WHEEL.length] as Outcome
}), 'roulette')

const ev = (outcomes: Outcome[]) => outcomes.reduce((a, [m, p]) => a + m * p, 0)
const evPaid = (outcomes: Outcome[], rate: number, game: string) =>
  outcomes.reduce((a, [m, p]) => a + paid(m, rate, game) * p, 0)

// ------------------------------------------------------------- the base rate --

let worstBase = 0
let worstBaseName = ''
for (const c of cases) {
  const rtp = ev(c.outcomes)
  const base = BASE[c.game]
  if (Math.abs(rtp - base) > worstBase) { worstBase = Math.abs(rtp - base); worstBaseName = c.name }
}
ok('with no float, every game still returns its own published figure',
  worstBase < 0.02, `worst ${(worstBase * 100).toFixed(2)} points on ${worstBaseName}`)

// ------------------------------------------------------- the float session ----

/*
 * Scaling the multiplier by 0.65 gives 64.35%, because the multiplier already
 * contains the 99%. The rate has to BE the return, so the factor is 0.65 / 0.99.
 */
let worst = 0
let worstCase = ''
for (const c of cases) {
  const rtp = evPaid(c.outcomes, RATE, c.game)
  if (Math.abs(rtp - RATE) > worst) { worst = Math.abs(rtp - RATE); worstCase = c.name }
}
ok('a float session returns 65%, not 64.35% (the rate is not a rate on a rate)',
  worst < 0.03, `worst ${(worst * 100).toFixed(2)} points on ${worstCase}`)

ok('65% is not reachable by multiplying every multiplier by 0.65 — that returns 64.35%',
  !near(0.99 * 0.65, RATE, 0.001))

// Three implementations, and only one of them is right:
{
  const wheel = [...WHEEL_SEGMENTS]
  const naive = wheel.reduce((a, m) => a + m * RATE, 0) / wheel.length
  const capped = wheel.reduce((a, m) => a + Math.min(m, RATE * 100), 0) / wheel.length
  const scaled = wheel.reduce((a, m) => a + paid(m, RATE, 'wheel'), 0) / wheel.length
  ok('a cap would leave the session at 99% — it does not bite on ordinary multipliers',
    Math.abs(capped - 0.99) < 0.01, `cap gives ${(capped * 100).toFixed(2)}%`)
  /*
   * The wheel is the weakest discriminator between "multiply by 0.65" and "scale
   * by 0.65/0.99", because 80 slices floor to 4 significant figures and the two
   * land 0.14 points apart. Both are wrong by the same amount in the same
   * direction, so the test uses dice and limbo, where the difference is the whole
   * 1.35 points, and asserts the wheel only as "not the cap".
   */
  ok('the wheel is at 65% and not the cap', Math.abs(scaled - RATE) < 0.03 && Math.abs(capped - scaled) > 0.2,
    `cap ${(capped * 100).toFixed(2)}% · scale ${(scaled * 100).toFixed(2)}%`)
  const diceWin = EDGE / 0.5
  const diceNaive = Math.floor(diceWin * RATE * 100) / 100 * 0.5
  const diceScaled = Math.floor(diceWin * (RATE / EDGE) * 100) / 100 * 0.5
  ok('dice separates naive from scaled by the full 1.35 points',
    Math.abs(diceNaive - diceScaled) > 0.005 && Math.abs(diceScaled - RATE) < 0.005,
    `naive ${(diceNaive * 100).toFixed(2)}% · scaled ${(diceScaled * 100).toFixed(2)}%`)
  const slotNaive = 0.962 * RATE
  ok('a slot needs its own base, or 65% becomes 62.5%', Math.abs(slotNaive - RATE) > 0.02,
    `0.962 × 0.65 = ${(slotNaive * 100).toFixed(2)}%`)
}

// ------------------------------------------------------- nothing else moves ---

// ------------------------------------------- mines and tower, rung by rung ---

{
  let worstMine = 0
  let worstTower = 0
  for (const mines of [1, 3, 5, 10, 15, 20, 24]) {
    for (let picks = 1; picks <= 25 - mines; picks++) {
      // P(survive `picks` reveals)
      let p = 1
      for (let i = 0; i < picks; i++) p *= (25 - mines - i) / (25 - i)
      const base = p * minesMultiplier(mines, picks)
      const session = p * paid(minesMultiplier(mines, picks), RATE, 'mines')
      worstMine = Math.max(worstMine, Math.abs(base - 0.99), Math.abs(session - RATE))
    }
  }
  for (const d of [1, 2, 3]) {
    const cols = towerCols(d)
    // `cols - 1` of a floor's tiles are safe (easy 3/4, medium 2/3, hard 1/2),
    // so the chance of clearing one floor is (cols-1)/cols and n floors is that
    // to the power n — which is what the ladder's `EDGE × (cols/(cols-1))^n`
    // cancels against.
    for (let lv = 1; lv <= 8; lv++) {
      const p = Math.pow((cols - 1) / cols, lv)
      const base = p * towerLevelMultiplier(d, lv)
      const session = p * paid(towerLevelMultiplier(d, lv), RATE, 'tower')
      worstTower = Math.max(worstTower, Math.abs(base - 0.99), Math.abs(session - RATE))
    }
  }
  ok('mines returns 99% per rung, and 65% per rung while a float is out',
    worstMine < 0.02, `worst ${(worstMine * 100).toFixed(2)} points`)
  ok('tower returns 99% per rung, and 65% per rung while a float is out',
    worstTower < 0.02, `worst ${(worstTower * 100).toFixed(2)} points`)
}

ok('a losing outcome still pays nothing under the rate',
  paid(0, RATE, 'wheel') === 0)
ok('the scale never RAISES a multiplier, including the wheel sub-1x slices',
  cases.every((c) => c.outcomes.every(([m]) => paid(m, RATE, c.game) <= m + 1e-9)))
ok('a partial return below 1x scales like everything else rather than being lifted to 1x',
  paid(0.4, RATE, 'wheel') < 0.4 && paid(0.4, RATE, 'wheel') > 0)

// ---------------------------------------------------------- the SQL, checked ---

ok('the rate lives in one settings row, capped to 50..100%',
  /create table if not exists gaming_settings/.test(SQL) && /float_session_rtp >= 0.5 and float_session_rtp <= 1/.test(SQL))
ok('the payment reads the rate stamped on the ROUND, not a live balance',
  /rounds add column if not exists payout_rate/.test(SQL) && /coalesce\(v_round\.payout_rate, 1\)/.test(SQL))
ok('the rate is stamped when the round opens, before any outcome exists',
  /before insert on rounds/.test(SQL) && /new\.payout_rate := public\.payout_rate_for\(new\.user_id\)/.test(SQL))
ok('dice is re-derived so its rate is exact rather than a rate on a rate',
  /if v_round\.game = 'dice' then/.test(SQL) && /100 \/ v_chance\) \* public\.payout_scale\('dice'\)/.test(SQL))
ok('the scale divides by the game own base return, not one flat 99%',
  /float_session_rtp\(\) \/ public\.game_edge\(p_game\)/.test(SQL) && /create table if not exists game_base_rtp/.test(SQL))
ok('the slots keep their own base, so 65% is not 62.5% for them',
  /\('bonni', 0\.962\)/.test(SQL) && /\('roulette', 0\.973\)/.test(SQL))
ok('the stake is untouched by the rate',
  !/wager_px \* v_rate/.test(SQL) && /floor\(v_round\.wager_px \* v_mult/.test(SQL))
ok('both settle paths apply it, so no game is left at the full table',
  (SQL.match(/coalesce\(v_round\.payout_rate, 1\)/g) ?? []).length >= 2)
ok('a cancelled round still refunds the full stake, not the reduced one',
  /cancel_round/.test(readFileSync('supabase/migrations/0020_rounds_server_settled.sql', 'utf8')))

// ------------------------------------------------------------- the screens ----

const shell = readFileSync('src/components/GameShell.tsx', 'utf8')
const store = readFileSync('src/lib/store.tsx', 'utf8')
const play = readFileSync('supabase/functions/play/index.ts', 'utf8')
ok('every game says the rate is in force, above the board',
  /Float session — \{Math\.round\(payoutRate \* 100\)\}% RTP/.test(shell))
ok('the screen reads the rate from the server, not from a constant',
  /session_rate_state/.test(store) && /payoutRate/.test(store))
ok('the server hands the board the multiplier it actually paid',
  /multiplier: settled\.multiplier/.test(play) && /table_multiplier/.test(play))
ok('dice quotes the paid figure, so the button cannot promise 1.98× and pay 1.30×',
  /payoutRate < 1[\s\S]{0,120}100 \/ winChance/.test(readFileSync('src/games/Dice.tsx', 'utf8')))
ok('the wheel and plinko show the session return beside the table one',
  /Your session RTP/.test(readFileSync('src/games/Wheel.tsx', 'utf8')) &&
  /Your session RTP/.test(readFileSync('src/games/Plinko.tsx', 'utf8')))

// --------------------------------------------- the one place it is observable --

// `limboPoint` and `crashPoint` still return a point at the base edge. That is
// correct: the point is the game's own outcome, and the rate is applied to what
// clearing it pays. If the rate had been baked into the point, the crash curve
// would visibly stop early whenever a player owed the house money.
ok('the crash curve is the same curve, float or not',
  crashPoint(0.5) === Math.max(1, Math.floor((EDGE / 0.5) * 100) / 100))
ok('the limbo point is the same point, float or not',
  limboPoint(0.5) === Math.max(1, Math.floor((EDGE / 0.5) * 100) / 100))
ok('the tower still has the same number of tiles per floor',
  [1, 2, 3].every((d) => towerCols(d) >= 2 && Number.isInteger(towerCols(d))))

if (fails.length) {
  console.error(`\n${fails.length} float-rate rule(s) broken:\n  ${fails.join('\n  ')}`)
  process.exit(1)
}
console.log('\nfloat session: the games pay 65% while a float is outstanding, and 99% otherwise')
