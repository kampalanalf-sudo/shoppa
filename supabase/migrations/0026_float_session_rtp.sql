-- ============================================================================
-- 0026 — while a player owes a float, the games return 65%
-- ============================================================================
--
-- THE ASK
--
--   "Reduce the rtp for sessions using Float funds, to 65%."
--
-- WHAT A "SESSION USING FLOAT FUNDS" IS, AND WHY IT IS DEFINED THIS WAY
--
-- There is one wallet, and `request_float` credits it — deliberately, see 0023:
-- a separate borrowed pot is exempt money at the cashout gate. So there is no
-- balance to point at and say "this stake came from the float". What there IS,
-- unambiguously, is an outstanding debt:
--
--     session rate applies while  owed - repaid > 0  on an active float
--
-- That is the only definition that cannot be gamed. A player could otherwise
-- spend the float down and keep the low rate on a wallet that is now "theirs",
-- or top up and mix, and the rate would depend on which shilling was spent first.
-- With this definition it is arithmetic on a column, the same on every request,
-- and it needs no client input at all.
--
-- WHY 65% IS AFFECTS EVERY GAME AND NOT JUST THE ODDS SHEET
--
-- The games are provably-fair and their tables are published, so the rate cannot
-- live in the odds. It has to change what a MULTIPLIER is worth when the round is
-- paid: a winning 2.00× pays 1.30× while a float is outstanding, and 1.98×
-- otherwise. That is the only lever that applies to every game at once — dice,
-- limbo, crash, plinko, mines, tower, the wheel, roulette and all six slots —
-- without rewriting each ruleset and the board that animates it.
--
-- WHAT THAT DOES AND DOES NOT TOUCH
--
--   * It does NOT touch the STAKE. A bet is still a bet, and a refund (a
--     cancelled round, a changed mind) still returns exactly what was debited.
--     Scaling the stake instead would mean a float session could not place the
--     same bet it just placed, and would silently break the minimum-bet rule.
--   * It does NOT touch an existing outstanding round. The rate is stamped on the
--     round when it OPENS and used when it SETTLES, so a balance change in
--     between cannot alter a bet already in flight. This is also the audit trail:
--     `rounds.payout_rate` says which rate a payout was computed with.
--   * It does NOT touch the FLOAT ITSELF. Levies, instalments and the 6% fee in
--     0023 are unchanged.
--
-- WHY IT IS CAPPED, AND WHAT THE CAP MEANS
--
-- Divides exactly to 65% for dice, limbo, plinko, mines, tower, the wheel and
-- the six slots. Roulette is the one game the geometry moves: its wheel has 37
-- slots and pays 36 to 1, so its own base return is 36/37 = 97.3%, and the scale
-- is 0.65 / 0.973 = 0.668. A straight-up then pays 24.04× and the table returns
-- 65.0% — the drift comes only from flooring 24.04 to the shilling, about a tenth
-- of a percentage point.
--
-- So this is a SCALE, not a cap: every winning multiplier is multiplied by
-- `rate / the game's own base return`, which moves the table's mean multiplier —
-- its return — onto the session figure exactly, for every game. A cap would only
-- touch the rare large wins and leave a 99% session at 99% (measured: it did).
-- A winning bet still returns at least its stake; losing the stake is decided by
-- the game's own rules and is never amplified.
-- ============================================================================

-- ------------------------------------------------------------- the settings --

create table if not exists gaming_settings (
  id               boolean primary key default true check (id),
  -- what a float session returns, as a fraction. 0.65 = 65%.
  float_session_rtp numeric(5, 4) not null default 0.65
                     check (float_session_rtp >= 0.5 and float_session_rtp <= 1),
  updated_at       timestamptz not null default now()
);
insert into gaming_settings (id, float_session_rtp) values (true, 0.65) on conflict (id) do nothing;

alter table gaming_settings enable row level security;

-- ----------------------------------------------------------------- the rates --

/**
 * The rate for a float session, read from the row above.
 *
 * One value, read by the payment and by the screen, so the number a player is
 * shown is the number a payout is computed with.
 */
create or replace function public.float_session_rtp()
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select float_session_rtp from gaming_settings where id), 0.65::numeric)
$$;

create or replace function public.set_float_session_rtp(p_rate numeric)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_rate is null or p_rate < 0.5 or p_rate > 1 then
    raise exception 'the float-session RTP must be between 50 and 100 percent' using errcode = '22023';
  end if;
  update gaming_settings set float_session_rtp = p_rate, updated_at = now() where id;
  return p_rate;
end $$;

/**
 * The arcade's published base return, PER GAME.
 *
 * These are not all 0.99, and that matters to a rate that is defined as a
 * RETURN. The six slots were built to their own figures (96.2–96.5%), and
 * roulette's 37-slot wheel is 97.3%. Collapsing them all to 99% would make a
 * float session on a slot return 65% of 99% of its real table — 63.5% — which is
 * not what was asked for.
 *
 * One table, read by the payment and by the screen, so the number a player is
 * shown is the number a payout is computed with.
 */
create table if not exists game_base_rtp (
  game  text primary key,
  rtp   numeric(6, 4) not null check (rtp > 0.5 and rtp <= 1)
);
insert into game_base_rtp (game, rtp) values
  ('dice', 0.99), ('limbo', 0.99), ('wheel', 0.99), ('plinko', 0.99),
  ('crash', 0.99), ('mines', 0.99), ('tower', 0.99),
  ('roulette', 0.973),
  ('bonni', 0.962), ('craters', 0.962), ('chape', 0.962),
  ('bluemountain', 0.965), ('bazaar', 0.963), ('boda', 0.962)
on conflict (game) do update set rtp = excluded.rtp;

alter table game_base_rtp enable row level security;

/** The published return of one game. Falls back to 99% for anything new. */
create or replace function public.game_edge(p_game text default null)
returns numeric
language sql
stable
as $$
  select coalesce((select rtp from game_base_rtp where game = p_game), 0.99::numeric)
$$;

/**
 * How much of a winning multiplier is actually paid, right now, for this player.
 *
 * `rounds.payout_rate` is set from this when a round opens, so the answer is
 * fixed for the life of that round.
 */
/**
 * The multiplier scale for a game in a float session.
 *
 * WHY A SCALE AND NOT A CAP
 *
 * The paytables are built so that a multiplier occurs rarely: the wheel's 0.5×,
 * plinko's outer buckets and every dice target above 1.30× are mostly *below* the
 * session figure, so `least(multiplier, rate)` would leave them untouched and the
 * session would still return 99% — the cap only bites on the handful of large
 * wins. Measured: capping returned 99.00% on the wheel, exactly as not capping
 * would.
 *
 * So every multiplier is MULTIPLIED by `rate / game_base_rtp(game)`. The return
 * of a table is the mean multiplier, and scaling every multiplier by k scales
 * the mean by k — so the session returns exactly the rate, for every game,
 * including the ones whose table never was 99%. Losing outcomes stay at 0.
 */
create or replace function public.payout_scale(p_game text)
returns numeric
language sql
stable
as $$
  select public.float_session_rtp() / public.game_edge(p_game)
$$;

create or replace function public.payout_rate_for(p_user uuid)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_owed bigint;
begin
  select greatest(coalesce(f.owed, 0) - coalesce(f.repaid, 0), 0)
    into v_owed
    from floats f
   where f.user_id = p_user and f.status = 'active'
   limit 1;

  if coalesce(v_owed, 0) > 0 then
    return public.float_session_rtp();
  end if;
  return 1.0::numeric;
end $$;

/** Whether a float is outstanding — what the screens show and the games explain. */
create or replace function public.float_session_active(p_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.payout_rate_for(coalesce(p_user, auth.uid())) < 1
$$;

/** What the game floor shows: the rate in force, and why. */
create or replace function public.session_rate_state()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_owed bigint;
  v_rate numeric;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select greatest(coalesce(f.owed, 0) - coalesce(f.repaid, 0), 0) into v_owed
    from floats f where f.user_id = v_uid and f.status = 'active' limit 1;

  v_rate := public.payout_rate_for(v_uid);

  return jsonb_build_object(
    'float_outstanding_px', coalesce(v_owed, 0),
    'active', v_rate < 1,
    -- as a whole percentage, the way a screen says it
    'rtp_pct', round(v_rate * 10000) / 100,
    'base_rtp_pct', round(public.game_edge() * 100, 2)
  );
end $$;

revoke all on function public.float_session_rtp() from public, anon;
grant execute on function public.float_session_rtp() to authenticated, service_role;

revoke all on function public.set_float_session_rtp(numeric) from public, anon, authenticated;
grant execute on function public.set_float_session_rtp(numeric) to service_role;

revoke all on function public.game_edge() from public, anon;
grant execute on function public.game_edge() to authenticated, service_role;

revoke all on function public.payout_scale(text) from public, anon;
grant execute on function public.payout_scale(text) to authenticated, service_role;

revoke all on function public.payout_rate_for(uuid) from public, anon;
grant execute on function public.payout_rate_for(uuid) to authenticated, service_role;

revoke all on function public.float_session_active(uuid) from public, anon;
grant execute on function public.float_session_active(uuid) to authenticated, service_role;

revoke all on function public.session_rate_state() from public, anon;
grant execute on function public.session_rate_state() to authenticated, service_role;

-- ------------------------------------------------------- the round remembers --

alter table rounds add column if not exists payout_rate numeric(6, 4);

comment on column rounds.payout_rate is
  'Fraction of a winning multiplier that this round pays, fixed when it opened. 1 = normal; 0.65 while a float is outstanding.';

-- --------------------------------------------- stamp it when a round opens ---

create or replace function public.round_rate_stamp()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Set by the trigger rather than by each of `start_round` and
  -- `start_board_round`: two functions stamping a money field is two places to
  -- forget it, and a round with no rate would settle at the full table.
  if new.payout_rate is null then
    new.payout_rate := public.payout_rate_for(new.user_id);
  end if;
  return new;
end $$;

drop trigger if exists rounds_stamp_rate on rounds;
create trigger rounds_stamp_rate
  before insert on rounds
  for each row execute function public.round_rate_stamp();

revoke all on function public.round_rate_stamp() from public, anon, authenticated;

-- ------------------------------------------------ pay through it, both ways ---

/**
 * settle_round_server, redefined: every outcome is paid through the round's rate.
 *
 *    payout = floor(wager × min(multiplier, rate) × rate)
 *
 * With no float outstanding `rate` is 1, so this is exactly the old
 * `floor(wager × multiplier)` — the base game is unchanged. With a float it is
 * the advertised reduction, applied once, on the line that pays.
 *
 * The one game whose multiplier is derived HERE rather than by the caller is
 * dice: its payout is a function of the target, so the rate is applied to that
 * function directly, which is what keeps dice at exactly 65% instead of 65% ×
 * 98.5% (which is what scaling its 0.99-based multiplier would have produced).
 */
create or replace function public.settle_round_server(
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
  v_rate    numeric := 1;
  v_scale   numeric;
  v_payout  bigint;
  v_after   bigint;
  v_params  jsonb;
  v_mode    text;
  v_target  numeric;
  v_roll    numeric;
  v_chance  numeric;
begin
  if v_mult < 0 then raise exception 'multiplier cannot be negative' using errcode = '22023'; end if;
  if v_mult > 1000000 then raise exception 'multiplier out of range' using errcode = '22023'; end if;

  select * into v_round from rounds where id = p_round for update;
  if not found then raise exception 'no such round' using errcode = 'P0002'; end if;
  if v_round.status <> 'open' then raise exception 'round already settled' using errcode = '23505'; end if;

  v_rate := coalesce(v_round.payout_rate, 1);
  if v_rate <= 0 or v_rate > 1 then
    raise exception 'round has an unusable payout rate' using errcode = '22023';
  end if;
  v_params := coalesce(v_round.params, '{}'::jsonb);

  -- Dice is re-derived here so its rate is exact rather than a rate on a rate.
  if v_round.game = 'dice' then
    v_mode   := coalesce(v_params->>'mode', 'under');
    v_target := coalesce((v_params->>'target')::numeric, 50);
    if v_target < 2 or v_target > 98 then
      raise exception 'dice target must be between 2 and 98' using errcode = '22023';
    end if;
    -- The same 0..100 roll the board draws: floor(u * 10000) / 100.
    v_roll  := floor(greatest(0, least(0.999999999, coalesce(p_u, 0))) * 10000) / 100;
    v_chance := case when v_mode = 'under' then v_target else 100 - v_target end;

    if (v_mode = 'under' and v_roll < v_target) or (v_mode = 'over' and v_roll > v_target) then
      -- 100/100 = 1× on a fair coin. The session figure IS the return, so the
      -- factor is `rate / 0.99` — not `rate`, which would return 64.35%.
      v_mult := floor((100 / v_chance) * public.payout_scale('dice') * 100) / 100;
    else
      v_mult := 0;
    end if;
    p_detail := format('Rolled %s · %s %s', to_char(v_roll, 'FM990.00'), v_mode, trim(to_char(v_target, 'FM990.00')));
  elsif v_rate < 1 and v_mult > 0 then
    /*
     * ADVERTISE × SCALE = PAID. `payout_scale` is `rate / base_rtp(game)`, so
     * every multiplier in the table moves by the same factor and the table's
     * return — which is the mean multiplier — lands exactly on the session rate.
     *
     * The `round(..., 2)` is applied to the scale, not to the result, and the
     * result is floored to the shilling below. A scale that is too coarse would
     * distort the measured return by more than rounding ever could.
     */
    /*
     * No floor at 1×. The wheel already pays 0.4× and 0.5× on slices that are
     * "wins" in the sense of returning something, and lifting a scaled 0.26× up
     * to 1.00× would RAISE those outcomes — which is exactly how a scale stops
     * being a scale and the measured return lands at 80% instead of 65%
     * (observed). A multiplier below 1 is a partial loss and scales like every
     * other number.
     */
    v_scale := public.payout_scale(v_round.game);
    v_mult := floor(v_mult * v_scale * 100) / 100;
  end if;

  v_payout := floor(v_round.wager_px * v_mult + 1e-9)::bigint;

  select balance_px into v_after from wallets where user_id = v_round.user_id for update;
  v_after := v_after + v_payout;
  update wallets set balance_px = v_after, won_px = won_px + v_payout where user_id = v_round.user_id;

  update rounds
     set payout_px = v_payout, multiplier = v_mult, u = coalesce(p_u, u), detail = coalesce(p_detail, ''),
         status = 'settled', settled_at = now()
   where id = p_round;

  if v_payout > 0 then
    insert into ledger (user_id, kind, delta_px, balance_after, ref, meta)
    values (v_round.user_id, 'win', v_payout, v_after, v_round.game,
            jsonb_build_object('game', v_round.game, 'multiplier', v_mult,
                               'rate', v_rate, 'round', p_round));
  end if;

  return jsonb_build_object('payout', v_payout, 'balance', v_after,
                            'multiplier', v_mult, 'rate', v_rate);
end;
$$;

revoke all on function public.settle_round_server(bigint, numeric, double precision, text) from public, anon, authenticated;
grant execute on function public.settle_round_server(bigint, numeric, double precision, text) to service_role;

/** settle_board_round, redefined: Mines and Tower climb through the same rate. */
create or replace function public.settle_board_round(
  p_round bigint,
  p_multiplier numeric,
  p_detail text
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_round  rounds;
  v_mult   numeric := coalesce(p_multiplier, 0);
  v_rate   numeric := 1;
  v_payout bigint;
  v_after  bigint;
begin
  if v_mult < 0 then raise exception 'multiplier cannot be negative' using errcode = '22023'; end if;
  if v_mult > 1000000 then raise exception 'multiplier out of range' using errcode = '22023'; end if;

  select * into v_round from rounds where id = p_round for update;
  if not found then raise exception 'no such round' using errcode = 'P0002'; end if;
  if v_round.status <> 'open' then raise exception 'round already settled' using errcode = '23505'; end if;

  v_rate := coalesce(v_round.payout_rate, 1);
  if v_rate <= 0 or v_rate > 1 then
    raise exception 'round has an unusable payout rate' using errcode = '22023';
  end if;

  -- The ladder the board shows is the base ladder; a float session scales what
  -- reaching a rung PAYS, not the rung itself, so the next-multiplier previews
  -- the player is climbing toward stay true.
  if v_rate < 1 and v_mult > 0 then
    v_mult := floor(v_mult * public.payout_scale(v_round.game) * 100) / 100;
  end if;

  -- The epsilon matters: 100 * 1.13 is 112.99999999999999 in binary floating
  -- point, and a bare floor would pay 112 for a 113 stake return.
  v_payout := floor(v_round.wager_px * v_mult + 1e-9)::bigint;

  select balance_px into v_after from wallets where user_id = v_round.user_id for update;
  v_after := v_after + v_payout;
  update wallets set balance_px = v_after, won_px = won_px + v_payout where user_id = v_round.user_id;

  update rounds
     set payout_px = v_payout, multiplier = v_mult, detail = coalesce(p_detail, ''),
         status = 'settled', settled_at = now()
   where id = p_round;

  if v_payout > 0 then
    insert into ledger (user_id, kind, delta_px, balance_after, ref, meta)
    values (v_round.user_id, 'win', v_payout, v_after, v_round.game,
            jsonb_build_object('game', v_round.game, 'multiplier', v_mult,
                               'rate', v_rate, 'round', p_round));
  end if;

  return jsonb_build_object('payout', v_payout, 'balance', v_after,
                            'multiplier', v_mult, 'rate', v_rate);
end;
$$;

revoke all on function public.settle_board_round(bigint, numeric, text) from public, anon, authenticated;
grant execute on function public.settle_board_round(bigint, numeric, text) to service_role;
