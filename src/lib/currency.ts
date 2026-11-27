/**
 * The currency, in one place.
 *
 * FloatBet has exactly ONE currency: the Ugandan Shilling. There is no in-game
 * coin, no peg, and no conversion. A balance is a whole number of shillings and
 * is displayed as `UGX 25,000`.
 *
 * PX is gone. It existed as an in-house coin pegged (last at 100 PX = 1 UGX) to
 * UGX, which meant every screen had to say two numbers for one amount, and every
 * bug had a second chance to get the conversion wrong. The peg was also wrong in
 * the database for a while: `apply_gateway_result` still credited
 * `amount * 10` after the peg moved to 100, so a real UGX 1,000 top-up credited a
 * tenth of what it should. One currency deletes that entire class of bug.
 *
 * FREE PLAY is the second mode, and it is deliberately kept apart:
 *
 *   - its balance is separate and stored under its own key
 *   - credits are fictional and reset; they can never be topped up with UGX
 *   - winnings in free play can never be withdrawn or transferred to real money
 *   - every surface that shows a free-play balance says so, in words
 *
 * The point of the separation is that no amount of play — and no bug — can turn
 * free credits into cash.
 */

/** The only real currency. Amounts are whole shillings. */
export const CURRENCY = 'UGX'

/** Smallest real stake, in shillings. */
export const MIN_BET = 100

/** Largest stake we accept from a single game round. */
export const MAX_BET = 10_000_000

/** Real stakes are whole shillings: there is no useful sub-unit. */
export const isWholeShilling = (v: number) => Number.isInteger(v)

// ---------------------------------------------------------------- free play --

/**
 * Free-play starting credits.
 *
 * Free play is still denominated in UGX so the games read identically in both
 * modes — a 1,000 bet is a 1,000 bet. What makes it Fake is the mode, not the
 * unit, and the UI says so everywhere it matters.
 */
export const FREE_PLAY_START = 1_000_000

/** Free play cannot be topped up. This is the whole balance, refillable. */
export const FREE_PLAY_REFILL = 1_000_000

/** Stored separately so a real balance can never be read as a fake one. */
export const FREE_PLAY_KEY = 'floatbet.freeplay.v1'

export type PlayMode = 'real' | 'free'

/** Human label for a mode, for headers and badges. */
export const MODE_LABEL: Record<PlayMode, string> = {
  real: 'Real money',
  free: 'Free play',
}

/**
 * The daily login bonus, in UGX.
 *
 * It was 15,000 PX. At the peg the UI advertised that was worth UGX 150, which is
 * too small to be a reason to come back now that it is the only currency, so it
 * is UGX 150 -> rounded to a figure that reads as money. The database credits the
 * real amount; this constant is what the UI promises.
 */
export const DAILY_BONUS_UGX = 150
