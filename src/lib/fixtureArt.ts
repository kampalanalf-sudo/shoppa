import { asset } from './games'

/**
 * Promotional art for the board's featured fixtures.
 *
 * Hand-picked rather than generated per fixture, for two reasons:
 *
 *  1. Cost and weight. A picture per match would mean dozens of images and a
 *     heavy page on a mobile connection. Four marquee banners plus a hero give
 *     the board its visual character for a fraction of the bytes.
 *  2. Editorial control. Fixture art names real players, so each image is a
 *     deliberate choice rather than an automatic consequence of whatever the
 *     feed published. An unattended generator would happily produce a
 *     likeness for a fixture nobody vetted.
 *
 * Keyed by a normalised "home away" pair, because the feed re-creates fixtures
 * with new ids on every sync — a key on id would break the moment the feed
 * refreshes. The normaliser strips the suffixes clubs carry in one feed and not
 * another ("Manchester City FC" vs "Manchester City").
 *
 * Everything not in this map falls back to `artFor()` returning null, and the
 * card renders exactly as it did before: no art, no empty box.
 */
const ART: Record<string, string> = {
  'manchester-city fulham': asset('/art/fixtures/mci-ful.webp'),
  'newcastle-united arsenal': asset('/art/fixtures/new-ars.webp'),
  'tottenham-hotspur ipswich-town': asset('/art/fixtures/tot-ips.webp'),
  'chelsea leeds-united': asset('/art/fixtures/che-lee.webp'),
}

/** The front-page sports banner. Separate from per-fixture art. */
export const SPORTS_HERO = asset('/art/sports-hero.webp')

// Only the suffixes that genuinely vary between feeds. "United" is kept: it is
// part of the club's name and "newcastle" would collide with Newcastle Falcons.
const norm = (team: string): string =>
  team
    .toLowerCase()
    .replace(/\b(fc|afc|cf|sc)\b/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

/** Art for a fixture, or null when it has none. */
export function artFor(home: string, away: string): string | null {
  return ART[`${norm(home)} ${norm(away)}`] ?? null
}
