-- 0006_sportsbook.sql
-- ============================================================================
-- Sportsbook: fixtures, markets, bets.
--
-- The single most important decision in this file: THE CLIENT CANNOT SETTLE A
-- SPORTS BET AND CANNOT SET THE ODDS.
--
-- The casino games call `settle_round(p_multiplier => …)` from the browser,
-- because the outcome is generated there and the money is play money in
-- practice. A sportsbook cannot work that way. If the browser can pass a
-- multiplier, a player passes 50.0. So:
--
--   * `place_sports_bet` is the only thing a player may call. It takes a
--     selection id and a stake — never a price. The price is read from the
--     market row under a lock and snapshotted onto the bet.
--   * `settle_sports_bet` is service_role only. It is called by the settlement
--     job once a result is in, never by the browser.
--
-- Prices are stored as INTEGER decimal odds × 100 (2.50 -> 250) because
-- floating point has no business anywhere near money.
-- ============================================================================

-- ------------------------------------------------------------- enums --------
do $$ begin
  create type sport_kind as enum (
    'football', 'basketball', 'athletics', 'motorsport', 'cricket', 'rugby', 'tennis'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type fixture_status as enum ('upcoming', 'live', 'settled', 'void');
exception when duplicate_object then null; end $$;

do $$ begin
  create type sports_bet_status as enum ('open', 'won', 'lost', 'void', 'cashed_out');
exception when duplicate_object then null; end $$;

-- ----------------------------------------------------------- fixtures -------
-- One row per match/race. `settled_at` set means the markets are closed and no
-- new bet can reference them.
create table if not exists sports_fixtures (
  id             uuid primary key default uuid_generate_v4(),
  sport          sport_kind not null,
  league         text not null,
  home_team      text not null,
  away_team      text not null,
  starts_at      timestamptz not null,
  venue          text,
  status         fixture_status not null default 'upcoming',
  -- free-text result published by whoever settles: "2-1", "1st: Kiprop"
  result         text,
  settled_at     timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists sports_fixtures_upcoming on sports_fixtures (status, starts_at);

-- ------------------------------------------------------------ markets -------
-- A market is one question with N selections: 1X2, Over/Under, Winner.
-- `result` on the market is the id of the winning selection once known.
create table if not exists sports_markets (
  id           uuid primary key default uuid_generate_v4(),
  fixture_id   uuid not null references sports_fixtures(id) on delete cascade,
  name         text not null,
  -- closed markets stay visible but reject bets; settlement needs them open
  is_open      boolean not null default true,
  winning_selection_id uuid,
  created_at   timestamptz not null default now()
);
create index if not exists sports_markets_fixture on sports_markets (fixture_id);

create table if not exists sports_selections (
  id          uuid primary key default uuid_generate_v4(),
  market_id   uuid not null references sports_markets(id) on delete cascade,
  name        text not null,
  -- decimal odds × 100. 250 = 2.50. integer, because money is never a float.
  odds_x100   integer not null check (odds_x100 >= 101),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);
create index if not exists sports_selections_market on sports_selections (market_id);

alter table sports_markets
  drop constraint if exists sports_markets_winner_fk;
alter table sports_markets
  add constraint sports_markets_winner_fk
  foreign key (winning_selection_id) references sports_selections(id) on delete set null;

-- --------------------------------------------------------------- bets -------
create table if not exists sports_bets (
  id             uuid primary key default uuid_generate_v4(),
  user_id        uuid not null references profiles(id) on delete cascade,
  fixture_id     uuid not null references sports_fixtures(id),
  market_id      uuid not null references sports_markets(id),
  selection_id   uuid not null references sports_selections(id),
  -- snapshots: the price the player actually got, and what they saw it as
  stake_px       bigint not null check (stake_px > 0),
  odds_x100      integer not null,
  potential_px   bigint not null,
  status         sports_bet_status not null default 'open',
  payout_px      bigint not null default 0,
  settled_at     timestamptz,
  created_at     timestamptz not null default now()
);
create index if not exists sports_bets_user on sports_bets (user_id, created_at desc);
create index if not exists sports_bets_open on sports_bets (status) where status = 'open';

alter table sports_fixtures enable row level security;
alter table sports_markets  enable row level security;
alter table sports_selections enable row level security;
alter table sports_bets   enable row level security;

-- Fixtures, markets and prices are public reading: they are the shop window.
drop policy if exists sports_fixtures_read on sports_fixtures;
create policy sports_fixtures_read on sports_fixtures for select using (true);

drop policy if exists sports_markets_read on sports_markets;
create policy sports_markets_read on sports_markets for select using (true);

drop policy if exists sports_selections_read on sports_selections;
create policy sports_selections_read on sports_selections for select using (true);

-- A player sees only their own slips, and may never insert one directly:
-- money must move through place_sports_bet so the wallet and ledger stay true.
drop policy if exists sports_bets_read_own on sports_bets;
create policy sports_bets_read_own on sports_bets for select using (auth.uid() = user_id);

-- ============================================================================
-- place_sports_bet
--   Debits the stake, snapshots the current price, writes the ledger row.
--   The caller supplies a selection and an amount. Nothing else.
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
  if v_fix.status not in ('upcoming', 'live') or v_fix.settled_at is not null then
    raise exception 'fixture is closed' using errcode = 'P0001';
  end if;
  -- Bets close at kick-off. Allowing them after the result is knowable is not a
  -- book, it is a donation.
  if v_fix.status = 'upcoming' and v_fix.starts_at <= now() then
    raise exception 'betting has closed for this event' using errcode = 'P0001';
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
            'odds_x100', v_sel.odds_x100));

  return v_bet_id;
end $$;

-- ============================================================================
-- settle_sports_bet   — service_role ONLY.
--   Called by the settlement job with the verified result. Idempotent: a slip
--   already settled is left alone, so a retried webhook cannot double-pay.
-- ============================================================================
create or replace function settle_sports_bet(
  p_bet uuid,
  p_status sports_bet_status,
  p_reason text default null
)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_bet      sports_bets;
  v_mult     integer;
  v_payout   bigint;
  v_after    bigint;
begin
  if p_status not in ('won', 'lost', 'void') then
    raise exception 'settle_sports_bet only accepts won, lost or void' using errcode = '22023';
  end if;

  select * into v_bet from sports_bets where id = p_bet for update;
  if v_bet.id is null then raise exception 'bet not found' using errcode = 'P0002'; end if;
  if v_bet.status <> 'open' then
    return v_bet.payout_px;  -- already settled: no-op, never pay twice
  end if;

  v_payout := case
    when p_status = 'won'  then (v_bet.stake_px * v_bet.odds_x100) / 100
    when p_status = 'void' then v_bet.stake_px
    else 0
  end;

  update sports_bets
     set status = p_status, payout_px = v_payout, settled_at = now()
   where id = p_bet;

  if v_payout > 0 then
    select balance_px into v_after from wallets where user_id = v_bet.user_id for update;
    v_after := v_after + v_payout;
    update wallets
       set balance_px = v_after,
           won_px = won_px + v_payout
     where user_id = v_bet.user_id;

    insert into ledger (user_id, kind, delta_px, balance_after, ref, meta)
    values (v_bet.user_id, 'win', v_payout, v_after, 'sports',
            jsonb_build_object(
              'bet_id', p_bet,
              'settled_as', p_status,
              'reason', p_reason,
              'odds_x100', v_bet.odds_x100));
  else
    insert into ledger (user_id, kind, delta_px, balance_after, ref, meta)
    select v_bet.user_id, 'adjustment', 0, balance_px, 'sports',
           jsonb_build_object('bet_id', p_bet, 'settled_as', p_status, 'reason', p_reason)
      from wallets where user_id = v_bet.user_id;
  end if;

  return v_payout;
end $$;

-- ============================================================================
-- settle_sports_market  — service_role ONLY.
--   Names the winner, closes the market, and fans the result out to every open
--   slip on it. One call per market instead of one per bet, which is what makes
--   settling a whole matchday a single transaction.
-- ============================================================================
create or replace function settle_sports_market(p_market uuid, p_winner uuid)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_bet   record;
  v_count integer := 0;
  v_state sports_bet_status;
begin
  -- Voiding is expressed as p_winner => null: stakes come back, nobody wins.
  update sports_markets
     set is_open = false, winning_selection_id = p_winner
   where id = p_market;
  if not found then raise exception 'market not found' using errcode = 'P0002'; end if;

  for v_bet in
    select id, selection_id from sports_bets where market_id = p_market and status = 'open'
  loop
    v_state := case
      when p_winner is null then 'void'::sports_bet_status
      when v_bet.selection_id = p_winner then 'won'::sports_bet_status
      else 'lost'::sports_bet_status
    end;
    perform settle_sports_bet(v_bet.id, v_state, 'market settled');
    v_count := v_count + 1;
  end loop;

  return v_count;
end $$;

-- ============================================================================
-- Privileges — fail closed, matching 0005's discipline.
-- ============================================================================
revoke all on function place_sports_bet(uuid, bigint) from public, anon, authenticated, service_role;
revoke all on function settle_sports_bet(uuid, sports_bet_status, text) from public, anon, authenticated, service_role;
revoke all on function settle_sports_market(uuid, uuid) from public, anon, authenticated, service_role;

grant execute on function place_sports_bet(uuid, bigint) to authenticated;
grant execute on function settle_sports_bet(uuid, sports_bet_status, text) to service_role;
grant execute on function settle_sports_market(uuid, uuid) to service_role;

-- The catalogue is public to signed-in players; the anon role has no wallet.
grant select on sports_fixtures, sports_markets, sports_selections to anon, authenticated;
grant select on sports_bets to authenticated;
