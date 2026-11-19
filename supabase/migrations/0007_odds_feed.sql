-- 0007_odds_feed.sql
-- ============================================================================
-- Ingesting a live odds feed, and the three limits that make it safe.
--
-- Adding an automated feed changes the threat model. Until now a fixture could
-- only exist because a human typed it, so a bad fixture was a typo. Now a
-- fixture is whatever an upstream API says it is, and three things go wrong
-- that never could before:
--
--   1. An event is already over, or has started. The feed is a snapshot and the
--      scheduler can miss a poll, so `place_sports_bet` must refuse on the
--      clock, not on the feed's opinion.
--   2. The price is stale in our favour, or against it. A price that only
--      updates every 90 minutes must not be honoured against a player who
--      waits for a goal and then bets — so there is a freshness window.
--   3. An external source can disagree with us mid-flight. `source` and
--      `source_ref` record where each fixture came from and make ingestion
--      idempotent; a replayed payload must upsert, never duplicate.
--
-- Everything here keeps 0006's discipline: the browser still cannot set a
-- price, and still cannot settle.
-- ============================================================================

-- ------------------------------------------------- source provenance --------
-- `source` is 'manual' or a feed name ('oddsapi'). `source_ref` is the
-- provider's own event id. They are unique together so a re-run of the same
-- payload updates the row instead of inserting a second copy.
alter table sports_fixtures
  add column if not exists source        text not null default 'manual',
  add column if not exists source_ref    text,
  add column if not exists external_id   text;

create unique index if not exists sports_fixtures_source_ref
  on sports_fixtures (source, source_ref) where source_ref is not null;
create unique index if not exists sports_fixtures_external_id
  on sports_fixtures (external_id) where external_id is not null;

-- Prices carry their own timestamp. Any staleness rule has to measure the price,
-- not the fixture, or a fixture refreshed at 10:00 would validate a price
-- written at 08:00.
alter table sports_selections
  add column if not exists price_at timestamptz not null default now();

alter table sports_fixtures
  add column if not exists home_score integer,
  add column if not exists away_score integer,
  add column if not exists completed boolean not null default false;

-- -------------------------------------------------- per-market limits -------
-- A maximum stake per market. Without one, a single account can take the whole
-- house down on a 1.01 shot, and an automated feed makes those prices routine.
alter table sports_markets
  add column if not exists max_stake_px bigint;

-- Market-level freshness. Null means "use the global default" so changing the
-- policy does not require rewriting every row.
alter table sports_markets
  add column if not exists max_price_age_seconds integer;

-- ------------------------------------------------------------ feed log ------
-- Every poll writes a row. A missed poll is then visible in the database rather
-- than discoverable only when a player notices the board is stale.
do $$ begin
  create type feed_sync_status as enum ('ok', 'partial', 'error');
exception when duplicate_object then null; end $$;

create table if not exists feed_sync_log (
  id             bigserial primary key,
  source         text not null,
  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  status         feed_sync_status not null default 'ok',
  fixtures_seen  integer not null default 0,
  fixtures_upserted integer not null default 0,
  markets_upserted  integer not null default 0,
  credits_used   integer,
  credits_left   integer,
  detail         text,
  errors         jsonb not null default '[]'::jsonb
);
create index if not exists feed_sync_log_recent on feed_sync_log (source, started_at desc);

alter table feed_sync_log enable row level security;
-- Service role only: no policy grants a client read, so RLS denies everyone.
-- Admins read it through the server route, not through PostgREST.

-- ============================================================================
-- place_sports_bet  — replaced to add the clock and the staleness checks.
--
-- The signature is unchanged so nothing in the client or the grants moves. What
-- is new is that a bet can now be refused for reasons that only exist once a
-- feed is publishing prices.
-- ============================================================================
create or replace function place_sports_bet(p_selection uuid, p_stake_px bigint)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid        uuid := auth.uid();
  v_balance    bigint;
  v_after      bigint;
  v_sel        sports_selections;
  v_mkt        sports_markets;
  v_fix        sports_fixtures;
  v_bet_id     uuid;
  v_max_stake  bigint;
  v_max_age    integer;
  v_age        integer;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if p_stake_px is null or p_stake_px <= 0 then
    raise exception 'stake must be positive' using errcode = '22023';
  end if;
  if exists (select 1 from profiles where id = v_uid and suspended) then
    raise exception 'account suspended' using errcode = '42501';
  end if;

  select * into v_sel from sports_selections where id = p_selection;
  if v_sel.id is null then raise exception 'selection not found' using errcode = 'P0002'; end if;
  if not v_sel.is_active then raise exception 'selection is closed' using errcode = 'P0001'; end if;

  select * into v_mkt from sports_markets where id = v_sel.market_id;
  if v_mkt.id is null or not v_mkt.is_open or v_mkt.winning_selection_id is not null then
    raise exception 'market is closed' using errcode = 'P0001';
  end if;

  select * into v_fix from sports_fixtures where id = v_mkt.fixture_id;
  if v_fix.id is null then raise exception 'fixture not found' using errcode = 'P0002'; end if;
  if v_fix.status not in ('upcoming', 'live') or v_fix.settled_at is not null or v_fix.completed then
    raise exception 'fixture is closed' using errcode = 'P0001';
  end if;
  -- Clock, not opinion. The feed's `status` field lags the real world: a match
  -- that kicked off two minutes ago can still say 'upcoming' in the last
  -- payload we received. Trusting it would let anyone bet a known result.
  if v_fix.status = 'upcoming' and v_fix.starts_at <= now() then
    raise exception 'betting has closed for this event' using errcode = 'P0001';
  end if;

  -- Stake ceiling per market.
  v_max_stake := coalesce(v_mkt.max_stake_px, 500000);  -- 50,000 UGX default
  if p_stake_px > v_max_stake then
    raise exception 'stake exceeds the % PX limit for this market', v_max_stake using errcode = '22023';
  end if;

  -- Price freshness. A feed polled every 90 minutes must not let a player bet
  -- into a price that has not been refreshed since before the match started.
  v_max_age := coalesce(v_mkt.max_price_age_seconds, 5400);  -- 90 minutes
  v_age := extract(epoch from (now() - v_sel.price_at))::integer;
  if v_age > v_max_age then
    raise exception 'odds for this market are out of date' using errcode = 'P0001';
  end if;

  select balance_px into v_balance from wallets where user_id = v_uid for update;
  if v_balance is null then raise exception 'wallet missing' using errcode = 'P0002'; end if;
  if v_balance < p_stake_px then
    raise exception 'insufficient balance' using errcode = 'P0001';
  end if;

  v_after := v_balance - p_stake_px;
  update wallets set balance_px = v_after, wagered_px = wagered_px + p_stake_px
   where user_id = v_uid;

  insert into sports_bets (user_id, fixture_id, market_id, selection_id,
                           stake_px, odds_x100, potential_px)
  values (v_uid, v_fix.id, v_mkt.id, v_sel.id,
          p_stake_px, v_sel.odds_x100, (p_stake_px * v_sel.odds_x100) / 100)
  returning id into v_bet_id;

  insert into ledger (user_id, kind, delta_px, balance_after, ref, meta)
  values (v_uid, 'bet', -p_stake_px, v_after, 'sports',
          jsonb_build_object(
            'bet_id', v_bet_id,
            'fixture', v_fix.home_team || ' v ' || v_fix.away_team,
            'selection', v_sel.name,
            'odds_x100', v_sel.odds_x100,
            'price_age_s', v_age));

  return v_bet_id;
end $$;

-- Permissions are re-stated because CREATE OR REPLACE keeps the OID, but saying
-- it explicitly means a future re-run cannot leave the new body world-callable.
revoke all on function place_sports_bet(uuid, bigint) from public, anon, authenticated, service_role;
grant execute on function place_sports_bet(uuid, bigint) to authenticated;

-- ============================================================================
-- Retire the stale board.
--
-- A fixture the feed stops returning is not necessarily cancelled — the
-- provider may simply have dropped it from that sport's list after kick-off.
-- So this does not delete anything: it closes markets and marks fixtures
-- settled-as-void, which refunds open slips through settle_sports_market.
-- ============================================================================
create or replace function void_stale_fixtures(p_source text, p_hours integer default 6)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_fix  record;
  v_mkt  record;
  v_n    integer := 0;
begin
  -- `starts_at < now()` AND created more than p_hours ago: a fixture that never
  -- kicked off but has been sitting there all day is stale, and so is one that
  -- started and was never settled.
  for v_fix in
    select id from sports_fixtures
     where source = p_source
       and status in ('upcoming', 'live')
       and starts_at < now()
       and created_at < now() - make_interval(hours => p_hours)
  loop
    for v_mkt in select id from sports_markets where fixture_id = v_fix.id and is_open loop
      perform settle_sports_market(v_mkt.id, null);  -- null winner = void
    end loop;
    update sports_fixtures set status = 'void', settled_at = now() where id = v_fix.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
