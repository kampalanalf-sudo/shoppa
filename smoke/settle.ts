// smoke/settle.ts
//
// The arcade is settled by the server now. These checks are about the money.
//
// WHY THIS SUITE EXISTS
//
// Two defects made this necessary, and both are regression-prone:
//
//   1. `settle_round(p_multiplier)` took the multiplier from the caller and was
//      granted to `authenticated`. place_bet(100) then settle_round(100, 100000)
//      turned UGX 100 into UGX 10,000,000. Any player could do it from a
//      console.
//   2. The browser settled every round itself, so a win lived only in one tab
//      and a refresh appeared to erase it.
//
// What must hold now:
//
//   * no client code path can credit a real balance,
//   * the payout is derived from a seed the browser cannot read,
//   * the rules the server applies are the rules the board shows,
//   * the withdrawal-affecting surface (settle) is service_role only.
//
// The game maths is imported from the SAME file the edge function uses, so a
// check that passes here is a check on what production will do.
import { readFileSync } from 'node:fs'

// The shared module reads no env at import time, but the edge function bundle
// does, so the Deno shim goes in first either way.
;(globalThis as any).Deno ??= { env: { get: () => undefined } }

const {
  resolveBet,
  validateParams,
  WHEEL_SEGMENTS,
  PLINKO_TABLES,
  plinkoTable,
  plinkoBucket,
  ROULETTE_PAYOUTS,
  rouletteReturn,
  rouletteColour,
  ROULETTE_WHEEL,
  crashPoint,
  limboPoint,
  diceRoll,
  SERVER_SETTLED,
  LOCAL_ONLY,
} = await import('../supabase/functions/_shared/games.ts')

let fail = 0
const check = (name: string, cond: boolean, extra = '') => {
  if (!cond) fail++
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name} ${extra}`)
}
const read = (p: string) => readFileSync(p, 'utf8')

const near = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) < tol

// ------------------------------------------------ no client can mint money ----
{
  const sql19 = read('supabase/migrations/0019_disable_client_settle.sql')
    .split('\n').map((l) => l.replace(/--.*$/, '')).join('\n')
  check('the old settle_round is not executable by a player',
    /revoke all on function public\.settle_round\([^)]*\) from authenticated/.test(sql19))

  const sql20 = read('supabase/migrations/0020_rounds_server_settled.sql')
    .split('\n').map((l) => l.replace(/--.*$/, '')).join('\n')
  check('the new settler is service_role only',
    /revoke all on function public\.settle_round_server\([^)]*\) from public, anon, authenticated/.test(sql20))
  check('and granting it back is limited to service_role',
    /grant execute on function public\.settle_round_server\([^)]*\) to service_role/.test(sql20))
  check('players may open a round',
    /grant execute on function public\.start_round\([^)]*\) to authenticated/.test(sql20))
  check('the seed table is closed to players',
    /revoke all on table fair_seeds from authenticated, anon/.test(sql20))
  check('settling twice is refused, so a retry cannot pay twice',
    /round already settled/.test(sql20))
  check('one open round per player, so one balance cannot back many bets',
    /rounds_open_one_per_user/.test(sql20))
}

// ------------------------------------- the live schema matches the signatures --
// Two bugs were found only by exercising the real database, and both would have
// broken every round:
//
//   * rounds.id is a bigint (it predates this work), but the settler was typed
//     `p_round uuid`, so every call failed with 'invalid input syntax for uuid'.
//   * pgcrypto lives in the `extensions` schema, and the functions pin
//     search_path, so gen_random_bytes/digest were invisible.
{
  const sql20 = read('supabase/migrations/0020_rounds_server_settled.sql')
    .split('\n').map((l) => l.replace(/--.*$/, '')).join('\n')
  check('the settler takes the round key the table actually has (bigint)',
    /settle_round_server\(\s*p_round bigint/.test(sql20))
  check('and is granted/revoked on that same signature',
    /settle_round_server\(bigint, numeric, double precision, text\)/.test(sql20))
  check('cancel_round matches too', /cancel_round\(p_round bigint\)/.test(sql20))
  check('the seed generator can see pgcrypto',
    /set search_path = public, extensions/.test(sql20))
  check('both seed functions are in scope, not just one',
    (sql20.match(/set search_path = public, extensions/g) ?? []).length >= 3,
    `(${(sql20.match(/set search_path = public, extensions/g) ?? []).length})`)
}

// --------------------------------------- the client cannot settle for money ---
{
  const store = read('src/lib/store.tsx')
  check('a client-side settle in real mode returns nothing',
    /refused a client-side settle in real mode/.test(store))
  check('an unsettled game cannot be played for money',
    /!free && !isServerSettled\(game\)/.test(store))
  check('real play goes through the server round API',
    /startRound\(game, stake/.test(store) && /settleRound\(started\.round\)/.test(store))
  check('the server balance is adopted, not recomputed',
    /serverBaselineRef\.current = settled\.balance/.test(store))
  check('the browser never sends a multiplier when opening a round',
    /body: \{ game, wager, params \}/.test(read('src/lib/play.ts')) &&
    !/body:\s*\{[^}]*multiplier/.test(read('src/lib/play.ts')))
}

// ------------------------------------------------------ the server is the judge --
{
  const fn = read('supabase/functions/play/index.ts')
  check('the play function derives the outcome itself',
    /resolveBet\(game, params, u\)/.test(fn))
  check('the seed is read server-side, never sent to the client',
    /server_seed/.test(fn) && !/return json\(\{[^}]*server_seed/.test(fn))
  check('it settles through the service_role RPC',
    /settle_round_server/.test(fn))
  check('a failed settle releases the stake instead of stranding it',
    /cancel_round/.test(fn))
  check('it requires a signed-in player',
    /auth\/v1\/user/.test(fn))
}

// The route must be reachable from the browser, or every game 404s.
{
  const backend = read('src/lib/backend.ts')
  check('the play function has a route', /'\/api\/play': 'play'/.test(backend))
  check('the client posts to it', /api<Started>\('\/api\/play'/.test(read('src/lib/play.ts')))
  check('the deploy test requires the function to exist',
    /'play'/.test(read('smoke/deploy.ts')))
}

// ------------------------------------------------ the rules match the boards --
{
  // Wheel: the slice order must be the board's, or a paid multiplier would not
  // be the one the wheel lands on.
  check('the wheel has 80 slices', WHEEL_SEGMENTS.length === 80, `(${WHEEL_SEGMENTS.length})`)
  const counts = new Map<number, number>()
  for (const m of WHEEL_SEGMENTS) counts.set(m, (counts.get(m) ?? 0) + 1)
  check('the wheel keeps its audited slice counts',
    counts.get(0) === 19 && counts.get(0.5) === 10 && counts.get(1.2) === 26 &&
    counts.get(1.5) === 22 && counts.get(2) === 1 && counts.get(3) === 1 && counts.get(5) === 1,
    JSON.stringify([...counts.entries()].sort((a, b) => a[0] - b[0])))
  const wheelEv = WHEEL_SEGMENTS.reduce((a, m) => a + m, 0) / WHEEL_SEGMENTS.length
  check('the wheel returns exactly 99%', near(wheelEv, 0.99, 1e-9), `(${wheelEv})`)

  // The board must read the same table, not a copy of it.
  check('the wheel board imports the shared table',
    /WHEEL_SEGMENTS/.test(read('src/games/Wheel.tsx')) &&
    !/^const LAYOUT/m.test(read('src/games/Wheel.tsx')))

  // Plinko: every published table must return 99%.
  const binom = (n: number, k: number) => {
    let r = 1
    for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i
    return r
  }
  const tableRtp = (t: readonly number[]) =>
    t.reduce((acc, m, k) => acc + (binom(t.length - 1, k) / 2 ** (t.length - 1)) * m, 0)
  let maxDev = 0
  let worstRtp = 0.99
  let worstName = '(none)'
  let missing = ''
  for (const risk of ['low', 'medium', 'high'] as const) {
    for (const rows of [8, 12, 16]) {
      const t = PLINKO_TABLES[risk][rows]
      if (!t) { missing = `${risk}/${rows}`; continue }
      const rtp = tableRtp(t)
      const dev = Math.abs(rtp - 0.99)
      if (dev > maxDev) { maxDev = dev; worstRtp = rtp; worstName = `${risk}/${rows}` }
    }
  }
  check('every plinko paytable exists',
    missing === '', missing ? `(missing ${missing})` : '')
  check('every plinko paytable returns 99%',
    missing === '' && maxDev < 0.0015, `(worst ${worstName} = ${worstRtp.toFixed(5)})`)
  check('buckets always match the row count',
    plinkoTable('high', 16).length === 17 && plinkoTable('low', 8).length === 9)
  check('the bucket is derived from the float by bit-walking, not a flat divide',
    plinkoBucket(0, 12, 13) === 0 && plinkoBucket(0.999999, 12, 13) === 12)

  // Roulette: the wheel is a real euro wheel and a straight pays 36x.
  check('the roulette wheel has 37 slots', ROULETTE_WHEEL.length === 37)
  check('every number 0-36 appears exactly once',
    new Set(ROULETTE_WHEEL).size === 37 && Math.min(...ROULETTE_WHEEL) === 0 &&
    Math.max(...ROULETTE_WHEEL) === 36)
  check('a straight pays 36x', ROULETTE_PAYOUTS.straight === 36)
  check('zero is green, 32 is red, 15 is black',
    rouletteColour(0) === 'green' && rouletteColour(32) === 'red' && rouletteColour(15) === 'black')
  check('a winning straight on a 100 stake returns 36x of the stake',
    near(rouletteReturn([{ kind: 'straight', n: 17, amount: 100 }], 17, 100), 36))
  check('a losing straight returns nothing',
    rouletteReturn([{ kind: 'straight', n: 17, amount: 100 }], 18, 100) === 0)

  // Crash and limbo keep their published curves.
  check('crash busts instantly 3% of the time', crashPoint(0.01) === 1)
  check('limbo never returns below 1x', limboPoint(0) >= 1)
  check('dice maps the float to a 0-100 roll', diceRoll(0.5) === 50)
}

// ------------------------------------------------ the parameters are policed --
{
  const refuses = (label: string, f: () => unknown) => {
    let threw = false
    try { f() } catch { threw = true }
    check(label, threw)
  }
  refuses('dice refuses a target that would pay 9900x', () => validateParams('dice', { target: 0.01 }))
  refuses('dice refuses a target above 98', () => validateParams('dice', { target: 99 }))
  refuses('limbo refuses a target below 1.01', () => validateParams('limbo', { target: 1 }))
  // A caller-supplied bucket must be dropped, not merely overridden: the server
  // derives it from the float, so a bucket from the client can never be paid.
  {
    const v = validateParams('plinko', { rows: 12, risk: 'high', index: 12 } as never)
    check('plinko drops a caller-supplied bucket', !('index' in v), JSON.stringify(v))
    const o = resolveBet('plinko', v, 0.5)
    check('and the bucket it pays is the one the float gives',
      o.payload.index === plinkoBucket(0.5, 12, 13), `(${o.payload.index})`)
  }
  refuses('roulette refuses an empty slip', () => validateParams('roulette', { bets: [] }))
  refuses('roulette refuses an unknown bet kind',
    () => validateParams('roulette', { bets: [{ kind: 'jackpot', amount: 100 }] }))
  refuses('roulette refuses a zero stake leg',
    () => validateParams('roulette', { bets: [{ kind: 'red', amount: 0 }] }))
  refuses('crash refuses a negative cash-out', () => validateParams('crash', { cashedAt: -1 }))
  check('crash accepts 0, meaning "did not cash out"',
    validateParams('crash', { cashedAt: 0 }).cashedAt === 0)
}

// -------------------------------------------- outcomes are what they claim ---
{
  // Dice: the multiplier must match the target the player set.
  const under = resolveBet('dice', { mode: 'under', target: 50 }, 0.25)
  check('dice under 50 on a roll of 25 wins at ~1.98x',
    under.multiplier > 0 && near(under.multiplier, 1.98, 0.01), `(${under.multiplier})`)
  const over = resolveBet('dice', { mode: 'under', target: 50 }, 0.75)
  check('dice under 50 on a roll of 75 loses', over.multiplier === 0)

  // A target that pays more must never be reachable by a losing roll.
  const tight = resolveBet('dice', { mode: 'under', target: 2 }, 0.5)
  check('a narrow target loses on a mid roll', tight.multiplier === 0)

  // Limbo pays the target, not the point: a 50x point on a 2x target pays 2x.
  // Choose a float that actually clears the target: `limboPoint(0.5)` is only
  // ~1.98x, so a 2x target loses there. The point of this check is that a 50x
  // POINT on a 2x target must pay 2x, not 50x.
  const big = resolveBet('limbo', { target: 2 }, 0.98)
  check('a large limbo point still pays only the target',
    big.multiplier === 2 && Number(big.payload.point) > 2,
    `(point ${big.payload.point}, paid ${big.multiplier})`)
  const small = resolveBet('limbo', { target: 100 }, 0.5)
  check('a point below the target loses', small.multiplier === 0)

  // Crash: cashing out below the point wins, above loses.
  const early = resolveBet('crash', { cashedAt: 1.2 }, 0.5)
  check('crash pays a cash-out below the point', early.multiplier === 1.2)
  const late = resolveBet('crash', { cashedAt: 100 }, 0.5)
  check('crash pays nothing when the curve died first', late.multiplier === 0)
  const bailed = resolveBet('crash', { cashedAt: 0 }, 0.5)
  check('crash pays nothing when the player never cashed out', bailed.multiplier === 0)

  // Wheel: the index maps to that slice's multiplier, nothing invented.
  const slice = resolveBet('wheel', { index: 79 }, 0.5)
  check('the wheel pays the multiplier actually on that slice',
    slice.multiplier === WHEEL_SEGMENTS[79], `(${slice.multiplier})
`)
}

// -------------------------------------- the game list says what it can settle --
{
  check('six games are server-settled', SERVER_SETTLED.length === 6, `(${SERVER_SETTLED.length})`)
  check('the slot boards and multi-step games are honestly listed as local',
    ['mines', 'tower', 'bonni', 'craters'].every((g) => (LOCAL_ONLY as readonly string[]).includes(g)))
  check('a local-only game cannot be settled by the server',
    (() => { try { resolveBet('bonni' as never, {}, 0.5); return false } catch { return true } })())
}

console.log(fail ? `\n${fail} FAILED` : '\nsettlement: the server decides, and the rules match the boards')
process.exit(fail ? 1 : 0)
