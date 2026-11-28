// smoke/board.ts
//
// End-to-end for the board games against the REAL deployed artifact.
//
// settle.ts re-tests the pure rules. This suite does the other half: it loads
// the flattened bundle that Supabase actually serves (`supabase/.dist/play.ts`,
// the same file the deploy uploads), points it at a stub of PostgREST + auth,
// and then attacks it the way a player with devtools would.
//
// What must hold:
//
//   * the start response never contains positions,
//   * a win is paid from the server's own multiplier, not the caller's,
//   * the layout only appears after the round is closed,
//   * cashing out twice pays once.

import { readFileSync } from 'node:fs'
import ts from 'typescript'

const PASS: string[] = []
const FAIL: string[] = []
function check(name: string, ok: boolean, extra = '') {
  if (ok) PASS.push(name)
  else FAIL.push(`${name}${extra ? ` — ${extra}` : ''}`)
}

// ------------------------------------------------------------------ the stub --
type Row = Record<string, unknown>

class Stub {
  rounds = new Map<number, Row>()
  balance = 1000
  nextId = 100
  private nonce = 4000
  private seed = 'test-server-seed'
  balanceNow() {
    return this.balance
  }

  private handle(path: string, method: string, body: Row | undefined): unknown {
    const url = new URL('http://x' + path)
    const table = url.pathname.replace('/rest/v1/', '')

    if (table.startsWith('fair_seeds')) return [{ server_seed: this.seed }]

    if (table.startsWith('rounds')) {
      const id = Number(url.searchParams.get('id')?.replace('eq.', '') ?? 0)
      const row = this.rounds.get(id)
      if (method === 'PATCH') {
        if (row) Object.assign(row, body)
        return []
      }
      return row ? [{ ...row }] : []
    }

    if (table === 'rpc/start_round') {
      const id = this.nextId++
      const wager = Number(body?.p_wager_px)
      this.balance -= wager
      this.rounds.set(id, {
        id, user_id: 'u1', game: String(body?.p_game), wager_px: wager,
        nonce: this.nonce++, status: 'open', params: body?.p_params ?? {}, board: null,
      })
      return { round: String(id), nonce: this.rounds.get(id)!.nonce, server_hash: 'h', balance: this.balance }
    }

    if (table === 'rpc/settle_round_server') {
      const id = Number(body?.p_round)
      const row = this.rounds.get(id)
      if (!row) throw new Error('no such round')
      if (row.status !== 'open') throw new Error('round already settled')
      const mult = Number(body?.p_multiplier)
      const payout = Math.floor(Number(row.wager_px) * mult + 1e-9)
      row.status = 'settled'
      this.balance += payout
      return { payout, balance: this.balance, multiplier: mult }
    }

    if (table === 'rpc/cancel_round') return null

    if (table === 'rpc/start_board_round') {
      const id = this.nextId++
      const wager = Number(body?.p_wager_px)
      this.balance -= wager
      this.rounds.set(id, {
        id,
        user_id: 'u1',
        game: String(body?.p_game),
        wager_px: wager,
        nonce: this.nonce++,
        status: 'open',
        params: {},
        board: null,
      })
      return { round: id, nonce: this.rounds.get(id)!.nonce, server_hash: 'h', balance: this.balance }
    }

    if (table === 'rpc/settle_board_round') {
      const id = Number(body?.p_round)
      const row = this.rounds.get(id)
      if (!row) throw new Error('no such round')
      // This stands in for the unique index on the real table.
      if (row.status !== 'open') throw new Error('round already settled')
      const mult = Number(body?.p_multiplier)
      const payout = Math.floor(Number(row.wager_px) * mult + 1e-9)
      row.status = 'settled'
      row.multiplier = mult
      this.balance += payout
      return { payout, balance: this.balance, multiplier: mult }
    }

    throw new Error(`stub: unhandled ${method} ${path}`)
  }

  async fetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
    const raw = String(input)
    if (raw.includes('/auth/v1/user')) return new Response(JSON.stringify({ id: 'u1' }), { status: 200 })

    const method = (init?.method ?? 'GET').toUpperCase()
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    const path = raw.replace(/^https?:\/\/[^/]+/, '')
    try {
      return new Response(JSON.stringify(this.handle(path, method, body) ?? null), { status: 200 })
    } catch (e) {
      return new Response(JSON.stringify({ message: (e as Error).message }), { status: 400 })
    }
  }
}

// ------------------------------------------------------- boot the real thing --

const stub = new Stub()
let handler: ((req: Request) => Promise<Response>) | null = null

Object.assign(globalThis, {
  Deno: {
    env: { get: (k: string) => (k === 'SUPABASE_URL' ? 'https://stub.local' : 'svc-key') },
    serve: (fn: (req: Request) => Promise<Response>) => {
      handler = fn
    },
  },
})
;(globalThis as unknown as { fetch: unknown }).fetch = stub.fetch.bind(stub)

// Type-strip exactly the bundle the deploy uploads, then load it.
const source = readFileSync('supabase/.dist/play.ts', 'utf8')
const js = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText
// A data: URL rather than a file, so nothing is written next to the source.
await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'))

if (!handler) throw new Error('the bundle did not register a handler')

async function op(name: string, body: Row): Promise<Record<string, unknown>> {
  const res = await (handler as (r: Request) => Promise<Response>)(
    new Request(`https://stub.local/play?op=${name}`, {
      method: 'POST',
      headers: { Authorization: 'Bearer t' },
      body: JSON.stringify(body),
    }),
  )
  return (await res.json()) as Record<string, unknown>
}

const hasPositions = (o: Record<string, unknown>) =>
  Object.values(o).some((v) => Array.isArray(v) && v.length > 1)

// ------------------------------------------------------------------- mines ----

const start = await op('start', { game: 'mines', wager: 100, params: { mines: 3 } })
const roundId = Number(start.round)
if (!roundId) {
  console.log('start failed:', JSON.stringify(start))
  process.exit(1)
}

check('a board round opens and debits the stake', Number(start.balance) === 900, `(${start.balance})`)
check('the start response says how big the grid is', start.grid === 25 && start.cols === 5)
check('the start response carries no mine positions', !hasPositions(start), JSON.stringify(start))

const stored = stub.rounds.get(roundId)?.board as { layout: number[] } | null
check('the layout lands in the round row, server-side', Array.isArray(stored?.layout) && stored!.layout.length === 3)

const layout = stored!.layout
const safeCell = [...Array(25).keys()].find((i) => !layout.includes(i))!
const mineCell = layout[0]

const one = await op('reveal', { round: roundId, cell: safeCell })
check('revealing a gem does not close the round', one.done === false && one.busted === false)
check('the reveal response still hides the minefield', !('mines_at' in one) && !hasPositions(one as Row))
check('the reveal shows the server-computed multiplier', Number(one.multiplier) === 1.13, `(${one.multiplier})`)

// A player tries to name their own price.
const cash = await op('reveal', { round: roundId, cell: 0, cashout: true, multiplier: 500, payout: 50000 })
// 100 at 1.13x is 113.00 — the float lands a hair under, so this also pins the
// payout formula against the truncation bug that would pay 112.
check('cashing out pays the server multiplier, not the caller’s', Number(cash.payout) === 113, `(${cash.payout})`)
check('the balance reflects the server payout', Number(cash.balance) === 1013, `(${cash.balance})`)

const again = await op('reveal', { round: roundId, cell: 0, cashout: true })
check('cashing out twice pays once', again.error !== undefined && stub.balanceNow() === 1013, `(${JSON.stringify(again)})`)

// Hitting a mine.
const bust = await op('start', { game: 'mines', wager: 100, params: { mines: 3 } })
const bustId = Number(bust.round)
const bustLayout = (stub.rounds.get(bustId)?.board as { layout: number[] }).layout
const hit = await op('reveal', { round: bustId, cell: bustLayout[0] })
check('hitting a mine ends the round with nothing paid', hit.busted === true && Number(hit.payout) === 0)
check('the minefield is revealed only after it no longer matters', Array.isArray(hit.mines_at))

// ------------------------------------------------------------------- tower ----

const t = await op('start', { game: 'tower', wager: 100, params: { difficulty: 1 } })
const tId = Number(t.round)
check('tower starts with eight floors and four columns', t.levels === 8 && t.cols === 4, `(${t.levels}/${t.cols})`)
check('the tower start response hides the safe tiles', !hasPositions(t as Row), JSON.stringify(t))

const safeTiles = (stub.rounds.get(tId)?.board as { layout: number[] }).layout
const wrong = safeTiles[0] === 0 ? 1 : 0
const fell = await op('reveal', { round: tId, cell: wrong })
check('a wrong tile ends the climb with nothing paid', fell.busted === true && Number(fell.payout) === 0)
check('the safe tiles are shown after the fall', Array.isArray(fell.safe_at))

const t2 = await op('start', { game: 'tower', wager: 100, params: { difficulty: 3 } })
const t2Id = Number(t2.round)
const t2Safe = (stub.rounds.get(t2Id)?.board as { layout: number[] }).layout
const up = await op('reveal', { round: t2Id, cell: t2Safe[0] })
check('a right tile advances the climb', up.done === false && up.level === 1)
// Hard tower is 2 columns, so floor 1 is 0.99 * 2 / 1 = 1.98x.
check('hard tower pays more per floor', Number(up.multiplier) === 1.98, `(${up.multiplier})`)

// --------------------------------------------------------------- the slots ---
//
// The six video slots now settle through the same `?op=start` / `?op=settle`
// path as the Originals. This exercises a real slot spin through the emitted
// edge bundle: the server draws the floats, derives the grid, and pays it.

for (const game of ['bonni', 'craters', 'chape', 'bluemountain', 'bazaar', 'boda']) {
  const started = await op('start', { game, wager: 100, params: {} })
  const id = Number(started.round)
  if (!id) {
    check(`${game}: opens a server round`, false, JSON.stringify(started))
    continue
  }
  const settled = await op('settle', { round: id })
  const cols = Number(settled.cols ?? 0)
  const grid = JSON.parse(String((settled.payload as Row)?.grid ?? '[]')) as string[][]
  check(`${game}: opens a server round`, true)
  check(`${game}: the server returns the reels`, grid.length > 0 && grid.every((c) => c.length > 0), `${grid.length} reels`)
  check(`${game}: the server sets the multiplier`, typeof settled.multiplier === 'number' && Number.isFinite(settled.multiplier as number), String(settled.multiplier))
  check(`${game}: payout matches wager × multiplier`,
    Number(settled.payout) === Math.floor(100 * Number(settled.multiplier) + 1e-9),
    `${settled.payout} vs ${Math.floor(100 * Number(settled.multiplier) + 1e-9)}`)
  void cols
}

// ----------------------------------------------------------------- verdict ---

for (const p of PASS) console.log(`ok   ${p}`)
for (const f of FAIL) console.log(`FAIL ${f}`)
console.log(`\nboard: ${PASS.length} passed, ${FAIL.length} failed`)
if (FAIL.length) process.exit(1)
