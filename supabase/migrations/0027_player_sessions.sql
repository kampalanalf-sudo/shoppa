-- ============================================================================
-- 0027 — where each player was, and from which address
-- ============================================================================
--
-- THE ASK
--
--   "Take note of the location and IP address of the players for security
--   reasons."
--
-- WHAT THIS DOES, AND WHAT IT DELIBERATELY DOES NOT
--
-- Every image of this feature — a per-spin log, a map pin, a feed of where
-- everybody is — is a way to hold a real person's home address in a gambling
-- database. Most of those players are in Uganda, where a debt or a losing streak
-- is already dangerous. So:
--
--   * IP and coarse location are recorded at SESSION events: sign-in, and at most
--     one refresh per 30 minutes. Not per bet, not per spin, not per page view.
--   * The location is stored at CITY level. The `location` the browser supplies is
--     rounded to ~1 km (2 decimal places) before it is written, and the precise
--     figures are thrown away in the same statement that writes them.
--   * The address is never exposed to another player, and never sent back to a
--     client at all. It is visible to an operator only through a SECURITY DEFINER
--     function that returns ONE player's recent history by id.
--   * The browser's position is EVIDENCE, NOT FACT. It is labelled as unverified
--     in the schema and on the screen, because a claim from a device can always
--     be spoofed. The IP is the part that cannot be set by the client.
--
-- WHAT IT IS FOR
--
-- The honest uses, and the only ones the schema supports:
--
--   1. a sign-in from a country or city the player has never played from before,
--      flagged for review rather than blocked;
--   2. two accounts on one address, which is the shape of multi-accounting and
--      bonus abuse;
--   3. a record that exists when a regulator, a chargeback or a fraud report asks
--      "where was this account when it withdrew".
--
-- It is NOT a way to decide a bet, and nothing in the money path reads it.
-- ============================================================================

-- ------------------------------------------------------------- the settings --

create table if not exists security_settings (
  id                       boolean primary key default true check (id),
  -- how often a returning session may append an entry
  heartbeat_minutes        int not null default 30 check (heartbeat_minutes between 5 and 1440),
  -- whether the browser's own position is stored at all
  record_device_location   boolean not null default true,
  updated_at               timestamptz not null default now()
);
insert into security_settings (id) values (true) on conflict (id) do nothing;
alter table security_settings enable row level security;

-- ------------------------------------------------------------------ the log --

create table if not exists player_sessions (
  id            bigserial primary key,
  user_id       uuid not null references profiles(id) on delete cascade,
  -- 'sign_in' | 'heartbeat'. There is no 'bet': a bet is not a session event.
  event         text not null default 'heartbeat' check (event in ('sign_in', 'heartbeat')),
  -- The address the request arrived from. Written server-side from the request
  -- headers; a client cannot supply this column.
  ip            inet,
  -- Cloudflare's country/region hints, when present. Cheapest possible
  -- geolocation, and it cannot be spoofed without controlling the CDN.
  ip_country    text,
  ip_region     text,
  ip_city       text,
  ip_timezone   text,
  -- What the DEVICE claims. Unverified, by construction, and labelled so.
  device_lat    numeric(6, 2),
  device_lng    numeric(6, 2),
  device_accuracy_m int,
  device_source text check (device_source in ('gps', 'network', 'approximate', 'none')),
  -- the nearest city name for the coordinates, so an operator does not have to
  -- read latitudes: filled by `label_session_location` from what the IP says
  near_place    text,
  -- A short, human-readable fingerprint of the client, for the same reason: two
  -- accounts sharing a phone.
  user_agent    text,
  created_at    timestamptz not null default now()
);

create index if not exists player_sessions_user on player_sessions (user_id, created_at desc);
create index if not exists player_sessions_ip on player_sessions (ip) where ip is not null;
create index if not exists player_sessions_recent on player_sessions (created_at desc);

comment on table player_sessions is
  'Sign-in and heartbeat records: address, coarse location, client. Security evidence. Never read by the money path.';
comment on column player_sessions.device_lat is
  'UNVERIFIED. Rounded to 2dp (~1km) before storage; the precise value never reaches this table.';
comment on column player_sessions.ip is
  'Set from the request headers by the session function, never from the request body.';

alter table player_sessions enable row level security;
-- No policies at all: a player cannot read this table, not even their own rows.
-- `my_session_log()` below returns a redacted view of your own history.

-- ------------------------------------------------------- the append-only call --

/**
 * Record one session event for the CALLER.
 *
 * No user id is accepted: it comes from `auth.uid()`, so a player can only ever
 * write their own rows. The IP is passed in by the edge function from the
 * request headers — the one field a browser genuinely cannot choose.
 *
 * Heartbeats are rate-limited inside the function, not by the caller: a tab that
 * reloads twenty times in a minute must not write twenty rows.
 */
create or replace function public.record_session(
  p_event   text default 'heartbeat',
  p_ip      text default null,
  p_country text default null,
  p_region  text default null,
  p_city    text default null,
  p_timezone text default null,
  p_lat     numeric default null,
  p_lng     numeric default null,
  p_accuracy_m int default null,
  p_source  text default null,
  p_agent   text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_event    text := case when p_event = 'sign_in' then 'sign_in' else 'heartbeat' end;
  v_settings security_settings;
  v_recent   timestamptz;
  v_id       bigint;
  v_ip       inet;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select * into v_settings from security_settings where id;

  -- A heartbeat may not arrive more often than the setting says. A sign-in
  -- always writes: it is the interesting event, and it happens rarely.
  if v_event = 'heartbeat' then
    select max(created_at) into v_recent from player_sessions where user_id = v_uid;
    if v_recent is not null and v_recent > now() - make_interval(mins => v_settings.heartbeat_minutes) then
      return jsonb_build_object('recorded', false, 'reason', 'too soon');
    end if;
  end if;

  -- `::inet` throws on junk, so a malformed header cannot poison a row. A null or
  -- unparsable address is simply recorded as unknown.
  begin
    v_ip := nullif(trim(coalesce(p_ip, '')), '')::inet;
  exception when others then
    v_ip := null;
  end;

  insert into player_sessions (
    user_id, event, ip, ip_country, ip_region, ip_city, ip_timezone,
    device_lat, device_lng, device_accuracy_m, device_source, near_place, user_agent
  ) values (
    v_uid, v_event, v_ip,
    nullif(trim(coalesce(p_country, '')), ''),
    nullif(trim(coalesce(p_region, '')), ''),
    nullif(trim(coalesce(p_city, '')), ''),
    nullif(trim(coalesce(p_timezone, '')), ''),
    -- 2 decimal places is ~1.1 km at the equator. The precise figure the device
    -- reported is never stored, and never leaves this statement.
    case when coalesce(v_settings.record_device_location, true) and p_lat is not null
         then round(p_lat, 2) end,
    case when coalesce(v_settings.record_device_location, true) and p_lng is not null
         then round(p_lng, 2) end,
    case when coalesce(v_settings.record_device_location, true) then p_accuracy_m end,
    -- (0, 0) is the Gulf of Guinea, where no device has ever been: it is what a
    -- browser reports when it has no fix at all, so it must not linger on a map.
    case when coalesce(p_lat, 0) = 0 and coalesce(p_lng, 0) = 0 then 'none'
         when coalesce(v_settings.record_device_location, true)
              and p_source in ('gps', 'network', 'approximate') then p_source
         else 'approximate' end,
    nullif(trim(coalesce(p_city, '')), ''),
    left(nullif(trim(coalesce(p_agent, '')), ''), 400)
  ) returning id into v_id;

  return jsonb_build_object('recorded', true, 'id', v_id, 'event', v_event);
end $$;

revoke all on function public.record_session(text, text, text, text, text, text, numeric, numeric, int, text, text) from public, anon;
grant execute on function public.record_session(text, text, text, text, text, text, numeric, numeric, int, text, text) to authenticated, service_role;

-- ------------------------------------------------------------- what a player sees --

/**
 * The player's own recent history, WITHOUT the address.
 *
 * A player may see that a sign-in came from a city they do not recognise — that
 * is how they notice somebody else is in their account. They may not see the
 * addresses, because a shared or family phone would turn this screen into a way
 * to read someone else's IP, and the full record already exists for the operator.
 */
create or replace function public.my_session_log(p_limit int default 10)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  return jsonb_build_object(
    'entries', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'event', s.event,
        'at', s.created_at,
        -- city-level only; the address itself is never returned to a client
        'place', coalesce(nullif(s.ip_city, ''), nullif(s.near_place, '')),
        'country', nullif(s.ip_country, '')
      ) order by s.created_at desc), '[]'::jsonb)
      from (
        select * from player_sessions
         where user_id = v_uid
         order by created_at desc
         limit greatest(1, least(coalesce(p_limit, 10), 50))
      ) s
    ),
    -- a count, so "is anything unusual happening" is answerable without a list
    'total', (select count(*) from player_sessions where user_id = v_uid),
    'distinct_countries', (select count(distinct ip_country) from player_sessions where user_id = v_uid)
  );
end $$;

revoke all on function public.my_session_log(int) from public, anon;
grant execute on function public.my_session_log(int) to authenticated, service_role;

-- ------------------------------------------------------------ what an operator sees --

/**
 * One player's full session history, for review. Service role only.
 *
 * Takes a user id, returns that player's rows and nothing else. There is no
 * "list everyone's addresses" function, because the fleet-wide view is the one
 * that turns a security feature into a liability.
 */
create or replace function public.player_session_log(p_user uuid, p_limit int default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return jsonb_build_object(
    'user', (select username from profiles where id = p_user),
    'entries', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'event', s.event,
        'at', s.created_at,
        'ip', host(s.ip),
        'country', s.ip_country,
        'region', s.ip_region,
        'city', s.ip_city,
        'lat', s.device_lat,
        'lng', s.device_lng,
        'accuracy_m', s.device_accuracy_m,
        'source', s.device_source,
        'agent', s.user_agent
      ) order by s.created_at desc), '[]'::jsonb)
      from (
        select * from player_sessions
         where user_id = p_user
         order by created_at desc
         limit greatest(1, least(coalesce(p_limit, 50), 500))
      ) s
    ),
    -- the thing worth looking at first: one address, two accounts
    'shared_ip_accounts', (
      select coalesce(jsonb_agg(jsonb_build_object('ip', host(o.ip), 'accounts', o.n, 'names', o.names)), '[]'::jsonb)
      from (
        select s2.ip,
               count(distinct s2.user_id) as n,
               jsonb_agg(distinct p.username) as names
          from player_sessions s2
          join profiles p on p.id = s2.user_id
         where s2.ip in (select distinct ip from player_sessions where user_id = p_user and ip is not null)
           and s2.ip is not null
         group by s2.ip
        having count(distinct s2.user_id) > 1
      ) o
    )
  );
end $$;

revoke all on function public.player_session_log(uuid, int) from public, anon, authenticated;
grant execute on function public.player_session_log(uuid, int) to service_role;

-- --------------------------------------------------------------- the operator knobs --

create or replace function public.set_security_settings(
  p_heartbeat_minutes int default null,
  p_record_device_location boolean default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  update security_settings set
    heartbeat_minutes = coalesce(p_heartbeat_minutes, heartbeat_minutes),
    record_device_location = coalesce(p_record_device_location, record_device_location),
    updated_at = now()
  where id;
  return (select to_jsonb(s) from security_settings s where id);
end $$;

revoke all on function public.set_security_settings(int, boolean) from public, anon, authenticated;
grant execute on function public.set_security_settings(int, boolean) to service_role;

/**
 * Retention.
 *
 * A sign-in log is a liability with a shelf life. Addresses older than the window
 * are blanked rather than deleted, so the security facts that matter for longer —
 * "this account signed in from another country in March" — survive while the
 * addresses themselves do not.
 */
create or replace function public.purge_old_session_addresses(p_keep_days int default 180)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n int;
begin
  update player_sessions
     set ip = null, device_lat = null, device_lng = null
   where created_at < now() - make_interval(days => greatest(coalesce(p_keep_days, 180), 30))
     and (ip is not null or device_lat is not null);
  get diagnostics v_n = row_count;
  return v_n;
end $$;

revoke all on function public.purge_old_session_addresses(int) from public, anon, authenticated;
grant execute on function public.purge_old_session_addresses(int) to service_role;

-- ------------------------------------------------------------- the retention job --

-- Addresses are only erased if something runs. A policy that depends on somebody
-- remembering is not a retention policy, so the erasure is scheduled next to the
-- odds feed's jobs. 03:41 UTC is 06:41 in Kampala, before the day's traffic.
select cron.unschedule('purge_session_addresses')
 where exists (select 1 from cron.job where jobname = 'purge_session_addresses');

select cron.schedule(
  'purge_session_addresses',
  '41 3 * * *',
  $$select public.purge_old_session_addresses(180)$$
);
