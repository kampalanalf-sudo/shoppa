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
