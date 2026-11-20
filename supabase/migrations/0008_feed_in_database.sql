-- 0008_feed_in_database.sql
-- ============================================================================
-- Moving the odds feed out of a serverless function and into the database.
--
-- 0007 assumed the feed would run in a Vercel function woken by `vercel.json`.
-- It worked, but it carried three costs that only became obvious in use:
--
--   1. It needed three environment variables in a hosting dashboard AND a
--      redeploy before any of them took effect. "I set the variable and
--      nothing changed" is the most common way this class of bug is reported.
--   2. It could not be run or inspected without a terminal — and the person
--      operating this project does not have one.
--   3. The Vercel account available here cannot see the target project, so the
--      route was unreachable from the seat where the work happens.
--
-- So the feed moved into Postgres. `pg_cron` holds the schedule, `pg_net` makes
-- the outbound HTTPS call, and the API key lives in Supabase Vault — so it is
-- never part of a build artefact and never enters a browser bundle by accident.
--
-- The odds logic is unchanged: median consensus across bookmakers, normalised
-- to strip the bookmakers' own overround, then our margin applied on top. What
-- changed is only where it runs.
--
-- Security posture, restated because the key is billable:
--   * `vault` grants USAGE to neither `anon` nor `authenticated`.
--   * `feed_fire_sync`, `feed_ingest_odds` and `feed_close_started` are all
--     `security definer` and revoked from `public`, `anon`, `authenticated`
--     and `service_role`. Only the cron scheduler (postgres) calls them.
--   * The site reads odds through RLS SELECT policies and nothing else. It
--     cannot write a fixture, a price, or a bet row directly.
-- ============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ---------------------------------------------------------------------------
-- Config and queue
-- ---------------------------------------------------------------------------

-- One row, forever. Two sports at 6 runs a day is ~360 credits/month against a
-- 500 free tier. A third sport ×6 runs would be ~540 and would stop working
-- partway through the month, so NBA is deliberately not enabled.
create table if not exists feed_config (
  id integer primary key default 1 check (id = 1),
  sports text[] not null default array['soccer_epl', 'soccer_uefa_champs_league'],
  margin_pct numeric not null default 4 check (margin_pct >= 0 and margin_pct <= 25),
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);
insert into feed_config (id) values (1) on conflict (id) do nothing;

-- Every outbound call, so a failure is diagnosable without a log viewer.
-- `request_id` is pg_net's own id, which is how the response is found again.
create table if not exists feed_requests (
  id bigserial primary key,
  request_id bigint,
  sport text not null,
  kind text not null default 'odds' check (kind in ('odds', 'scores', 'sports')),
  fired_at timestamptz not null default now(),
  processed_at timestamptz,
  error text
);
create index if not exists feed_requests_pending
  on feed_requests (fired_at) where processed_at is null;

-- Ingestion must be idempotent on the market's outcome name, so a replayed
-- payload updates a price instead of inserting a second "Draw".
create unique index if not exists sports_selections_market_name
  on sports_selections (market_id, name);

-- ---------------------------------------------------------------------------
-- Fire: queue the HTTP requests. No parsing here.
-- ---------------------------------------------------------------------------
create or replace function feed_fire_sync()
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_cfg feed_config;
  v_sport text;
  v_key text;
  v_id bigint;
  v_n integer := 0;
begin
  select * into v_cfg from feed_config where id = 1;
  if v_cfg is null or not v_cfg.enabled or v_cfg.sports is null then
    return 0;
  end if;

  select decrypted_secret into v_key
    from vault.decrypted_secrets where name = 'odds_api_key';
  if v_key is null then
    insert into feed_requests (sport, kind, error)
    values ('-', 'odds', 'odds_api_key missing from vault');
    return 0;
  end if;

  foreach v_sport in array v_cfg.sports loop
    select net.http_get(
      url := 'https://api.the-odds-api.com/v4/sports/' || v_sport ||
             '/odds?regions=eu&markets=h2h&oddsFormat=decimal&dateFormat=iso' ||
             '&apiKey=' || v_key
    ) into v_id;
    insert into feed_requests (request_id, sport, kind) values (v_id, v_sport, 'odds');
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- ---------------------------------------------------------------------------
-- Ingest: read the responses and turn them into a board.
--
-- Two `pg_net` details are load-bearing:
--
--   * The response columns are `status_code` and `content`. Reading `status` or
--     `body` returns NULL instead of raising, which looks exactly like "the API
--     returned nothing". That mistake cost a full cycle here.
--   * A failure must NOT set `processed_at`. Marking a broken request as
--     processed consumes it, and the retry then ingests nothing. Failed rows
--     stay pending with the error attached so a re-run is a plain re-run.
-- ---------------------------------------------------------------------------
create or replace function feed_ingest_odds()
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_req feed_requests;
  v_body text;
  v_status integer;
  v_cfg feed_config;
  v_ev jsonb;
  v_fixture uuid;
  v_market uuid;
  v_n integer := 0;
  v_outcome record;
  v_overround numeric;
  v_fair numeric;
  v_odds integer;
begin
  perform feed_close_started();
  select * into v_cfg from feed_config where id = 1;

  for v_req in
    select * from feed_requests
     where kind = 'odds' and processed_at is null
       and fired_at > now() - interval '30 minutes'
     order by id
  loop
    begin
      select r.status_code, r.content into v_status, v_body
        from net._http_response r where r.id = v_req.request_id;

      -- pg_net is asynchronous: not yet arrived is not a failure.
      if v_status is null then continue; end if;
      if v_status <> 200 then
        update feed_requests set processed_at = now(),
               error = 'http ' || v_status where id = v_req.id;
        continue;
      end if;

      for v_ev in select * from jsonb_array_elements(v_body::jsonb) loop
        insert into sports_fixtures
          (sport, league, home_team, away_team, starts_at, source, source_ref, external_id)
        values (
          case when v_req.sport like 'basketball%' then 'basketball'::sport_kind
               when v_req.sport like 'cricket%' then 'cricket'::sport_kind
               when v_req.sport like 'rugby%' then 'rugby'::sport_kind
               when v_req.sport like 'tennis%' then 'tennis'::sport_kind
               else 'football'::sport_kind end,
          coalesce(v_ev->>'sport_title', v_req.sport),
          v_ev->>'home_team', v_ev->>'away_team',
          (v_ev->>'commence_time')::timestamptz,
          'oddsapi', v_ev->>'id', v_ev->>'id')
        on conflict (source, source_ref) where source_ref is not null
        do update set starts_at = excluded.starts_at, updated_at = now()
        returning id into v_fixture;

        -- The free tier is pre-match only. A fresh-looking price on a match
        -- that has already started would be a stale pre-match quote.
        if (v_ev->>'commence_time')::timestamptz <= now() then continue; end if;

        insert into sports_markets (fixture_id, name) values (v_fixture, 'Match result')
        on conflict do nothing;
        select id into v_market from sports_markets
         where fixture_id = v_fixture and name = 'Match result' limit 1;
        if v_market is null then continue; end if;

        create temp table if not exists _consensus (name text primary key, price numeric);
        truncate _consensus;
        insert into _consensus (name, price)
        select o->>'name',
               percentile_cont(0.5) within group (order by (o->>'price')::numeric)
          from jsonb_array_elements(v_ev->'bookmakers') b,
               jsonb_array_elements(b->'markets') m,
               jsonb_array_elements(m->'outcomes') o
         where m->>'key' = 'h2h' and (o->>'price')::numeric > 1
         group by o->>'name';

        -- Bookmaker prices already contain THEIR margin. Taking each outcome's
        -- median independently keeps that margin and stacks ours on top: a
        -- measured overround of 1.103 while margin_pct read 4. Normalising to
        -- sum(1/price) = 1 strips their overround, so margin_pct means what it
        -- says. Measured after: 1.0494 (= our 4% + rounding in our favour).
        select sum(1.0 / price) into v_overround from _consensus;
        if v_overround is null or v_overround <= 0 then
          update feed_requests set processed_at = now(),
                 error = 'no outcomes' where id = v_req.id;
          continue;
        end if;

        for v_outcome in select name, price from _consensus loop
          v_fair := (1.0 / v_outcome.price) / v_overround;
          v_odds := greatest(101,
                    floor((1.0 / v_fair) * (1 - v_cfg.margin_pct / 100) * 100)::integer);
          insert into sports_selections (market_id, name, odds_x100, price_at)
          values (v_market, v_outcome.name, v_odds, now())
          on conflict (market_id, name) do update
            set odds_x100 = excluded.odds_x100, price_at = now(), is_active = true;
        end loop;

        v_n := v_n + 1;
      end loop;

      update feed_requests set processed_at = now() where id = v_req.id;
    exception when others then
      -- Deliberately no `processed_at`: leave it pending so it can be retried.
      update feed_requests set error = left(sqlerrm, 300) where id = v_req.id;
    end;
  end loop;
  return v_n;
end $$;

-- ---------------------------------------------------------------------------
-- Close: shut the market at kick-off.
--
-- The frontend also filters on `starts_at > now()`, and `place_sports_bet`
-- refuses on the clock. This is the third layer, and the one that makes the
-- UI grey out rather than merely reject.
-- ---------------------------------------------------------------------------
create or replace function feed_close_started()
returns integer
language plpgsql security definer set search_path = public as $$
declare v_m integer; v_s integer;
begin
  with closed as (
    update sports_markets m set is_open = false
      from sports_fixtures f
     where f.id = m.fixture_id and m.is_open
       and f.starts_at <= now() and f.status = 'upcoming'
    returning m.id
  ) select count(*) into v_m from closed;

  with closed as (
    update sports_selections s set is_active = false
      from sports_markets m, sports_fixtures f
     where m.id = s.market_id and f.id = m.fixture_id
       and s.is_active and f.starts_at <= now() and f.status = 'upcoming'
    returning s.id
  ) select count(*) into v_s from closed;

  return v_m + v_s;
end $$;

revoke all on function feed_fire_sync()    from public, anon, authenticated, service_role;
revoke all on function feed_ingest_odds()  from public, anon, authenticated, service_role;
revoke all on function feed_close_started() from public, anon, authenticated, service_role;
revoke all on table feed_config, feed_requests from public, anon, authenticated;

-- The site reads odds; it never writes them. 0006 left the table grants at
-- Postgres's permissive default (anon could INSERT), which RLS happened to
-- block because no write policy exists — but "blocked by a missing policy" is
-- one policy away from not being blocked. Narrow the grants so it is true by
-- construction.
revoke insert, update, delete, truncate, references, trigger
  on sports_fixtures, sports_markets, sports_selections, sports_bets
  from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Price age follows the refresh cadence.
--
-- 0007 set the staleness guard to 90 minutes, which matched its assumption of
-- a 2-hourly poll. At 4-hourly that guard rejects every bet for 2.5 hours of
-- every 4 — and does it with an error that reads like a bug. 15,000s is the
-- 4-hour cycle plus ten minutes of slack. It also means that if the scheduler
-- ever stalls, prices age out and betting stops by itself rather than
-- continuing to offer month-old odds.
-- ---------------------------------------------------------------------------
alter table sports_markets alter column max_price_age_seconds set default 15000;
update sports_markets set max_price_age_seconds = 15000
 where max_price_age_seconds is null;

-- ---------------------------------------------------------------------------
-- The schedule. Idempotent: safe to run again if it is ever lost.
--
-- The ingest runs twice (:12 and :17) because pg_net gives no completion
-- guarantee. The second pass finds the queue drained and does nothing, so the
-- redundancy is free.
-- ---------------------------------------------------------------------------
select cron.schedule('feed_fire_sync',     '7 */4 * * *',     'select feed_fire_sync()');
select cron.schedule('feed_ingest_odds',   '12,17 */4 * * *', 'select feed_ingest_odds()');
select cron.schedule('feed_close_started', '*/5 * * * *',     'select feed_close_started()');
