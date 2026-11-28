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
export const SERVER_SETTLED: readonly GameId[] = ['dice', 'limbo', 'wheel', 'plinko', 'roulette', 'crash']

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
