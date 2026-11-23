// supabase/functions/_shared/oddsfeed.ts
//
// Server-only client for The Odds API (the-odds-api.com). Edge-function port of
// api/_lib/oddsfeed.ts.
//
// NEVER import this from anything under src/ — the key must never reach the
// browser bundle. Same rule as DGATEWAY_API_KEY, and for the same reason: it is
// a billable credential and everything it fetches is done on the server.
//
// Cost model, which drives the whole design: one credit = one request for one
// sport + one market + one region. The free plan is 500 credits a month, about
// 16 polls a day. Polling more sports, or more often, spends the month's budget
// in an afternoon. Every function takes the sport keys it should fetch so the
// caller decides the spend, and the response headers are surfaced so the caller
// can log what is left.
//
// Odds arrive as American or decimal depending on the request. We ask for
// decimal and convert to the integer x100 the database uses, so the float never
// leaves this file.

export const ODDS_BASE = (Deno.env.get('ODDS_API_URL') || 'https://api.the-odds-api.com/v4')
  .replace(/\/$/, '')

export type FeedEvent = {
  id: string
  sport_key: string
  sport_title: string
  commence_time: string
  home_team: string
  away_team: string
  bookmakers: {
    key: string
    title: string
    last_update: string
    markets: { key: string; outcomes: { name: string; price: number }[] }[]
  }[]
}

export type FeedScore = {
  id: string
  completed: boolean
  home_team: string
  away_team: string
  scores: { name: string; score: string }[] | null
  last_update: string | null
}

export type FeedMeta = { used: number | null; remaining: number | null; last: number | null }

export class OddsFeedError extends Error {
  code: string
  status: number
  constructor(message: string, code: string, status = 502) {
    super(message)
    this.name = 'OddsFeedError'
    this.code = code
    this.status = status
  }
}

function key(): string {
  const k = (Deno.env.get('ODDS_API_KEY') || '').trim()
  if (!k) {
    throw new OddsFeedError(
      'ODDS_API_KEY is not configured on the server, so no odds can be fetched.',
      'ODDS_KEY_MISSING',
      503,
    )
  }
  return k
}

export function isFeedConfigured(): boolean {
  return Boolean((Deno.env.get('ODDS_API_KEY') || '').trim())
}

function metaOf(res: Response): FeedMeta {
  const num = (h: string) => {
    const v = res.headers.get(h)
    return v == null || v === '' ? null : Number(v)
  }
  return { used: num('x-requests-used'), remaining: num('x-requests-remaining'), last: num('x-requests-last') }
}

async function get<T>(path: string, params: Record<string, string>): Promise<{ data: T; meta: FeedMeta }> {
  const url = new URL(`${ODDS_BASE}${path}`)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  url.searchParams.set('apiKey', key())

  const res = await fetch(url, { headers: { accept: 'application/json' } })
  const text = await res.text()

  if (!res.ok) {
    // 401/422 are the two worth naming: a bad key and a bad sport key are the
    // mistakes that actually happen, and "502 from the feed" tells nobody that.
    if (res.status === 401) {
      throw new OddsFeedError('The Odds API rejected the key (401). Check ODDS_API_KEY.', 'ODDS_UNAUTHORIZED', 502)
    }
    if (res.status === 422) {
      throw new OddsFeedError(`The Odds API rejected the request (422): ${text.slice(0, 200)}`, 'ODDS_BAD_REQUEST', 502)
    }
    if (res.status === 429) {
      throw new OddsFeedError('The Odds API rate limit or monthly quota is exhausted (429).', 'ODDS_QUOTA', 429)
    }
    throw new OddsFeedError(`The Odds API failed (${res.status}): ${text.slice(0, 200)}`, 'ODDS_UPSTREAM', 502)
  }

  let parsed: unknown
  try {
    parsed = text ? JSON.parse(text) : null
  } catch {
    throw new OddsFeedError('The Odds API returned something that is not JSON.', 'ODDS_BAD_PAYLOAD', 502)
  }
  return { data: parsed as T, meta: metaOf(res) }
}

/**
 * Upcoming and live events for one sport, with bookmaker prices for one market.
 * One call = one credit.
 *
 * `regions` is deliberately narrow: 'eu' covers Pinnacle and 1xBet, the two
 * books whose prices are close enough to a fair line to build a board from.
 */
export async function fetchOdds(
  sportKey: string,
  opts: { regions?: string; markets?: string } = {},
): Promise<{ events: FeedEvent[]; meta: FeedMeta }> {
  const { data, meta } = await get<FeedEvent[]>(`/sports/${encodeURIComponent(sportKey)}/odds`, {
    regions: opts.regions ?? 'eu',
    markets: opts.markets ?? 'h2h',
    oddsFormat: 'decimal',
    dateFormat: 'iso',
  })
  return { events: Array.isArray(data) ? data : [], meta }
}

/** Scores for a sport, used for settlement. One credit. */
export async function fetchScores(sportKey: string, daysFrom = 3): Promise<{ events: FeedScore[]; meta: FeedMeta }> {
  const { data, meta } = await get<FeedScore[]>(`/sports/${encodeURIComponent(sportKey)}/scores`, {
    daysFrom: String(daysFrom),
    dateFormat: 'iso',
  })
  return { events: Array.isArray(data) ? data : [], meta }
}

/** Which sports are in season right now. Costs 0 credits — it is not billed. */
export async function fetchSports(): Promise<{ key: string; title: string; active: boolean }[]> {
  const { data } = await get<{ key: string; title: string; active: boolean }[]>('/sports', {})
  return Array.isArray(data) ? data : []
}

/**
 * Decimal odds -> the integer x100 the schema stores.
 *
 * Floor, not round, and clamped at the low end: rounding 1.005 up to 1.01 hands
 * the player a free half-percent of margin on every single bet, and a price of
 * 1.00 or below is not a bet, it is a mistake in the feed.
 */
export function toOddsX100(price: number): number {
  if (!Number.isFinite(price) || price <= 1) {
    throw new OddsFeedError(`Feed returned a nonsensical price: ${price}`, 'ODDS_BAD_PRICE', 502)
  }
  return Math.max(101, Math.floor(price * 100))
}

/**
 * Apply the house margin to a bookmaker's fair-ish price.
 *
 * A feed price is somebody else's line. Publishing it verbatim means running a
 * zero-margin book: you take all the risk of the market moving and keep none of
 * the compensation. Margin is taken by shortening the price, so the implied
 * probability rises.
 */
export function applyMargin(oddsX100: number, marginPct: number): number {
  const clamped = Math.min(Math.max(marginPct, 0), 25)
  const adjusted = oddsX100 * (1 - clamped / 100)
  return Math.max(101, Math.floor(adjusted))
}
