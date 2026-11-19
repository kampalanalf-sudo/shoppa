# Sportsbook — how it works, and how to run it

You asked two things: where the logout button was, and whether a sports betting
section could be built and how. The first is answered at the bottom. This page
is the second: what now exists, what it deliberately refuses to do, and the
honest list of what a real book needs that software cannot give you.

---

## 1. What was built

| Piece | Where |
|---|---|
| Schema: fixtures, markets, selections, bets | `supabase/migrations/0006_sportsbook.sql` |
| Placing a bet (server-side price) | `place_sports_bet()` in the same file |
| Settling a bet / a whole market | `settle_sports_bet()`, `settle_sports_market()` |
| Reading the board, placing from the UI | `src/lib/sportsbook.ts` |
| The screen | `src/pages/Sportsbook.tsx`, at `#sports` |
| Demo fixtures | `supabase/seed/sports_demo.sql` |
| Invariants | `smoke/sports.ts` (33 checks) |

It is applied to the live project and verified: 6 fixtures, 4 sports, 20
selections are on the board right now.

---

## 2. The one decision that matters

**The browser cannot set a price, and cannot settle a bet.**

The casino games call `settle_round(p_multiplier => …)` from the browser,
because the outcome is generated there. A sportsbook cannot work that way — if
the client passes the multiplier, the client passes `50.0`. So the two
functions are split, permanently:

```sql
-- the ONLY thing a player may call. No price in the signature.
place_sports_bet(p_selection uuid, p_stake_px bigint)   → authenticated

settle_sports_bet(p_bet uuid, p_status, p_reason)       → service_role
settle_sports_market(p_market uuid, p_winner uuid)      → service_role
```

Verified against the live database, not assumed:

```
place_sports_bet     anon=false  authenticated=true   service_role=false
settle_sports_bet    anon=false  authenticated=false  service_role=true
settle_sports_market anon=false  authenticated=false  service_role=true
```

Consequences worth knowing:

- The price is read from the market row **under a lock** and snapshotted onto
  the slip. What you saw is what you got, even if the odds move a second later.
- Odds are stored as **integers ×100** (`250` = 2.50). No floating point ever
  touches a payout.
- A stake is debited and its ledger row written in the same function, so the
  wallet and the audit trail cannot drift.
- Settling twice is a no-op. Verified: two settlement calls, one ledger row.
- Bets close at kick-off (`starts_at <= now()` is rejected), so nobody bets on a
  match whose result is already knowable.

---

## 3. Running it yourself

### Publish fixtures

There is no admin screen for fixtures yet — that is the next piece of work, and
it needs a decision from you first (see §5). For now, insert them directly:

```sql
with f as (
  insert into sports_fixtures (sport, league, home_team, away_team, starts_at)
  values ('football', 'Uganda Premier League', 'KCCA', 'Vipers SC', now() + interval '1 day')
  returning id
), m as (
  insert into sports_markets (fixture_id, name) select id, 'Match result' from f returning id, fixture_id
), s as (
  insert into sports_selections (market_id, name, odds_x100) values
    ((select id from m), 'KCCA', 235),
    ((select id from m), 'Draw', 305),
    ((select id from m), 'Vipers SC', 275)
  returning id
)
select count(*) from s;
```

The demo set is one statement:

```bash
psql "$SUPABASE_DB_URL" -f supabase/seed/sports_demo.sql
```

Delete every demo row in one go — they are the only rows with `venue = 'DEMO'`:

```sql
delete from sports_fixtures where venue = 'DEMO';
```

### Settle a match

Settle one market (this is what the result job will call):

```sql
-- name the winner; every open slip on the market is decided in the same call
select settle_sports_market(
  (select id from sports_markets where fixture_id = :'fixture' and name = 'Match result'),
  (select id from sports_selections where market_id = :'market' and name = 'KCCA')
);

-- void it instead: stakes returned, nobody wins. p_winner = null.
select settle_sports_market(:'market', null);
```

One call per market, not per slip — settling a whole matchday is a handful of
statements inside one transaction.

This needs the **service role** key. Do it from the SQL editor or from a server
route. Never from the browser: that key must never be in the bundle.

---

## 4. What a real book needs that this does not have

Being blunt, because "sports betting" sounds like one feature and is really
four.

| Missing | Why it matters |
|---|---|
| **An odds feed** | Prices must come from somewhere with a licence to publish them. Hand-typed odds are how you lose money on day one: you will be the slowest book in the market and the only one with stale prices. |
| **A result feed** | Settlement needs an authoritative score source. Without one, every market is settled by a human, and every dispute is a human argument. |
| **Liability limits** | Nothing currently stops a new account staking the house on one 1.01 shot. You want per-market stake limits and a maximum payout ceiling before this takes real money. |
| **Cash-out** | The `cashed_out` status exists in the enum but nothing writes it. Cash-out is a pricing problem, not a UI problem — skipping it is the right call for now. |
| **Betting-shop tax / licensing** | See §6. |

The schema has room for all of these. None of them is a weekend.

---

## 5. The decision that is yours

Three ways to get real fixtures, in ascending order of cost and descending order
of risk:

1. **Manual, one league, small stakes.** You type in 10 matches a week and
   settle them yourself. Free, legal-ish, and it caps your growth at your own
   attention. Fine for testing whether people actually bet football here.
2. **An odds provider.** Companies like Betradar/Sportradar, LSports and
   OddsMatrix sell feeds with settlement included. Cost is typically a monthly
   minimum plus a revenue share, and they will ask for your licence number
   before they sell you anything.
3. **White-label / turnkey sportsbook.** Someone else runs the book, you take a
   revenue share. Fastest to market, least control, and the house edge is
   theirs.

Given the licence situation in §6, option 1 is the only one you can start
today.

---

## 6. The thing that has not changed

A sportsbook is **more** tightly regulated than the casino games already in the
app, not less. In Uganda, the National Lotteries and Gaming Regulatory Board
licenses betting; taking a sports bet without a licence is an offence, and
"sports betting" specifically is named in the Act.

Nothing in this document, and nothing in the code, is a compliance claim. Age
gating, phone verification and the audit trail are all still required, and none
of them is a substitute for the licence.

**Play-money (PX) only until you have that licence.** The peg makes this
convenient: 10 PX = 1 UGX, so the system can be exercised end to end at a scale
where a mistake costs you nothing.

---

## 7. Where the logout button was

It did not exist. `signOut()` had been implemented in `src/lib/auth.tsx` since
authentication was built, and **nothing ever called it** — so a player on a
shared phone had no way out of their account.

It is now in the account menu, top right, under the avatar: handle, email,
balance, then **Sign out**. Verified on the built bundle.

While fixing it I also removed a small lie: that menu printed
`Level 24 · VIP Platinum` for every player, including brand-new ones, because
it was hard-coded. It now shows the real handle and address, or nothing.

---

## 8. Can you get a feed for free?

Researched 14 Nov 2026. Short answer: **not from Betradar or LSports**, but yes
from one place, with a hard catch that matters for your audience.

### The enterprise vendors are all closed

| Vendor | Public price | Free tier |
|---|---|---|
| Sportradar / Betradar | none — sales call | none |
| LSports | one listing: **$180,000 / 12 months** (TRADE360, AWS Marketplace) | "free trial" via a contact form |
| Genius Sports | none — sales call | none |
| OddsMatrix | none — sales call | one month, via contact form |
| Stats Perform | none — sales call | none |

Published market ranges put a managed feed at roughly **$8,000–20,000/month**
for a mid-tier vendor and **$15,000–50,000/month** at the top. Betradar is
commonly quoted from **$10,000/month plus 5–15% revenue share**.

All of them also run KYB before granting access. They will ask for your gaming
licence number, which is the point at which the conversation stops for a
pre-licence project. A "free trial" here means a sales-led sandbox, not a
self-serve key.

### The one that is genuinely free

**The Odds API** (`the-odds-api.com`) — self-serve, no card, key emailed:

| Plan | Price | Credits/month |
|---|---|---|
| Starter | **$0** | **500** |
| 20K | $30 | 20,000 |
| 100K | $59 | 100,000 |

One credit = one request for **one sport + one market + one region**. The free
tier includes all sports, most bookmakers and all markets; it excludes
historical odds. There is a **Scores & Results** endpoint, which is what
settlement needs.

It also aggregates bookmakers' prices rather than holding official league
rights. That has two consequences before you point real money at it:

- you are republishing a competitor's prices, which is a commercial risk as
  much as a contract one;
- there is no official settlement authority behind it, so a result dispute has
  no adjudicator.

Fine for a play-money launch. Not fine as the spine of a licensed book.

### The catch that decides it for you

**The catalogue contains no Ugandan league.** Verified against the full sports
list on 14 Nov 2026 — no Uganda Premier League, no Big League, no FUFA
competition, no NBL Uganda. What it does have that your players watch:

```
soccer_epl                  Premier League            + scores
soccer_uefa_champs_league   Champions League          + scores
soccer_africa_cup_of_nations Africa Cup of Nations
soccer_fifa_world_cup       World Cup                 + scores
basketball_nba              NBA                       + scores
basketball_euroleague       Euroleague                + scores
cricket_ipl                 IPL
cricket_international_t20   International T20
tennis_atp_* / tennis_wta_* majors
```

So a free feed gets you European football and NBA. It does not get you KCCA v
Vipers. For local football you are back to manual entry (§3), which is the
honest answer for a Ugandan book starting out.

### The maths on 500 credits

Polling one sport costs one credit per poll. At one poll every 90 minutes:

```
24h / 1.5h = 16 polls/day × 30 = 480 credits/month
```

That fits, with almost nothing to spare. Which means the free tier buys you
**one sport, pre-match, refreshed slowly** — not a live in-play book. In-play
needs second-level updates and would burn 500 credits in about 20 minutes.

Realistic free-tier shape: EPL + Champions League + AFCON, pre-match only,
polled every 90 minutes by a scheduled job.

### What connecting it would take

The schema already fits; this is ingestion, not redesign.

1. `api/feed/sync.ts` — a Vercel cron (or GitHub Action) that polls The Odds
   API and upserts `sports_fixtures` / `sports_markets` / `sports_selections`.
   The API key lives in that server route only, never in the bundle. Same rule
   as the DGateway key.
2. Map bookmaker prices to `odds_x100` integers, and apply **your** margin —
   you should not publish another book's number as your own.
3. `api/feed/settle.ts` — read the Scores endpoint and call
   `settle_sports_market()`. That function already exists, is service_role
   only, and is idempotent.
4. A sync log table so a missed poll is visible rather than silent.

Each of those is small. The reasons not to build them today are §5 and §6, not
the code.

---

## 9. Installing the live feed

Built and applied. It needs one thing from you: a free API key, because the
signup is yours.

### What you do (5 minutes)

1. Go to **https://the-odds-api.com** and click *Get API Key* → **Starter, FREE**.
   No card. The key arrives by email.
2. Add it to Vercel as **`ODDS_API_KEY`** — Project → Settings → Environment
   Variables → Production + Preview. It is a server secret: **no `VITE_` prefix**.
3. Add **`CRON_SECRET`** — any long random string (`openssl rand -hex 32`).
   Vercel sends it as a bearer token to the cron routes, which is how they know
   the caller is the scheduler and not a stranger.
4. Redeploy.

Then trigger the first pull by hand:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://shoppa-ten.vercel.app/api/feed/sync
```

Check it without spending a credit:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" "https://shoppa-ten.vercel.app/api/feed/sync?dry=1"
```

### What runs after that

| Route | Schedule | Cost | Does |
|---|---|---|---|
| `/api/feed/sync` | every 2 hours | 4 credits | Upserts fixtures + prices |
| `/api/feed/settle` | every 3 hours, at :15 | 4 credits | Settles finished matches |

Both are in `vercel.json`. Four sports × 12 runs a day = **48 credits/day**,
which is 1,440 a month — comfortably inside the 500-credit free plan only
because only *in-season* sports return events, and the sync skips a sport with
no data. If you add sports, do the arithmetic first.

### The four sports

```
soccer_epl                    Premier League
soccer_uefa_champs_league     Champions League
soccer_africa_cup_of_nations  AFCON
basketball_nba                NBA
```

Change `SPORTS` at the top of `api/feed/sync.ts`. Every key you add costs one
credit per run, forever.

### The prices are not the feed's prices

Two things happen between the provider's number and the board:

1. **Consensus, not best price.** Several bookmakers quote each match. We take
   the **median**. The best price is usually one book that has not repriced yet,
   and building a board on the outlier means holding only the bets that were
   about to be wrong.
2. **A 4% margin is applied**, because publishing another book's number verbatim
   is a zero-margin book: you carry all the market risk and keep none of the
   compensation. `ODDS_MARGIN_PCT` overrides it; it is clamped to 25.

Rounding is **always down**, in our favour. Rounding up would hand the player a
fraction of a percent on every single bet.

### Three limits that only matter now prices are automated

All three are enforced in `place_sports_bet`, server-side, under a row lock:

| Limit | Default | Why |
|---|---|---|
| Stake ceiling | 500,000 PX (50,000 UGX) | One account must not be able to take the whole market down on a short price. Per-market override: `sports_markets.max_stake_px`. |
| Price age | 90 minutes | The feed polls every 2 hours. A price older than 90 minutes is refused rather than honoured. Per-market override: `max_price_age_seconds`. |
| Kick-off clock | `starts_at <= now()` | The feed's `status` lags reality. A match that started two minutes ago can still say `upcoming` in the last payload, and betting a known result is not a book. |

Verified against the live database, not assumed:

```
stake 600,000 PX   -> "stake exceeds the 500000 PX limit for this market"
price 3h old       -> "odds for this market are out of date"
valid bet          -> accepted, ledger row written, balance debited
```

### How settlement decides

`/api/feed/settle` reads the scores endpoint and will only act on an event with
**`completed: true`**. A live match with a current score is *not* a result — it
can still turn. A draw has no winner, so the `Draw` selection wins if the feed
quoted one, and the market is **voided** if it did not. Nothing is guessed.

Fixtures are matched by the provider's event id (`external_id`), never by team
name: names get respelled, ids do not.

### When it goes wrong

Every run writes a row to `feed_sync_log` — status, fixtures seen, credits used,
credits remaining, and the first 20 errors. A partial sync is logged as
`partial`, not `ok`, because a board that is half-stale looks fine and is not.

```sql
select started_at, status, fixtures_upserted, credits_left, errors
  from feed_sync_log order by started_at desc limit 10;
```

A fixture the feed stops returning is **voided**, never deleted:
`void_stale_fixtures('oddsapi', 6)` refunds open slips through
`settle_sports_market`. Deleting a fixture a player has a bet on would make the
slip disappear rather than resolve.

### What this still does not give you

- **Live in-play.** Polling every 2 hours cannot price a match in progress. This
  is a pre-match book, and the schema says so.
- **A licence.** Every word of §6 still holds. The feed is data, not permission.
- **More than 4 competitions** without spending more credits.
