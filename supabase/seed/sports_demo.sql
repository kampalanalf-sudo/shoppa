-- supabase/seed/sports_demo.sql
--
-- SUPERSEDED by the live odds feed (api/feed/sync.ts). Real fixtures are now
-- ingested from The Odds API; this file is kept only for local work when no
-- ODDS_API_KEY is available. To clear it out of a real database:
--
--   delete from sports_fixtures where venue = 'DEMO';
--
-- DEMO FIXTURES — NOT REAL EVENTS.
--
-- This is seed data so the Sports section is not an empty shell while the odds
-- feed is being connected. Every row here is invented: the teams are real clubs
-- but the kick-off times, the prices and the "league" labels are made up.
--
-- DO NOT TAKE MONEY AGAINST THESE. There is no result feed behind them, so
-- nothing here can settle itself; a slip on one of these fixtures stays open
-- until someone calls settle_sports_market by hand. Clear the table before
-- going live:
--
--   delete from sports_fixtures where venue = 'DEMO';
--
-- Real fixtures should come from a licensed odds provider — see docs/SPORTS.md.
-- The `venue = 'DEMO'` marker is what makes them safe to find and delete in one
-- statement.

do $$
declare
  v_fix uuid;
  v_mkt uuid;
begin
  -- idempotent: clear any previous demo load first
  delete from sports_fixtures where venue = 'DEMO';

  -- 1. Football, match result + totals
  insert into sports_fixtures (sport, league, home_team, away_team, starts_at, venue, status)
  values ('football', 'Uganda Premier League', 'KCCA', 'Vipers SC', now() + interval '1 day 3 hours', 'DEMO', 'upcoming')
  returning id into v_fix;
  insert into sports_markets (fixture_id, name) values (v_fix, 'Match result') returning id into v_mkt;
  insert into sports_selections (market_id, name, odds_x100) values
    (v_mkt, 'KCCA', 235), (v_mkt, 'Draw', 305), (v_mkt, 'Vipers SC', 275);
  insert into sports_markets (fixture_id, name) values (v_fix, 'Total goals') returning id into v_mkt;
  insert into sports_selections (market_id, name, odds_x100) values
    (v_mkt, 'Over 2.5', 185), (v_mkt, 'Under 2.5', 195);

  -- 2. Football
  insert into sports_fixtures (sport, league, home_team, away_team, starts_at, venue, status)
  values ('football', 'Uganda Premier League', 'SC Villa', 'Express FC', now() + interval '2 days', 'DEMO', 'upcoming')
  returning id into v_fix;
  insert into sports_markets (fixture_id, name) values (v_fix, 'Match result') returning id into v_mkt;
  insert into sports_selections (market_id, name, odds_x100) values
    (v_mkt, 'SC Villa', 210), (v_mkt, 'Draw', 320), (v_mkt, 'Express FC', 300);

  -- 3. Basketball — two-way market
  insert into sports_fixtures (sport, league, home_team, away_team, starts_at, venue, status)
  values ('basketball', 'NBL Uganda', 'City Oilers', 'Namuwongo Blazers', now() + interval '1 day 6 hours', 'DEMO', 'upcoming')
  returning id into v_fix;
  insert into sports_markets (fixture_id, name) values (v_fix, 'Winner') returning id into v_mkt;
  insert into sports_selections (market_id, name, odds_x100) values
    (v_mkt, 'City Oilers', 165), (v_mkt, 'Namuwongo Blazers', 225);

  -- 4. Athletics — a field market, the shape a meet actually needs
  insert into sports_fixtures (sport, league, home_team, away_team, starts_at, venue, status)
  values ('athletics', 'National Meet', 'Men''s 5000m', 'Final', now() + interval '3 days', 'DEMO', 'upcoming')
  returning id into v_fix;
  insert into sports_markets (fixture_id, name) values (v_fix, 'Winner') returning id into v_mkt;
  insert into sports_selections (market_id, name, odds_x100) values
    (v_mkt, 'Kiprop', 240), (v_mkt, 'Chemutai', 300), (v_mkt, 'Okello', 420), (v_mkt, 'Field', 500);

  -- 5. Motorsport
  insert into sports_fixtures (sport, league, home_team, away_team, starts_at, venue, status)
  values ('motorsport', 'Rally Championship', 'Busoga Rally', 'Leg 1', now() + interval '4 days', 'DEMO', 'upcoming')
  returning id into v_fix;
  insert into sports_markets (fixture_id, name) values (v_fix, 'Stage winner') returning id into v_mkt;
  insert into sports_selections (market_id, name, odds_x100) values
    (v_mkt, 'Mangat', 190), (v_mkt, 'Ssebuguzi', 260), (v_mkt, 'Field', 380);

  -- 6. One live row, so the live state is exercised rather than untested
  insert into sports_fixtures (sport, league, home_team, away_team, starts_at, venue, status)
  values ('football', 'Friendly', 'Onduparaka', 'Mbarara City', now() - interval '40 minutes', 'DEMO', 'live')
  returning id into v_fix;
  insert into sports_markets (fixture_id, name) values (v_fix, 'Match result') returning id into v_mkt;
  insert into sports_selections (market_id, name, odds_x100) values
    (v_mkt, 'Onduparaka', 150), (v_mkt, 'Draw', 330), (v_mkt, 'Mbarara City', 520);
end $$;
