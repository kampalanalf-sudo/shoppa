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

## 9. Enabling sports mode — the checklist

**This section used to require a terminal. It no longer does.** Everything the
feed needs now runs inside Supabase, so there is nothing to install, no CLI to
authenticate, and no deploy step that can be forgotten. If you can open a browser
and log into your Supabase project, you can run this.

### Where the feed actually runs

The original design put the feed in a Vercel function and woke it every four
hours with a cron entry in `vercel.json`. That worked, but it had three costs
that only showed up in practice:

- it needed three environment variables set in Vercel and **a redeploy** before
  any of them took effect;
- it could not be inspected without a terminal;
- and the Vercel account connected here cannot see the `shoppa` project at all
  (it belongs to `iuearadio`), so it was un-runnable from this seat.

So the feed was moved **into the database**. `pg_cron` schedules it, `pg_net`
makes the HTTPS call, and the API key sits in Supabase **Vault** rather than in
a build environment. Nothing about the odds logic changed — the median
consensus, the 4% margin, and the integer ×100 prices are the same numbers as
before. Only the host changed.

| Piece | Where it lives now |
|---|---|
| The key | Supabase Vault, secret `odds_api_key` |
| The HTTPS call | `feed_fire_sync()` → `pg_net` |
| The parser | `feed_ingest_odds()` |
| The schedule | `pg_cron` jobs 1, 2 and 3 |
| The queue | `feed_requests` |
| Betting state | `feed_config` (single row) |

### Step 0 — confirm you are looking at the right project

Supabase dashboard → project **`dtroufrfavmjldtlprpn`**. Open **SQL Editor**.

Every command below is pasted into that editor and run with **Run**. There is no
`$VARIABLE` to substitute and no shell quoting to get wrong.

Sanity check:

```sql
select jobid, jobname, schedule, active from cron.job order by jobid;
```

You should see three rows. If the table is empty, the feed is not scheduled and
the rest of this section is moot — see *Reinstalling from scratch* at the end.

### Step 1 — confirm the key is present

```sql
select id, name, created_at from vault.secrets where name = 'odds_api_key';
```

One row. **Do not select `secret`** — you do not need to see it, and there is no
reason for it to appear on a screen.

If the row is missing, the key was never stored or was rotated out. Store it
without ever writing it into a file that gets committed:

```sql
select vault.create_secret('<the-odds-api-key>', 'odds_api_key');
```

### Step 2 — confirm the key is not reachable by a browser

This matters more than anything else in this section. The browser talks to
Supabase as `anon`, so if `anon` can read the secret, the key is public.

```sql
select has_schema_privilege('anon', 'vault', 'USAGE')          as anon_usage,
       has_schema_privilege('authenticated', 'vault', 'USAGE') as auth_usage,
       has_function_privilege('anon', 'feed_fire_sync()', 'EXECUTE')   as anon_can_fire,
       has_function_privilege('anon', 'feed_ingest_odds()', 'EXECUTE') as anon_can_ingest;
```

All four must be **`false`**. Verified on the live database: they are.

The same check for the tables the site reads:

```sql
select tbl,
       has_table_privilege('anon', tbl, 'SELECT') as sel,
       has_table_privilege('anon', tbl, 'INSERT') as ins,
       has_table_privilege('anon', tbl, 'UPDATE') as upd
  from unnest(array['sports_fixtures','sports_markets','sports_selections',
                    'sports_bets','feed_config','feed_requests']) tbl;
```

Expected: the three odds tables and `sports_bets` are `sel = true, ins = false,
upd = false`; `feed_config` and `feed_requests` are **all false**. The site needs
only `SELECT`. Writes happen exclusively through `place_sports_bet`, which is
`security definer` and validates every limit itself.

### Step 3 — run one cycle by hand

Two calls, because `pg_net` is asynchronous: the first *fires* the HTTP
requests, the second *reads* the responses. There is a gap of a second or two
between them.

```sql
select feed_fire_sync();
```

Returns the number of sports it queued (currently **2**). Then wait a few
seconds and:

```sql
with run as (select feed_ingest_odds() as n)
select n as fixtures_ingested from run;
```

Returns **38** on a typical midweek EPL + Champions League payload. Then:

```sql
select (select count(*) from sports_fixtures)                as fixtures,
       (select count(*) from sports_selections)              as selections,
       (select count(*) from sports_selections where is_active) as active,
       (select max(price_at) from sports_selections)         as newest_price;
```

Fixtures and selections non-zero, `active` equal to selections, `newest_price`
within the last few minutes. That is a live board.

The `with ... select` wrapper is not decoration: running the bare
`select feed_ingest_odds()` works too, but a repeated identical statement can be
deduplicated by tooling that talks to this database. The wrapper makes each call
textually distinct.

### Step 4 — prove it without spending a credit

The provider does **not** bill `/v4/sports` (the catalogue endpoint). So the
cheapest possible test of "is my key alive and is the catalogue what I think it
is" costs nothing:

```sql
select content->0->>'key' as first_sport
  from net._http_response order by id desc limit 1;
```

Better, check what you are *currently* configured to fetch:

```sql
select sports, margin_pct, enabled from feed_config where id = 1;
```

Expected: `["soccer_epl","soccer_uefa_champs_league"]`, `4`, `true`.

### Step 5 — read the log

```sql
select id, sport, kind, fired_at, processed_at, error
  from feed_requests order by id desc limit 10;
```

A healthy row has `fired_at`, a `processed_at` a second or two later, and a
`null` `error`. A row with `error` set is the whole diagnosis — the message is
the Postgres error text, truncated to 300 characters.

```sql
select id, home_team, away_team, league, starts_at, status
  from sports_fixtures
 where status in ('upcoming','live') and starts_at > now()
 order by starts_at limit 10;
```

This is exactly the query the board runs, so if these rows look right the board
looks right.

### What runs after that

| Job | Schedule | Cost per run | Does |
|---|---|---|---|
| `feed_fire_sync` | `7 */4 * * *` | 2 credits | Fires the odds requests for both sports |
| `feed_ingest_odds` | `12,17 */4 * * *` | 0 | Reads the responses; runs twice to cover pg_net lag |
| `feed_close_started` | `*/5 * * * *` | 0 | Closes markets at kick-off |

The two-slot ingest is deliberate. `pg_net` does not guarantee the response has
landed within five minutes of firing, and ingesting too early returns nothing.
Running at :12 and again at :17 is idempotent — the second pass finds the queue
already drained and does no work — so the redundant run costs nothing.

**Credits:** 2 sports × 6 runs a day = **12 a day**, about **360 a month**
against the 500-credit free tier. That leaves room for a third sport ×6 = ~540,
which would be *over* budget — so NBA is deliberately **not** in `feed_config`
yet. If you add one, shorten the schedule first:

```sql
update feed_config set sports = array['soccer_epl','soccer_uefa_champs_league','basketball_nba'] where id = 1;
select cron.alter_job(1, schedule := '7 */6 * * *');   -- 3 sports × 4 a day = 360/mo
select cron.alter_job(2, schedule := '12,17 */6 * * *');
```

### The board only shows games that have not started

The free tier is **pre-match only**: there are no in-play prices to buy. So a
fixture that has kicked off has no live price, and showing it would invite a bet
at a price that stopped being real at kick-off.

Three things keep that honest:

1. `feed_close_started()` runs every five minutes and sets `is_open = false` on
   every market whose fixture has started, and `is_active = false` on its
   selections. The UI greys those out.
2. `feed_ingest_odds()` skips any event whose `commence_time` is in the past, so
   a stale payload cannot re-open them.
3. `loadBoard()` asks only for `starts_at > now()`, and `place_sports_bet`
   refuses outright with *"betting has closed for this event"*.

Belt, braces, and a second belt — because the failure mode here is paying out on
a match whose result is already public.

### Price age is tied to the refresh cadence

`place_sports_bet` refuses a price older than `max_price_age_seconds`, which now
defaults to **15,000 seconds (about 4h10m)** — the 4-hour refresh plus ten
minutes of slack. It used to be 90 minutes, which was wrong once the schedule
became 4-hourly: bets would have been rejected for two and a half hours out of
every four, and the error would have looked like a bug rather than a policy.

Choosing it this way also gives you a free watchdog: **if `pg_cron` quietly
stops, prices age past 15,000 seconds and betting shuts itself off** instead of
offering month-old odds forever.

### If it does not work

| What you see | Cause | Fix |
|---|---|---|
| Board says "No matches on the board yet" | No successful ingest | Step 3 |
| `feed_ingest_odds()` returns `0` and the queue is empty | The requests were already consumed | Step 3 again — fire first |
| `feed_ingest_odds()` returns `0`, queue rows have `error` | The parser failed | Read `error`; it is the Postgres message |
| `feed_fire_sync()` returns `0` | `feed_config.enabled` is false, or `sports` is empty | Check `feed_config` |
| `error = 'http 401'` | Key invalid or revoked | Re-store it (Step 1) |
| `error = 'http 422'` | A sport key is not in this plan's catalogue | Remove it from `feed_config` — it bills a credit anyway |
| `error` mentions `r.status` or `r.body` | The old parser was running | It is fixed; `pg_net` uses `status_code` and `content` |
| Selections double every four hours | A market has no unique `(fixture_id, name)` | Fixed in `0008`; the index `sports_markets_fixture_name` is what makes ingestion idempotent |
| Fixtures present, bets refused as "out of date" | No ingest for over 4h | Check the cron jobs are `active` |
| Bets refused with "betting has closed" | Kick-off has passed | Correct behaviour — the market is closed |

**The second trap is an upsert with nothing to conflict against.**
`feed_ingest_odds` inserts a market with `on conflict do nothing`, which is only
idempotent if a unique constraint exists on `(fixture_id, name)`. There wasn't
one, so "do nothing" did nothing — every successful ingest added a *second*
"Match result" market and pointed the fresh prices at it. Selections went 114 to
228 in two runs. Once a full slate is being fetched that doubles the board every
four hours, forever. The index `sports_markets_fixture_name` is the fix, and it
is the constraint that makes the word "upsert" mean anything:

```sql
select indexname from pg_indexes where tablename = 'sports_markets';
-- sports_markets_pkey, sports_markets_fixture, sports_markets_fixture_name
```

If `sports_markets_fixture_name` is missing, ingestion will start duplicating
again. It is not a performance index.

**The two `pg_net` column names are the trap.** The response columns are
`status_code` and `content`; reading `status` and `body` returns `NULL` rather
than erroring, which looks exactly like "the API returned nothing". That bug cost
a full cycle here, and it also stamped `processed_at` on the failure so the rows
could not simply be retried. The current function leaves failed rows **pending**
and writes the error, so a retry is just a re-run.

### The sports in the catalogue

```
soccer_epl                    Premier League        active
soccer_uefa_champs_league     Champions League      active
basketball_nba                NBA                   available, not enabled
```

Checked against the live catalogue on 20 Nov 2026, which also settled an earlier
assumption: **`soccer_africa_cup_of_nations` is not in this plan's catalogue at
all.** Requesting it returns 422 and still bills a credit.

To list the whole catalogue for free, look at what the provider returned rather
than guessing:

```sql
select jsonb_array_elements(content::jsonb)->>'key' as sport_key
  from net._http_response
 where id = (select max(id) from net._http_response);
```

(That works because each payload happened to be an array; for a definitive list
it is easier to fire one request at `/v4/sports` and read it. Either way it is
not billed.)

### The prices are not the feed's prices

Two things happen between the provider's number and the board:

1. **Consensus, not best price.** Several bookmakers quote each match — about 24
   with `regions=eu`. We take the **median**. The best price is usually one book
   that has not repriced yet, and building a board on the outlier means holding
   exactly the bets that were about to be wrong.
2. **A 4% margin is applied** — ours, on top of a fair line, not the bookmaker's
   number with their margin still inside it. That distinction is worth spelling
   out, because the first version got it wrong: taking each outcome's median
   independently keeps the bookmakers' own overround, and stacking 4% on top of
   that produced a book with a **10.3%** overround while `margin_pct` said 4.

   The fix is to normalise first. Sum `1/price` across the outcomes, divide each
   probability by that sum, and only then apply the margin:

   ```
   fair_i = (1 / price_i) / Σ(1 / price_j)
   odds_i = (1 / fair_i) × (1 − margin/100)
   ```

   Measured after the change: **1.0494**. That is the 4% we asked for, plus a
   fraction of a percent from rounding odds down to whole hundredths in our
   favour.

Rounding is **always down**. Rounding up would hand the player a fraction of a
percent on every single bet, in every market, forever.

### Three limits that only matter now prices are automated

All three are enforced in `place_sports_bet`, server-side, under a row lock:

| Limit | Default | Why |
|---|---|---|
| Stake ceiling | 500,000 PX (50,000 UGX) | One account must not be able to take the whole market down on a short price. Per-market override: `sports_markets.max_stake_px`. |
| Price age | 15,000 s (~4h10m) | Matched to the 4-hour refresh plus slack. A price older than that is refused rather than honoured. Per-market override: `max_price_age_seconds`. |
| Kick-off clock | `starts_at <= now()` | The feed's `status` lags reality. A match that started two minutes ago can still say `upcoming` in the last payload, and betting a known result is not a book. |

Verified against the live database, not assumed:

```
stake 600,000 PX   -> "stake exceeds the 500000 PX limit for this market"
price 3h old       -> "odds for this market are out of date"   (under the old 90-minute default)
valid bet          -> accepted, ledger row written, balance debited
```

### How settlement decides

Settlement is **not** automated yet in the database path. `settle_sports_market`
and `settle_sports_bet` exist, are `service_role`-only, and are correct — but
nothing currently calls them on a schedule, because that needs the scores
endpoint and a rule for penalties and abandoned matches that has not been agreed.

Until it is wired up, settling is the manual procedure in §3. Do not connect a
scheduler to it expecting it to work; the job does not exist yet.

When it is wired up: it must only act on an event with **`completed: true`**. A
live match with a current score is not a result — it can still turn. A draw has
no winner, so the `Draw` selection wins if the feed quoted one, and the market is
voiced if it did not. Fixtures are matched by the provider's event id
(`external_id`), never by team name: names get respelled, ids do not.

### What this still does not give you

- **Live in-play.** The free tier prices pre-match events only. This is a
  pre-match book, and the schema says so.
- **Automated settlement.** See above — the functions exist, the job does not.
- **A licence.** Every word of §6 still holds. The feed is data, not permission.
  A sportsbook is *more* regulated than the casino, not less.

### Reinstalling from scratch

If the schedule is ever lost, these three statements rebuild it. They are
idempotent, so running them when it already exists is harmless:

```sql
select cron.schedule('feed_fire_sync',     '7 */4 * * *',    'select feed_fire_sync()');
select cron.schedule('feed_ingest_odds',   '12,17 */4 * * *', 'select feed_ingest_odds()');
select cron.schedule('feed_close_started', '*/5 * * * *',    'select feed_close_started()');
```

---

