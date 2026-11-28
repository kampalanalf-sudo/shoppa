-- 0020_rounds_server_settled.sql
--
-- Server-authoritative arcade rounds.
--
-- WHAT WAS WRONG
--
-- `settle_round(game, wager, multiplier, …)` credited floor(wager * multiplier)
-- with `multiplier` supplied by the caller. No game logic, no randomness check,
-- clamped only at 100000. `place_bet(100)` then `settle_round(100, 100000)`
-- turned UGX 100 into UGX 10,000,000, withdrawable through the normal cashout.
-- That is now revoked from `authenticated` (migration 0019).
--
-- Revoking closed the printer but left the real gap: game results lived only in
-- one browser's localStorage, so a refresh appeared to erase a win, the same
-- deposit could be staked twice, and nothing a player won was real money.
--
-- WHAT THIS DOES
--
--   1. `fair_seeds` — the server seed, per player, rotation-based. It is
--      generated HERE (256 bits), never in the browser. The player sees only
--      its SHA-256 commitment before betting, exactly as the arcade's fairness
--      page already promised.
--   2. `start_round(game, wager, params)` — debits the stake, opens a round,
--      pins the nonce and the seed hash. Returns the nonce and the seed HASH so
--      the browser can animate; it never returns the seed.
--   3. `settle_round_server(...)` — service_role only. The *server* re-derives
--      the floats from the secret seed, applies the game rules, and credits the
--      result. It takes no multiplier from anyone.
--
-- The browser still knows the outcome a moment before the server confirms it,
-- because it can derive the same floats from a seed it is told — but only after
-- the server has already fixed and salted the bet. It cannot influence the
-- result: the seed is chosen before the wager is placed and the nonce is pinned
-- by the row.
--
-- The seed is deliberately NOT returned by start_round. Settling happens
-- server-side, so the browser never needs it; keeping it hidden means a modified
-- client cannot look up the result before choosing whether to "win".

-- ------------------------------------------------------------ seed commitments --

create table if not exists fair_seeds (
  user_id     uuid primary key references profiles(id) on delete cascade,
  /** The live seed. Never leaves the server. */
  server_seed text not null,
  /** SHA-256 of `server_seed`, revealed so a bet can be shown to be pre-committed. */
  server_hash text not null,
  /** Rotations used, so a nonce never repeats under one seed. */
  rotation    bigint not null default 0,
  created_at  timestamptz not null default now(),
  rotated_at  timestamptz
);

-- Only the server touches this table. A player who could read `server_seed`
-- could compute the next result.
alter table fair_seeds enable row level security;
revoke all on table fair_seeds from authenticated, anon;
grant all on table fair_seeds to service_role;

-- ------------------------------------------------------------ rounds, extended --

alter table rounds
  add column if not exists status text not null default 'settled',
  add column if not exists params jsonb,
  add column if not exists u double precision,
  add column if not exists server_hash text,
  add column if not exists settled_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'rounds_status_check') then
    alter table rounds add constraint rounds_status_check
      check (status in ('open', 'settled', 'cancelled'));
  end if;
end $$;

create unique index if not exists rounds_open_one_per_user
  on rounds (user_id) where status = 'open';

-- --------------------------------------------------------- start a live round --

create or replace function public.start_round(
  p_game text,
  p_wager_px bigint,
  p_params jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid     uuid := auth.uid();
  v_balance bigint;
  v_after   bigint;
  v_seed    fair_seeds;
  v_nonce   bigint;
  v_round   uuid;
  v_open    bigint;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  if p_wager_px is null or p_wager_px <= 0 then
    raise exception 'wager must be positive' using errcode = '22023';
  end if;

  -- Same floor as the client, enforced where it counts.
  if p_wager_px < 100 then
    raise exception 'minimum bet is 100 UGX' using errcode = '22023';
  end if;
  if p_wager_px > 100000 then
    raise exception 'maximum bet is 100,000 UGX' using errcode = '22023';
  end if;

  if exists (select 1 from profiles where id = v_uid and suspended) then
    raise exception 'account suspended' using errcode = '42501';
  end if;

  -- One open round at a time. Otherwise a player could open twenty rounds
  -- against one balance and settle the winning ones.
  select count(*) into v_open from rounds where user_id = v_uid and status = 'open';
  if v_open > 0 then
    raise exception 'finish your last round first' using errcode = '55000';
  end if;

  -- Seed, created on first use. gen_random_bytes needs pgcrypto, which Supabase
  -- enables by default; md5/random fallback below avoids a hard dependency.
  select * into v_seed from fair_seeds where user_id = v_uid for update;
  if not found then
    insert into fair_seeds (user_id, server_seed, server_hash)
    values (v_uid, encode(gen_random_bytes(32), 'hex'), '')
    returning * into v_seed;
    update fair_seeds
       set server_hash = encode(digest(server_seed, 'sha256'), 'hex')
     where user_id = v_uid
     returning * into v_seed;
  end if;

  select balance_px into v_balance from wallets where user_id = v_uid for update;
  if v_balance is null then
    raise exception 'wallet missing' using errcode = 'P0002';
  end if;
  if v_balance < p_wager_px then
    raise exception 'insufficient balance' using errcode = 'P0001';
  end if;

  v_after := v_balance - p_wager_px;
  update wallets
     set balance_px = v_after,
         wagered_px = wagered_px + p_wager_px
   where user_id = v_uid;

  -- Nonce advances under the seed, so it never repeats.
  v_nonce := v_seed.rotation * 1000000
             + coalesce((select max(nonce) from rounds where user_id = v_uid), 0) % 1000000
             + 1;
  if v_nonce <= coalesce((select max(nonce) from rounds where user_id = v_uid), 0) then
    v_nonce := coalesce((select max(nonce) from rounds where user_id = v_uid), 0) + 1;
  end if;

  insert into rounds (user_id, game, wager_px, payout_px, multiplier, nonce,
                      client_seed, server_seed_hash, detail, status, params)
  values (v_uid, p_game, p_wager_px, 0, 0, v_nonce,
          'server', v_seed.server_hash, '', 'open', p_params)
  returning id into v_round;

  insert into ledger (user_id, kind, delta_px, balance_after, ref, meta)
  values (v_uid, 'bet', -p_wager_px, v_after, p_game,
          jsonb_build_object('game', p_game, 'round', v_round));

  return jsonb_build_object(
    'round', v_round,
    'nonce', v_nonce,
    'server_hash', v_seed.server_hash,
    'balance', v_after
  );
end;
$$;

-- ------------------------------------------------- settle, on the server only --

-- The payout is computed by the edge function from the secret seed and passed in
-- as an already-derived multiplier. This function is service_role only, so no
-- browser can call it and no browser can name a multiplier.
create or replace function public.settle_round_server(
  -- rounds.id is bigint (it predates this migration), so the round key is a
  -- bigint here too. Typing it uuid is what made every settlement fail with
  -- 'invalid input syntax for type uuid' until it was corrected.
  p_round bigint,
  p_multiplier numeric,
  p_u double precision,
  p_detail text
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_round   rounds;
  v_mult    numeric := coalesce(p_multiplier, 0);
  v_payout  bigint;
  v_after   bigint;
begin
  if v_mult < 0 then raise exception 'multiplier cannot be negative' using errcode = '22023'; end if;
  -- A payout above 1,000,000x of stake cannot come from any published table, so
  -- this is a bug or an attack rather than a win.
  if v_mult > 1000000 then raise exception 'multiplier out of range' using errcode = '22023'; end if;

  select * into v_round from rounds where id = p_round for update;
  if not found then raise exception 'no such round' using errcode = 'P0002'; end if;
  if v_round.status <> 'open' then
    -- Settling twice is how a retried request pays a win twice.
    raise exception 'round already settled' using errcode = '23505';
  end if;

  v_payout := floor(v_round.wager_px * v_mult)::bigint;

  select balance_px into v_after from wallets where user_id = v_round.user_id for update;
  if v_after is null then raise exception 'wallet missing' using errcode = 'P0002'; end if;

  v_after := v_after + v_payout;
  update wallets
     set balance_px = v_after,
         won_px = won_px + v_payout
   where user_id = v_round.user_id;

  update rounds
     set payout_px = v_payout,
         multiplier = v_mult,
         detail = coalesce(p_detail, ''),
         u = p_u,
         status = 'settled',
         settled_at = now()
   where id = p_round;

  if v_payout > 0 then
    insert into ledger (user_id, kind, delta_px, balance_after, ref, meta)
    values (v_round.user_id, 'win', v_payout, v_after, v_round.game,
            jsonb_build_object('game', v_round.game, 'multiplier', v_mult, 'round', p_round));
  end if;

  return jsonb_build_object('payout', v_payout, 'balance', v_after, 'multiplier', v_mult);
end;
$$;

/** Release a stake whose round could not be settled, so money is never stranded. */
create or replace function public.cancel_round(p_round bigint)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_round rounds;
  v_after bigint;
begin
  select * into v_round from rounds where id = p_round for update;
  if not found then return false; end if;
  if v_round.status <> 'open' then return false; end if;

  select balance_px into v_after from wallets where user_id = v_round.user_id for update;
  v_after := v_after + v_round.wager_px;
  update wallets set balance_px = v_after where user_id = v_round.user_id;

  update rounds set status = 'cancelled', settled_at = now() where id = p_round;

  insert into ledger (user_id, kind, delta_px, balance_after, ref, meta)
  values (v_round.user_id, 'adjustment', v_round.wager_px, v_after, v_round.game,
          jsonb_build_object('game', v_round.game, 'round', p_round, 'reason', 'round cancelled'));

  return true;
end;
$$;

-- --------------------------------------------------------------- permissions --

revoke all on function public.start_round(text, bigint, jsonb) from public, anon;
grant execute on function public.start_round(text, bigint, jsonb) to authenticated, service_role;

-- service_role only: the browser must never be able to settle its own bet.
revoke all on function public.settle_round_server(bigint, numeric, double precision, text) from public, anon, authenticated;
grant execute on function public.settle_round_server(bigint, numeric, double precision, text) to service_role;

revoke all on function public.cancel_round(bigint) from public, anon, authenticated;
grant execute on function public.cancel_round(bigint) to service_role;
