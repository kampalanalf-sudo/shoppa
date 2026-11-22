import { asset } from './games'

/**
 * Promotional art for the board.
 *
 * WHY THIS IS KEYED ON TEAMS AND NOT FIXTURES
 *
 * The first version mapped four specific fixtures -- "Manchester City v Fulham",
 * "Newcastle United v Arsenal" -- and it worked for exactly one day. The odds
 * feed replaces the slate as matches kick off, so within 24 hours every image
 * was attached to a fixture that had already been played and filtered off the
 * board. The art did not break; it simply stopped applying, which on screen is
 * indistinguishable from never having existed.
 *
 * Keying on the club instead means an image stays useful for as long as that
 * club is in the feed, which is months rather than hours.
 *
 * There is also a sport-level fallback, so every football card has art even when
 * both teams are ones we have never drawn. A board where some cards have banners
 * and others have none looks broken; a board where they all have one looks
 * deliberate. That is the whole point of the fallback.
 */

/** Club banner. Keys are normalised club names -- see `norm()`. */
const TEAM_ART: Record<string, string> = {
  'liverpool': asset('/art/teams/liverpool.webp'),
  'arsenal': asset('/art/teams/arsenal.webp'),
  'manchester-united': asset('/art/teams/manchester-united.webp'),
  'manchester-city': asset('/art/teams/manchester-city.webp'),
  'chelsea': asset('/art/teams/chelsea.webp'),
  'tottenham-hotspur': asset('/art/teams/tottenham-hotspur.webp'),
  'aston-villa': asset('/art/teams/aston-villa.webp'),
}

/** Used when neither club has its own banner. */
const SPORT_ART: Record<string, string> = {
  football: asset('/art/teams/fallback-football.webp'),
}

/** The front-page sports band. Separate from per-fixture art. */
export const SPORTS_HERO = asset('/art/sports-hero.webp')

/**
 * Only the suffixes that genuinely vary between feeds. "United" and "City" are
 * kept: they are part of the club's name, and stripping them would collide
 * Manchester United with Newcastle United and Manchester City with Leicester.
 */
const norm = (team: string): string =>
  team
    .toLowerCase()
    .replace(/\b(fc|afc|cf|sc)\b/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

/**
 * Art for a fixture. Never returns null for a sport we have a fallback for, so
 * the card always has a visual.
 *
 * Home club first: the home side is what a banner is normally built around, and
 * it keeps a given fixture looking stable rather than flipping depending on
 * which club happens to be listed first.
 */
export function artFor(home: string, away: string, sport: string): string | null {
  return (
    TEAM_ART[norm(home)] ??
    TEAM_ART[norm(away)] ??
    SPORT_ART[sport.toLowerCase()] ??
    null
  )
}
