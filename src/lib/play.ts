// src/lib/play.ts
//
// Starting and settling a real-money round.
//
// This file replaces the client's old `settleBet`, which credited
// floor(wager * multiplier) from a multiplier the caller supplied. That was a
// printer reachable from a console, and it meant a result lived only in one
// browser's localStorage.
//
// The browser now:
//
//   1. asks the server to open a round (it debits the stake),
//   2. gets back a nonce and the SEED HASH — never the seed,
//   3. asks the server to settle, and receives the outcome it must animate.
//
// It never sends a multiplier, and it cannot compute the result before asking:
// the seed is withheld precisely so that a modified client cannot peek.
//
// Free play is untouched. It has no server row and never will: fake credits that
// can turn into money are the defect this whole area keeps producing.
import { api } from './api'
import type { GameId, Params } from '../../supabase/functions/_shared/games'

/** Games the server settles. Kept in step with _shared/games.ts. */
export const SERVER_SETTLED: readonly GameId[] = [
  'dice', 'limbo', 'wheel', 'plinko', 'roulette', 'crash', 'mines', 'tower',
  'bonni', 'craters', 'chape', 'bluemountain', 'bazaar', 'boda',
]

export const isServerSettled = (game: GameId) => SERVER_SETTLED.includes(game)

export type Started = {
  round: string
  nonce: number
  /** SHA-256 of the secret seed, so the bet can be shown to be pre-committed. */
  server_hash: string
  /** Already debited by the server. */
  balance: number
  game: GameId
  params: Params
}

export type Settled = {
  round: string
  game: GameId
  multiplier: number
  /** Total return including the stake, in whole shillings. */
  payout: number
  balance: number
  detail: string
  payload: Record<string, number | string>
}

/**
 * Open a round. The stake is taken here, by the server, against the real wallet.
 *
 * Throws with the server's own wording, which is what the player should see:
 * "insufficient balance" is a real answer and far better than a guess.
 */
export function startRound(game: GameId, wager: number, params: Params = {}): Promise<Started> {
  return api<Started>('/api/play', { method: 'POST', params: { op: 'start' }, body: { game, wager, params } })
}

/** Settle the open round. The server decides the multiplier; we only render it. */
export function settleRound(round: string): Promise<Settled> {
  return api<Settled>('/api/play', { method: 'POST', params: { op: 'settle' }, body: { round } })
}

// ------------------------------------------------------------- board games ----

export type BoardStart = Started & {
  mines?: number
  difficulty?: number
  /** Mine tiles (25) or tower floors (8). Counts only — never the layout. */
  grid?: number
  cols?: number
}

/** Open a Mines or Tower round. The layout stays on the server. */
export function startBoardRound(
  game: 'mines' | 'tower',
  wager: number,
  params: { mines?: number; difficulty?: number },
): Promise<BoardStart> {
  return api<BoardStart>('/api/play', { method: 'POST', params: { op: 'start' }, body: { game, wager, params } })
}

export type Reveal = {
  game: GameId
  busted: boolean
  done: boolean
  /** Mines: the tiles revealed so far. Tower: the floor reached. */
  picks?: number[]
  level?: number
  mines?: number
  multiplier?: number
  next_multiplier?: number
  payout?: number
  balance?: number
  /** Revealed only once the round is closed. */
  mines_at?: number[]
  safe_at?: number[]
}

/**
 * Step on one cell, or cash out.
 *
 * The board never leaves the server, so this is the only way to learn a cell.
 * The answer to "was that a mine" comes back with the round already settled.
 */
export function revealCell(round: string, cell: number, cashout = false): Promise<Reveal> {
  return api<Reveal>('/api/play', {
    method: 'POST',
    params: { op: 'reveal' },
    body: { round, cell, cashout },
  })
}
