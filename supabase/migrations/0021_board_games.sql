-- 0021_board_games.sql
--
-- Mines and Tower: the hidden board lives on the server.
--
-- WHY THIS IS NOT LIKE DICE
--
-- Dice has one outcome, drawn once. Mines and Tower have a BOARD that a player
-- explores over several moves, and the whole game is the asymmetry between what
-- the server knows and what the player does not. A client that knows where the
-- mines are, or where the safe tile is, will always cash out on time.
--
-- So the layout is generated server-side from the secret seed and never sent.
-- The client asks "reveal cell 7" and gets back only that cell.
--
-- The stake is taken at start and the current payout is held on the round, so a
-- player can leave mid-climb: cashing out credits the multiplier for the picks
-- already made, and hitting a mine credits nothing.

alter table rounds add column if not exists board jsonb;

/**
 * Open a board round.
 *
 * Returns everything EXCEPT the layout: the pick count starts at zero and the
 * payout multiple with it. `max_picks` tells the UI when a board is solved.
 */
create or replace function public.start_board_round(
  p_game text,
  p_wager_px bigint,
  p_mines integer default 3,
  p_difficulty integer default 1
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
  v_round   bigint;
  v_open    bigint;
  v_max     bigint;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if p_game not in ('mines', 'tower') then
    raise exception 'not a board game' using errcode = '22023';
  end if;

  if p_wager_px is null or p_wager_px <= 0 then
    raise exception 'wager must be positive' using errcode = '22023';
  end if;
  if p_wager_px < 100 then raise exception 'minimum bet is 100 UGX' using errcode = '22023'; end if;
  if p_wager_px > 100000 then raise exception 'maximum bet is 100,000 UGX' using errcode = '22023'; end if;

  if p_game = 'mines' and p_mines not in (1, 3, 5, 10, 15, 20, 24) then
    raise exception 'choose 1, 3, 5, 10, 15, 20 or 24 mines' using errcode = '22023';
  end if;
  if p_game = 'tower' and p_difficulty not in (1, 2, 3) then
    raise exception 'difficulty must be 1, 2 or 3' using errcode = '22023';
  end if;

  if exists (select 1 from profiles where id = v_uid and suspended) then
    raise exception 'account suspended' using errcode = '42501';
  end if;

  select count(*) into v_open from rounds where user_id = v_uid and status = 'open';
  if v_open > 0 then raise exception 'finish your last round first' using errcode = '55000'; end if;

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
  if v_balance is null then raise exception 'wallet missing' using errcode = 'P0002'; end if;
  if v_balance < p_wager_px then raise exception 'insufficient balance' using errcode = 'P0001'; end if;

  v_after := v_balance - p_wager_px;
  update wallets
     set balance_px = v_after,
         wagered_px = wagered_px + p_wager_px
   where user_id = v_uid;

  select coalesce(max(nonce), 0) into v_max from rounds where user_id = v_uid;

  insert into rounds (user_id, game, wager_px, payout_px, multiplier, nonce,
                      client_seed, server_seed_hash, detail, status, params, board)
  values (v_uid, p_game, p_wager_px, 0, 0, v_max + 1, 'server', v_seed.server_hash,
          '', 'open',
          jsonb_build_object('mines', p_mines, 'difficulty', p_difficulty),
          -- The layout is computed by the edge function from the secret seed and
          -- stored here. It is never returned to the client: this row is
          -- readable only through service_role.
          jsonb_build_object('picks', '[]'::jsonb, 'levels', 0))
  returning id into v_round;

  insert into ledger (user_id, kind, delta_px, balance_after, ref, meta)
  values (v_uid, 'bet', -p_wager_px, v_after, p_game,
          jsonb_build_object('game', p_game, 'round', v_round));

  return jsonb_build_object(
    'round', v_round,
    'nonce', v_max + 1,
    'server_hash', v_seed.server_hash,
    'balance', v_after,
    'mines', p_mines,
    'difficulty', p_difficulty
  );
end;
$$;

/**
 * Settle a board round at the current step.
 *
 * `p_multiplier` is derived by the edge function from the board it holds, not
 * from anything the client sent. A bust passes 0.
 */
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
  v_payout bigint;
  v_after  bigint;
begin
  if v_mult < 0 then raise exception 'multiplier cannot be negative' using errcode = '22023'; end if;
  if v_mult > 1000000 then raise exception 'multiplier out of range' using errcode = '22023'; end if;

  select * into v_round from rounds where id = p_round for update;
  if not found then raise exception 'no such round' using errcode = 'P0002'; end if;
  if v_round.status <> 'open' then raise exception 'round already settled' using errcode = '23505'; end if;

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
            jsonb_build_object('game', v_round.game, 'multiplier', v_mult, 'round', p_round));
  end if;

  return jsonb_build_object('payout', v_payout, 'balance', v_after, 'multiplier', v_mult);
end;
$$;

revoke all on function public.start_board_round(text, bigint, integer, integer) from public, anon;
grant execute on function public.start_board_round(text, bigint, integer, integer) to authenticated, service_role;

revoke all on function public.settle_board_round(bigint, numeric, text) from public, anon, authenticated;
grant execute on function public.settle_board_round(bigint, numeric, text) to service_role;
