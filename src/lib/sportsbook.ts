// src/lib/sportsbook.ts
//
// Reading the sportsbook, and placing one bet on it.
//
// Two rules this module exists to keep:
//
// 1. The browser never sends a price. `place_sports_bet(selection, stake)` reads
//    the odds server-side and snapshots them onto the slip. If a client could
//    name its own multiplier it would name 50.0 and take the house for
//    everything — so the only numbers that leave here are a selection id and a
//    stake.
//
// 2. The browser never settles. Settling is a service_role function called by
//    the result job. A client that can settle its own bet can declare itself a
//    winner.
//
// Odds travel as integers ×100 (250 = 2.50). They are formatted only at the
// edge, in `fmtOdds`, so no float ever touches a payout calculation.
import { supabase } from './supabase'
import { PX_PER_UGX } from './proxicash'

export type Sport = 'football' | 'basketball' | 'athletics' | 'motorsport' | 'cricket' | 'rugby' | 'tennis'

export type Fixture = {
  id: string
  sport: Sport
  league: string
  home_team: string
  away_team: string
  starts_at: string
  venue: string | null
  status: 'upcoming' | 'live' | 'settled' | 'void'
  result: string | null
  /** 'manual' or a feed name ('oddsapi'). Null on rows predating the feed. */
  source?: string | null
  home_score?: number | null
  away_score?: number | null
}

export type Selection = {
  id: string
  market_id: string
  name: string
  odds_x100: number
  is_active: boolean
  /** When this price was written. The server refuses bets on a stale price. */
  price_at?: string
}

export type Market = {
  id: string
  fixture_id: string
  name: string
  is_open: boolean
  winning_selection_id: string | null
  /** Stake ceiling, if the market sets its own. */
  max_stake_px?: number | null
  sports_selections: Selection[]
}

/** Same default the database applies, so the UI blocks what the server blocks. */
export const DEFAULT_MAX_STAKE_PX = 500_000
/**
 * Same default as place_sports_bet: prices older than this are refused.
 * Matches the feed cadence (every 4h, pg_cron) plus 10 minutes of slack. If the
 * cron ever stalls, prices age past this and betting shuts itself off, so this
 * doubles as a feed-liveness watchdog.
 */
export const MAX_PRICE_AGE_SECONDS = 15_000

/** True when a price is old enough that the server will reject a bet on it. */
export function isPriceStale(priceAt: string | undefined, now = Date.now()): boolean {
  if (!priceAt) return false
  const t = new Date(priceAt).getTime()
  if (!Number.isFinite(t)) return false
  return (now - t) / 1000 > MAX_PRICE_AGE_SECONDS
}

export type Slip = {
  id: string
  fixture_id: string
  market_id: string
  selection_id: string
  stake_px: number
  odds_x100: number
  potential_px: number
  status: 'open' | 'won' | 'lost' | 'void' | 'cashed_out'
  payout_px: number
  settled_at: string | null
  created_at: string
}

export type SelectionWithContext = Selection & {
  marketName: string
  fixture: Fixture
}

/** 250 -> "2.50". Integer in, string out; never a float. */
export function fmtOdds(oddsX100: number): string {
  return (oddsX100 / 100).toFixed(2)
}

/** Whole PX, never a fraction: the wallet is BIGINT and 10 PX = 1 UGX. */
export function potentialPayout(stakePx: number, oddsX100: number): number {
  return Math.floor((stakePx * oddsX100) / 100)
}

export async function loadBoard(): Promise<{ fixtures: Fixture[]; markets: Market[] }> {
  if (!supabase) return { fixtures: [], markets: [] }

  const { data: fixtures, error: fErr } = await supabase
    .from('sports_fixtures')
    .select('*')
    .in('status', ['upcoming', 'live'])
    // The free odds tier is pre-match only, so a fixture that has kicked off
    // has no live price and must not be on the board.
    .gt('starts_at', new Date().toISOString())
    .order('starts_at', { ascending: true })
    .limit(40)
  if (fErr) throw new Error(fErr.message)

  const ids = (fixtures ?? []).map((f) => (f as Fixture).id)
  if (!ids.length) return { fixtures: [], markets: [] }

  const { data: markets, error: mErr } = await supabase
    .from('sports_markets')
    .select('*, sports_selections(*)')
    .in('fixture_id', ids)
    .order('created_at', { ascending: true })
  if (mErr) throw new Error(mErr.message)

  return {
    fixtures: (fixtures ?? []) as Fixture[],
    markets: (markets ?? []) as Market[],
  }
}

export async function loadSlips(userId: string): Promise<Slip[]> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from('sports_bets')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(50)
  if (error) throw new Error(error.message)
  return (data ?? []) as Slip[]
}

/**
 * Place a bet. Returns the new balance so the caller can update without a
 * second round trip.
 */
export async function placeBet(selectionId: string, stakePx: number): Promise<void> {
  if (!supabase) throw new Error('Backend is not configured.')
  if (!Number.isInteger(stakePx) || stakePx <= 0) {
    throw new Error('Stake must be a whole, positive number of PX.')
  }
  const { error } = await supabase.rpc('place_sports_bet', {
    p_selection: selectionId,
    p_stake_px: stakePx,
  })
  if (error) throw new Error(error.message)
}

/** PX -> UGX, for showing a stake in the money people actually think in. */
export function stakeUgx(px: number): number {
  return Math.floor(px / PX_PER_UGX)
}

/** Human countdown. Empty string once the event has started. */
export function startsIn(iso: string, now = Date.now()): string {
  const ms = new Date(iso).getTime() - now
  if (!Number.isFinite(ms) || ms <= 0) return ''
  const mins = Math.floor(ms / 60000)
  if (mins < 60) return `in ${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `in ${hours}h ${mins % 60}m`
  return `in ${Math.floor(hours / 24)}d ${hours % 24}h`
}

export const SPORT_LABEL: Record<Sport, string> = {
  football: 'Football',
  basketball: 'Basketball',
  athletics: 'Athletics',
  motorsport: 'Motorsport',
  cricket: 'Cricket',
  rugby: 'Rugby',
  tennis: 'Tennis',
}
