// supabase/functions/play/index.ts
//
// Server-settled arcade rounds.
//
// WHY THIS FUNCTION EXISTS
//
// The arcade used to settle in the browser. `settleRound` credited
// floor(wager * multiplier) with the multiplier supplied by the caller, and the
// result lived only in localStorage — so a refresh appeared to erase a win, the
// same deposit could be staked twice, and winnings were not real money.
//
// Now:
//
//   POST ?op=start   { game, wager, params }  -> debits the stake, opens a round
//   POST ?op=settle  { round, from, count? }  -> derives the outcome from the
//                                               SECRET seed and credits it
//
// The browser never sends a multiplier. It sends a game, a stake, and the
// parameters that describe the bet it wants (dice: a target; wheel: a segment).
// Everything that decides money is computed here from a seed the browser cannot
// read, using `_shared/games.ts` — the same file the browser imports, so the
// animation cannot disagree with the payout.
//
// The seed commitment is returned by `start` (the SHA-256 of the seed). The seed
// itself is not, and must not be: settlement is server-side, so it is never
// needed by the client, and withholding it is what stops a modified client from
// reading the result before deciding to "win".
import { json, preflight, readEnv } from '../_shared/http.ts'
import {
  SERVER_SETTLED,
  resolveBet,
  validateParams,
  floatsNeeded,
  mineLayout,
  minesMultiplier,
  MINE_CHOICES,
  MINE_GRID,
  towerLayout,
  towerCols,
  towerLevelMultiplier,
  TOWER_LEVELS,
  type GameId,
  type Params,
} from '../_shared/games.ts'

const SUPABASE_URL = readEnv('SUPABASE_URL')
const SERVICE_KEY = readEnv('SUPABASE_SERVICE_ROLE_KEY')

type User = { id: string }

async function requireUser(req: Request): Promise<User | null> {
  const auth = req.headers.get('Authorization') || ''
  if (!/^Bearer\s+\S+/i.test(auth)) return null
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: auth, apikey: SERVICE_KEY },
  })
  if (!res.ok) return null
  const body = (await res.json().catch(() => null)) as { id?: string } | null
  return body?.id ? { id: body.id } : null
}

async function svc<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    method: init?.method || 'GET',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  })
  const text = await res.text()
  const parsed = text ? (JSON.parse(text) as unknown) : null
  if (!res.ok) {
    // The database's own words, never a guessed cause: a player reading
    // "insufficient balance" needs the real reason.
    const message =
      (parsed as { message?: string } | null)?.message ||
      (parsed as { error?: string } | null)?.error ||
      `HTTP ${res.status}`
    throw new Error(message)
  }
  return parsed as T
}

const rpc = <T,>(fn: string, args: Record<string, unknown>) =>
  svc<T>(`/rest/v1/rpc/${fn}`, { method: 'POST', body: args })

/** Load a round the caller owns. Ownership is checked, not assumed. */
async function loadRound(roundId: string, userId: string) {
  const rows = await svc<
    { id: string; user_id: string; game: string; wager_px: number; nonce: number; status: string; params: Params | null }[]
  >(`/rest/v1/rounds?id=eq.${encodeURIComponent(roundId)}&select=id,user_id,game,wager_px,nonce,status,params`)
  const row = rows[0]
  if (!row) throw new Error('no such round')
  if (row.user_id !== userId) throw new Error('not your round')
  return row
}

/** The seed for this player, straightened out of the RPC's jsonb shape. */
async function seedFor(userId: string): Promise<{ seed: string }> {
  const rows = await svc<{ server_seed: string }[]>(
    `/rest/v1/fair_seeds?user_id=eq.${encodeURIComponent(userId)}&select=server_seed`,
  )
  const row = rows[0]
  if (!row) throw new Error('no seed for this player')
  return { seed: row.server_seed }
}

// ------------------------------------------------------------ determinism ----

const enc = new TextEncoder()

/**
 * The same HMAC-SHA256 derivation the arcade's fairness page already published:
 *   outcome = HMAC_SHA256(serverSeed, `${clientSeed}:${nonce}:${round}`)
 * 4 bytes per float, divided by 2^32.
 *
 * `clientSeed` is the fixed string 'server' for these rounds: the payout must be
 * reproducible by the server alone, and a player-supplied seed would let them
 * sweep seeds until they liked the result.
 */
async function floats(serverSeed: string, nonce: number, count: number): Promise<number[]> {
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(serverSeed),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const out: number[] = []
  let round = 0
  while (out.length < count) {
    const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(`server:${nonce}:${round}`)))
    for (let i = 0; i + 3 < sig.length && out.length < count; i += 4) {
      const v = sig[i] * 2 ** 24 + sig[i + 1] * 2 ** 16 + sig[i + 2] * 2 ** 8 + sig[i + 3]
      out.push(v / 4294967296)
    }
    round++
  }
  return out
}

// ---------------------------------------------------------------- handlers ---

async function start(req: Request, user: { id: string }): Promise<Response> {
  const body = (await req.json().catch(() => null)) as
    | { game?: string; wager?: number; params?: Params }
    | null
  if (!body) return json({ error: 'invalid JSON body' }, 400)

  const game = String(body.game || '') as GameId
  if (!SERVER_SETTLED.includes(game)) {
    return json({ error: 'that game is not settled by the server' }, 400)
  }

  const wager = body.wager
  if (typeof wager !== 'number' || !Number.isInteger(wager) || wager <= 0) {
    return json({ error: 'wager must be a whole positive number of shillings' }, 400)
  }

  /*
   * Board games get their layout built HERE, from the secret seed, and stored on
   * the round. It is never returned: the player explores it one cell at a time.
   * A client that received the layout would simply never step on a mine.
   */
  if (game === 'mines' || game === 'tower') {
    const mines = Number(body.params?.mines ?? 3)
    const difficulty = Number(body.params?.difficulty ?? 1)
    if (game === 'mines' && !(MINE_CHOICES as readonly number[]).includes(mines)) {
      return json({ error: 'choose 1, 3, 5, 10, 15, 20 or 24 mines' }, 400)
    }
    if (game === 'tower' && ![1, 2, 3].includes(difficulty)) {
      return json({ error: 'difficulty must be 1, 2 or 3' }, 400)
    }

    const started = await rpc<{ round: number; nonce: number; server_hash: string; balance: number }>(
      'start_board_round',
      { p_game: game, p_wager_px: wager, p_mines: mines, p_difficulty: difficulty },
    )

    // Build the board from the same seed stream the settle step will re-derive,
    // so it is reproducible from the commitment and not invented here.
    const { seed } = await seedFor(user.id)
    const fs = await floats(seed, started.nonce, game === 'mines' ? 25 : 8)
    const layout = game === 'mines' ? mineLayout(fs, mines) : towerLayout(fs, difficulty)
    await svc(`/rest/v1/rounds?id=eq.${started.round}`, {
      method: 'PATCH',
      body: { board: { ...(await boardOf(started.round)), layout, mines, difficulty } },
    })

    return json({
      ...started,
      game,
      params: { mines, difficulty },
      // Counts only. No layout, no positions.
      grid: game === 'mines' ? MINE_GRID : TOWER_LEVELS,
      cols: game === 'mines' ? 5 : towerCols(difficulty),
      levels: game === 'mines' ? 0 : TOWER_LEVELS,
    })
  }

  let params: Params
  try {
    params = validateParams(game, body.params || {})
  } catch (e) {
    return json({ error: (e as Error).message }, 400)
  }

  const started = await rpc<{ round: string; nonce: number; server_hash: string; balance: number }>('start_round', {
    p_game: game,
    p_wager_px: wager,
    p_params: params,
  })

  return json({ ...started, game, params })
}

/** The stored board for a round, service_role only. */
async function boardOf(roundId: number): Promise<Record<string, unknown>> {
  const rows = await svc<{ board: Record<string, unknown> | null }[]>(
    `/rest/v1/rounds?id=eq.${roundId}&select=board`,
  )
  return rows[0]?.board ?? {}
}

async function settle(req: Request, user: User): Promise<Response> {
  const body = (await req.json().catch(() => null)) as { round?: string } | null
  const roundId = String(body?.round || '').trim()
  if (!roundId) return json({ error: 'round is required' }, 400)

  const round = await loadRound(roundId, user.id)
  if (round.status !== 'open') return json({ error: `round already ${round.status}` }, 409)

  const game = round.game as GameId
  if (!SERVER_SETTLED.includes(game)) {
    return json({ error: 'that game is not settled by the server' }, 400)
  }

  let params: Params
  try {
    params = validateParams(game, round.params || {})
  } catch (e) {
    return json({ error: (e as Error).message }, 400)
  }

  const { seed } = await seedFor(user.id)
  const [u] = await floats(seed, round.nonce, 1)
  const outcome = resolveBet(game, params, u)

  // If settling throws, the stake must not stay stranded in an open round.
  try {
    const settled = await rpc<{ payout: number; balance: number; multiplier: number }>('settle_round_server', {
      p_round: roundId,
      p_multiplier: outcome.multiplier,
      p_u: outcome.u,
      p_detail: outcome.detail,
    })
    return json({
      round: roundId,
      game,
      multiplier: settled.multiplier,
      payout: settled.payout,
      balance: settled.balance,
      detail: outcome.detail,
      payload: outcome.payload ?? {},
    })
  } catch (e) {
    await rpc('cancel_round', { p_round: roundId }).catch(() => null)
    throw e
  }
}

/**
 * Reveal one cell, or cash out. The board is read here and nowhere else.
 *
 * This is the whole reason the layout lives server-side: the client learns one
 * cell per request, and only the cells it has already stepped on. It cannot see
 * the minefield, so it cannot walk it.
 */
async function reveal(req: Request, user: User): Promise<Response> {
  const body = (await req.json().catch(() => null)) as
    | { round?: string; cell?: number; cashout?: boolean }
    | null
  const roundId = Number(body?.round)
  if (!Number.isInteger(roundId) || roundId <= 0) return json({ error: 'round is required' }, 400)

  const round = await loadRound(String(roundId), user.id)
  if (round.status !== 'open') return json({ error: `round already ${round.status}` }, 409)

  const game = round.game as GameId
  if (game !== 'mines' && game !== 'tower') {
    return json({ error: 'not a board game' }, 400)
  }

  const board = await boardOf(roundId)
  const layout = (board.layout ?? []) as number[]
  const picks = (board.picks ?? []) as number[]
  const level = Number(board.level ?? 0)

  if (game === 'mines') {
    const mines = Number(board.mines ?? 3)
    const stepping = Number(body?.cell)
    const cashout = body?.cashout === true

    if (cashout) {
      if (picks.length === 0) return json({ error: 'reveal at least one tile first' }, 400)
      const mult = minesMultiplier(mines, picks.length)
      const settled = await settleBoard(roundId, mult, `${mines} mines · ${picks.length} gems`)
      return json({ ...settled, game, busted: false, mines, picks, done: true })
    }

    if (!Number.isInteger(stepping) || stepping < 0 || stepping >= MINE_GRID) {
      return json({ error: 'pick a tile from 0 to 24' }, 400)
    }
    if (picks.includes(stepping)) return json({ error: 'already revealed' }, 400)

    if (layout.includes(stepping)) {
      // Busted. Nothing is paid, and the stake is already gone.
      const settled = await settleBoard(roundId, 0, `${mines} mines · hit a mine on pick ${picks.length + 1}`)
      return json({
        ...settled, game, busted: true, mines, picks, done: true,
        // Only now is the truth shown: this is the customary reveal, and it is
        // safe because the round is already closed.
        mines_at: layout,
      })
    }

    const next = [...picks, stepping]
    await saveBoard(roundId, { ...board, picks: next })
    return json({
      game, busted: false, mines, picks: next, done: false,
      multiplier: minesMultiplier(mines, next.length),
      next_multiplier: minesMultiplier(mines, next.length + 1),
    })
  }

  // ---- tower ----
  const difficulty = Number(board.difficulty ?? 1)
  const cols = towerCols(difficulty)
  const stepping = Number(body?.cell)
  const cashout = body?.cashout === true

  if (cashout) {
    if (level === 0) return json({ error: 'climb at least one floor first' }, 400)
    const mult = towerLevelMultiplier(difficulty, level)
    const settled = await settleBoard(roundId, mult, `Climbed ${level} floors`)
    return json({ ...settled, game, busted: false, level, done: true })
  }

  const row = Math.floor(stepping / cols)
  const col = stepping % cols
  if (!Number.isInteger(stepping) || stepping < 0 || row !== level || col < 0 || col >= cols) {
    return json({ error: `pick a tile on floor ${level + 1}` }, 400)
  }

  if (layout[level] !== col) {
    const settled = await settleBoard(roundId, 0, `Fell on floor ${level + 1}`)
    return json({ ...settled, game, busted: true, level, done: true, safe_at: layout })
  }

  const next = level + 1
  const solved = next >= TOWER_LEVELS
  if (solved) {
    const mult = towerLevelMultiplier(difficulty, TOWER_LEVELS)
    const settled = await settleBoard(roundId, mult, `Cleared all ${TOWER_LEVELS} floors`)
    await saveBoard(roundId, { ...board, level: next })
    return json({ ...settled, game, busted: false, level: next, done: true })
  }

  await saveBoard(roundId, { ...board, level: next })
  return json({
    game, busted: false, level: next, done: false,
    multiplier: towerLevelMultiplier(difficulty, next),
    next_multiplier: towerLevelMultiplier(difficulty, next + 1),
  })
}

const settleBoard = (roundId: number, multiplier: number, detail: string) =>
  rpc<{ payout: number; balance: number; multiplier: number }>('settle_board_round', {
    p_round: roundId,
    p_multiplier: multiplier,
    p_detail: detail,
  })

const saveBoard = (roundId: number, board: Record<string, unknown>) =>
  svc(`/rest/v1/rounds?id=eq.${roundId}`, { method: 'PATCH', body: { board } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight()

  const user = await requireUser(req)
  if (!user) return json({ error: 'not authenticated' }, 401)

  const url = new URL(req.url)
  const op = url.searchParams.get('op') || ''

  try {
    if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)
    if (op === 'start') return await start(req, user)
    if (op === 'settle') return await settle(req, user)
    if (op === 'reveal') return await reveal(req, user)
    return json({ error: 'unknown operation' }, 400)
  } catch (e) {
    return json({ error: (e as Error).message || 'that request failed' }, 502)
  }
})
