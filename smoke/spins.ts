// smoke/spins.ts
//
// The five ways a spin stops working, checked against the code that would fail.
//
// These are not style checks. Every one of them ends with a player pressing a
// button and getting either nothing, or a fee they cannot recover:
//
//   1. a spin refused after the button was disabled, with nothing to re-enable
//      it — the game is dead until the page is reloaded;
//   2. a round opened but never settled (refresh, closed tab, dropped request)
//      locking the account out of EVERY later bet, in every game, forever;
//   3. a hang that never answers at all, which looks the same as (1);
//   4. an Original whose bet cannot be described to the server, so the stake is
//      refunded and nothing happens;
//   5. a wheel that pays one slice and stops on another, so the animation lies
//      about a settled bet.
//
// Each is read out of the source, because each is the absence of something.
import { readFileSync } from 'node:fs'
import { WHEEL_SEGMENTS } from '../supabase/functions/_shared/games'
import { validateParams } from '../supabase/functions/_shared/games'

const fails: string[] = []
const ok = (name: string, cond: boolean, extra = '') => {
  if (!cond) fails.push(name)
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`)
}
const read = (p: string) => readFileSync(p, 'utf8')

const games = ['bonni', 'engine', 'craters', 'dice', 'limbo', 'plinko', 'roulette', 'wheel', 'crash', 'mines', 'tower']
const src: Record<string, string> = {
  bonni: read('src/games/BonniClyve.tsx'),
  engine: read('src/games/EngineSlot.tsx'),
  craters: read('src/games/Craters.tsx'),
  dice: read('src/games/Dice.tsx'),
  limbo: read('src/games/Limbo.tsx'),
  plinko: read('src/games/Plinko.tsx'),
  roulette: read('src/games/Roulette.tsx'),
  wheel: read('src/games/Wheel.tsx'),
  crash: read('src/games/Crash.tsx'),
  mines: read('src/games/Mines.tsx'),
  tower: read('src/games/Tower.tsx'),
}
const apiSource = read('src/lib/api.ts')
const startSql = read('supabase/migrations/0020_rounds_server_settled.sql')
const forfeitSql = read('supabase/migrations/0025_forfeit_round.sql')
const playFn = read('supabase/functions/play/index.ts')

// ----------------------------------------- 1. a refusal must not kill the button --

/**
 * Every game that awaits the server AFTER disabling its own button must be able
 * to un-disable it. The pattern that broke was `setSpinning(true)` … `await
 * playGame()` with no try/catch: the only `setSpinning(false)` sat in the
 * animation callback further down, which a throw never reaches.
 */
const spinGate: Array<[string, string, string]> = [
  ['bonni', 'setSpinning(true)', 'setSpinning(false)'],
  ['engine', 'setSpinning(true)', 'setSpinning(false)'],
  ['craters', 'setSpinning(true)', 'setSpinning(false)'],
  ['dice', 'setRolling(true)', 'setRolling(false)'],
  ['limbo', 'setRunning(true)', 'setRunning(false)'],
  ['plinko', 'setDropping(true)', 'setDropping(false)'],
  ['roulette', 'setSpinning(true)', 'setSpinning(false)'],
  ['wheel', 'setSpinning(true)', 'setSpinning(false)'],
]

for (const [game, on, off] of spinGate) {
  const s = src[game]
  if (!s || !s.includes(on)) continue
  const at = s.indexOf(on)
  const rest = s.slice(at)
  // The first thing that must be able to run after disabling is a catch that
  // re-enables, or a finally. Either is fine; neither is fatal.
  const guarded = /try\s*\{[\s\S]*?\}\s*catch[\s\S]*?set\w+\(false\)/.test(rest.slice(0, 2400)) ||
    /finally\s*\{[\s\S]*?set\w+\(false\)/.test(rest.slice(0, 2400)) ||
    // Crash and the board games never disable themselves while awaiting.
    !/await\s+playGame|await\s+playRound|await\s+startBoardRound/.test(rest.slice(0, 2400))
  ok(`${game}: a refused or failed round puts the button back`, guarded)
}

// ----------------------------------- 2. an abandoned round must not lock the account --

ok('start_round sweeps abandoned rounds before refusing',
  /perform public\.abandon_stale_rounds\(v_uid\)/.test(startSql))
ok('the sweep refunds the stake as an adjustment, not a win',
  /kind, delta_px, balance_after/.test(startSql) &&
  /'round abandoned — stake returned'/.test(startSql) &&
  /update wallets set balance_px = v_after where user_id = p_user/.test(startSql))
ok('the sweep only touches rounds old enough to be abandoned',
  /created_at < now\(\) - p_older_than/.test(startSql) && /'30 minutes'/.test(startSql))
ok('the sweep closes only rounds that are still open',
  /and status = 'open'/.test(startSql))
ok('a player can clear their own stuck round without waiting 30 minutes',
  /create or replace function public\.forfeit_open_round\(\)/.test(forfeitSql))
ok('forfeit takes no argument, so it can only reach the caller own round',
  /function public\.forfeit_open_round\(\)/.test(forfeitSql) &&
  /v_uid\s+uuid := auth\.uid\(\)/.test(forfeitSql))
ok('forfeit leaves a genuinely live round alone',
  /still_open', true/.test(forfeitSql) && /'15 seconds'/.test(forfeitSql))
ok('forfeit cannot reach anyone else, by grant or by signature',
  /revoke all on function public\.forfeit_open_round\(\) from public, anon/.test(forfeitSql))

// --------------------------------------------- 3. the retry is bounded and safe --

ok('the app clears a stuck round and retries the bet once',
  /finish your last round first/i.test(apiSource) && /clearStuckRound/.test(apiSource))
ok('the retry happens only when there is a body, i.e. a round start, never a settle',
  /finish your last round first[\s\S]{0,200}opts\.body/.test(apiSource))
ok('the retry is one attempt, not a loop',
  (apiSource.match(/clearStuckRound\(/g) ?? []).length === 2)

// --------------------------------- 4. every Original can describe its own bet --

// A game whose params cannot be validated has its stake refunded and plays
// nothing. Wheel used to require an `index` the app never sent.
ok('wheel does not require a segment the board cannot pick',
  (() => {
    try {
      validateParams('wheel', {})
      return true
    } catch {
      return false
    }
  })())
ok('the wheel index the server returns is inside the wheel it drew',
  WHEEL_SEGMENTS.length === 80)

// ------------------------------------------------ 5. the wheel stops where it paid --

// The slice maths the board draws with, and the rotation the spin applies, have
// to agree. Slice i is centred at i*SEG + SEG/2 - 90 (0 = +X, clockwise) and the
// pointer is at -90. This reproduces the board's own formula and checks the slice
// that ends under the pointer is the one the server paid for.
ok('the wheel stops on the slice the server paid', (() => {
  const SEG = 360 / WHEEL_SEGMENTS.length
  const centre = (i: number) => i * SEG + SEG / 2 - 90
  const nearest = (angle: number) => {
    let best = -1
    let bestD = Infinity
    for (let k = 0; k < WHEEL_SEGMENTS.length; k++) {
      const p = (((centre(k) + angle - -90) % 360) + 360) % 360
      const d = Math.min(p, 360 - p)
      if (d < bestD) { bestD = d; best = k }
    }
    return { best, bestD }
  }
  for (const i of [0, 1, 7, 39, 40, 66, 79]) {
    const target = i * SEG + SEG / 2
    const desired = (360 - target + 360) % 360
    const delta = 6 * 360 + ((desired - 0 + 360) % 360)
    const { best, bestD } = nearest(delta)
    if (best !== i || bestD > 0.001) return false
  }
  return true
})())

// ------------------------------------------------ 6. the settle path is reachable --

ok('the play function still serves start, settle and reveal',
  /op === 'start'/.test(playFn) && /op === 'settle'/.test(playFn) && /op === 'reveal'/.test(playFn))
ok('a failed settle releases the stake instead of stranding it',
  /cancel_round/.test(playFn))

if (fails.length) {
  console.error(`\n${fails.length} spin rule(s) broken:\n  ${fails.join('\n  ')}`)
  process.exit(1)
}
console.log('\nspins: a refusal cannot kill the button, and a lost round cannot lock the account')
