-- ============================================================================
-- 0023 — Float: credit lent to a player, repaid from the gaming balance
-- ============================================================================
--
-- THE PRODUCT, AS ASKED FOR
--
--   * FloatBet lends a player money ("a float").
--   * It is NOT cash: it is credited straight to the gaming wallet and can only
--     be spent in the games.
--   * It is repaid in 3 instalments, all inside 24 hours.
--   * If it is not repaid in time, a 6% levy of what is left is charged every 24
--     hours.
--
-- WHAT THIS MIGRATION GUARANTEES
--
--   1. The player cannot choose their own limit. `float_offer()` derives it from
--      the account's own history on the server, and `request_float()` re-derives
--      it and refuses anything above it. A tampered browser can only ask for
--      less than it is allowed.
--   2. The money is real ledgered credit. It increases `balance_px` and writes a
--      `float_in` ledger row, so a deposit/withdrawal audit sees it.
--   3. It cannot be withdrawn. `request_cashout` is redefined below to hold back
--      anything still owed on a float, so borrowed money cannot leave the
--      platform as cash. That is the whole difference between a loan and a
--      giveaway.
--   4. One float at a time, and no new float while one is in arrears.
--   5. Every figure — instalments, levy, outstanding — is computed from stored
--      timestamps and amounts, never from a number the client sent.
-- ============================================================================

-- --------------------------------------------------------------- ledger kinds --
-- The ledger is append-only and its `kind` is how an auditor tells borrowed
-- money apart from a win. These are added to the enum rather than reusing
-- 'adjustment', because "we lent you this" must be visible on its own.
alter type ledger_kind add value if not exists 'float_in';
alter type ledger_kind add value if not exists 'float_out';
alter type ledger_kind add value if not exists 'float_fee';

-- ------------------------------------------------------------------ tables ----

create table if not exists floats (
  id            uuid primary key default uuid_generate_v4(),
  user_id       uuid not null references profiles(id) on delete cascade,
  -- what was lent
  principal     bigint not null check (principal > 0),
  -- principal + every levy charged so far
  owed          bigint not null check (owed >= 0),
  -- how much of `owed` has come back: instalments paid + `fee_paid`, and the two
  -- are kept in that exact relationship by every function below
  repaid        bigint not null default 0 check (repaid >= 0),
  -- the part of `repaid` that went to levies rather than to the principal
  fee_paid      bigint not null default 0 check (fee_paid >= 0),
  status        text not null default 'active'
                  check (status in ('active', 'settled', 'written_off')),
  -- the whole thing is due 24 hours after it is issued
  issued_at     timestamptz not null default now(),
  due_at        timestamptz not null,
  -- last day-number a levy was charged for, so a levy is charged once per day
  levy_charged_through int not null default 0,
  settled_at    timestamptz,
  created_at    timestamptz not null default now()
);

create index if not exists floats_user on floats (user_id, created_at desc);
-- One live float per player. A second one is a second loan against the same
-- balance, and nothing in the product asks for that.
create unique index if not exists floats_one_active
  on floats (user_id) where status = 'active';

create table if not exists float_installments (
  id         uuid primary key default uuid_generate_v4(),
  float_id   uuid not null references floats(id) on delete cascade,
  n          int not null check (n between 1 and 3),
  -- all three fall inside the 24-hour window: 8h, 16h, 24h
  due_at     timestamptz not null,
  amount     bigint not null check (amount >= 0),
  paid       bigint not null default 0 check (paid >= 0),
  created_at timestamptz not null default now(),
  unique (float_id, n)
);

alter table floats enable row level security;
alter table float_installments enable row level security;

drop policy if exists floats_read_own on floats;
create policy floats_read_own on floats for select using (auth.uid() = user_id);

drop policy if exists float_installments_read_own on float_installments;
create policy float_installments_read_own on float_installments for select
  using (exists (select 1 from floats f where f.id = float_id and f.user_id = auth.uid()));

-- No write policy on either: every change goes through a function below.

-- ---------------------------------------------------------------- constants ---

/** The levy, per day late, on the amount still owed. */
create or replace function float_levy_rate() returns numeric
language sql immutable as $$ select 0.06::numeric $$;

-- ------------------------------------------------------------------- offer ----
--
-- The limit is a ladder, read from the player's own record. The rungs are:
--
--   never deposited            2,000   (enough to play a session)
--   has deposited              5,000
--   deposited >= 50,000       15,000
-- and each is void while anything is in arrears, which is what keeps this from
-- becoming a loop: borrow, play, lose, borrow again.
create or replace function float_offer()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid     uuid := auth.uid();
  v_profile profiles;
  v_deposited bigint;
  v_limit   bigint := 0;
  v_reason  text;
  v_active  floats;
  v_arrears bigint := 0;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;

  select * into v_profile from profiles where id = v_uid;
  if not found then raise exception 'profile missing' using errcode = 'P0002'; end if;

  select coalesce(sum(amount), 0) into v_deposited
    from payment_orders
   where user_id = v_uid and direction = 'collect' and status = 'completed';

  select * into v_active from floats where user_id = v_uid and status = 'active';

  if v_active.id is not null then
    v_arrears := greatest(v_active.owed - v_active.repaid, 0)
                 + float_accrued_levy(v_active.id);
    return jsonb_build_object(
      'eligible', false,
      'limit', 0,
      'reason', 'You already have a float open. Clear it before borrowing again.',
      'active', to_jsonb(v_active),
      'outstanding', v_arrears
    );
  end if;

  if exists (select 1 from floats where user_id = v_uid and status = 'written_off') then
    return jsonb_build_object('eligible', false, 'limit', 0,
      'reason', 'A previous float was written off, so borrowing is closed on this account.');
  end if;

  if v_profile.suspended then
    return jsonb_build_object('eligible', false, 'limit', 0, 'reason', 'Account suspended.');
  end if;

  if not v_profile.age_confirmed then
    return jsonb_build_object('eligible', false, 'limit', 0,
      'reason', 'Confirm you are 18 or older before borrowing.');
  end if;

  if v_deposited >= 50000 then
    v_limit := 15000;
  elsif v_deposited > 0 then
    v_limit := 5000;
  else
    v_limit := 2000;
  end if;

  -- Instalments must be whole shillings and non-zero, so a limit under 300 is not
  -- an offer (3 x 100 is the floor the games can actually stake).
  if v_limit < 300 then
    v_limit := 0;
    v_reason := 'The games need at least 100 UGX a spin, so a float smaller than 300 is not useful.';
  end if;

  return jsonb_build_object(
    'eligible', v_limit > 0,
    'limit', v_limit,
    'reason', v_reason,
    'levy_rate', float_levy_rate(),
    'installments', 3,
    'window_hours', 24
  );
end $$;

revoke all on function float_offer() from public, anon;
grant execute on function float_offer() to authenticated, service_role;

-- ------------------------------------------------------- levy, per day late ---

/**
 * The levy owed on a float right now.
 *
 * 6% of what is still owed, charged the moment the 24 hours are up and again on
 * each 24 hours after that. So:
 *
 *   0 – 24h after issue        nothing         (the promised window)
 *   the instant the deadline passes               6% of what is left
 *   24h after the deadline                        6% more, on the new balance
 *
 * `ceil()` is what puts the first 6% at the deadline itself rather than a day
 * later, and the base is the CURRENT owed figure, so a second day's levy is
 * charged on the first day's levy too. Both are stated on the screen.
 *
 * It is NOT written here. `charge_float_levy()` writes it, once per day, and this
 * function only reports what would be charged so the UI can be honest before it
 * happens.
 */
create or replace function float_accrued_levy(p_float uuid)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_f    floats;
  v_days int;
  v_base bigint;
begin
  select * into v_f from floats where id = p_float;
  if not found or v_f.status <> 'active' then return 0; end if;
  if now() <= v_f.due_at then return 0; end if;

  -- Day 1 starts the moment the deadline passes; ceil() so a float one second
  -- late is already on day 1 rather than free until midnight.
  v_days := ceil(extract(epoch from (now() - v_f.due_at)) / 86400.0)::int;
  if v_days <= v_f.levy_charged_through then return 0; end if;

  v_base := greatest(v_f.owed - v_f.repaid, 0);
  if v_base = 0 then return 0; end if;

  return floor(v_base * float_levy_rate())::bigint * (v_days - v_f.levy_charged_through);
end $$;

revoke all on function float_accrued_levy(uuid) from public, anon;
grant execute on function float_accrued_levy(uuid) to authenticated, service_role;

/**
 * Post the levy for any whole day that has passed since the deadline. `owed`
 * grows, so the ledger and the balance of what is due always agree.
 */
create or replace function charge_float_levy(p_float uuid)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_f     floats;
  v_days  int;
  v_base  bigint;
  v_levy  bigint;
begin
  select * into v_f from floats where id = p_float for update;
  if not found or v_f.status <> 'active' then return 0; end if;
  if now() <= v_f.due_at then return 0; end if;

  v_days := ceil(extract(epoch from (now() - v_f.due_at)) / 86400.0)::int;
  if v_days <= v_f.levy_charged_through then return 0; end if;

  v_base := greatest(v_f.owed - v_f.repaid, 0);
  if v_base = 0 then
    update floats set levy_charged_through = v_days where id = p_float;
    return 0;
  end if;

  v_levy := floor(v_base * float_levy_rate())::bigint * (v_days - v_f.levy_charged_through);

  update floats
     set owed = owed + v_levy,
         levy_charged_through = v_days
   where id = p_float;

  insert into ledger (user_id, kind, delta_px, balance_after, ref, meta)
  select v_f.user_id, 'float_fee', 0,
         coalesce((select balance_px from wallets where user_id = v_f.user_id), 0),
         p_float::text,
         jsonb_build_object('float', p_float, 'days', v_days - v_f.levy_charged_through,
                            'rate', float_levy_rate(), 'levy', v_levy, 'kind', 'float_levy');

  return v_levy;
end $$;

revoke all on function charge_float_levy(uuid) from public, anon, authenticated;
grant execute on function charge_float_levy(uuid) to service_role;

-- ---------------------------------------------------------------- borrow ------

create or replace function request_float(p_amount bigint)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid    uuid := auth.uid();
  v_offer  jsonb;
  v_limit  bigint;
  v_balance bigint;
  v_after  bigint;
  v_float  floats;
  v_due    timestamptz := now() + interval '24 hours';
  -- 3 instalments inside 24h: 8h, 16h, 24h. Rounded so the three sum EXACTLY to
  -- the principal — a rounded-down split would leave a shilling nobody owes.
  v_first  bigint;
  v_second bigint;
  v_third  bigint;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;

  v_offer := float_offer();
  if not (v_offer->>'eligible')::boolean then
    raise exception '%', coalesce(v_offer->>'reason', 'not eligible for a float') using errcode = '42501';
  end if;

  v_limit := (v_offer->>'limit')::bigint;
  if p_amount is null or p_amount <= 0 then
    raise exception 'choose how much to borrow' using errcode = '22023';
  end if;
  if p_amount > v_limit then
    -- The limit is the server's. A client asking for more is refused, not clipped:
    -- silently lending a different amount than requested would be worse.
    raise exception 'your float limit is % UGX', v_limit using errcode = '22023';
  end if;
  if p_amount < 300 then
    raise exception 'the smallest float is 300 UGX' using errcode = '22023';
  end if;

  v_first := p_amount / 3;
  v_second := p_amount / 3;
  v_third := p_amount - v_first - v_second;

  insert into floats (user_id, principal, owed, due_at)
  values (v_uid, p_amount, p_amount, v_due)
  returning * into v_float;

  insert into float_installments (float_id, n, due_at, amount) values
    (v_float.id, 1, now() + interval '8 hours',  v_first),
    (v_float.id, 2, now() + interval '16 hours', v_second),
    (v_float.id, 3, v_due,                       v_third);

  -- The credit. It is the same wallet the games debit, so there is no separate
  -- "borrowed" pot that could be spent differently or withdrawn separately.
  select balance_px into v_balance from wallets where user_id = v_uid for update;
  if v_balance is null then raise exception 'wallet missing' using errcode = 'P0002'; end if;
  v_after := v_balance + p_amount;
  update wallets set balance_px = v_after where user_id = v_uid;

  insert into ledger (user_id, kind, delta_px, balance_after, ref, meta)
  values (v_uid, 'float_in', p_amount, v_after, v_float.id::text,
          jsonb_build_object('float', v_float.id, 'principal', p_amount, 'due_at', v_due,
                             'installments', 3, 'levy_rate', float_levy_rate()));

  return jsonb_build_object(
    'float', v_float.id,
    'principal', p_amount,
    'owed', p_amount,
    'balance', v_after,
    'due_at', v_due,
    'installments', (select coalesce(jsonb_agg(jsonb_build_object('n', n, 'due_at', due_at, 'amount', amount) order by n), '[]'::jsonb)
                       from float_installments where float_id = v_float.id)
  );
end $$;

revoke all on function request_float(bigint) from public, anon;
grant execute on function request_float(bigint) to authenticated, service_role;

-- ---------------------------------------------------------------- repay -------

/**
 * Repay from the gaming balance. Levies are settled first (they are the cost of
 * being late), then instalments in the order they fell due.
 */
create or replace function repay_float(p_amount bigint)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid       uuid := auth.uid();
  v_f         floats;
  v_balance   bigint;
  v_after     bigint;
  v_left      bigint;
  v_fee       bigint;   -- every levy charged on this float
  v_fee_left  bigint;   -- of which unpaid
  v_take      bigint;
  v_row       float_installments;
  v_status    text;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;

  select * into v_f from floats where user_id = v_uid and status = 'active' for update;
  if not found then raise exception 'you have no float open' using errcode = 'P0002'; end if;

  -- Post any levy that is due before taking a payment, so a repayment cannot
  -- dodge a charge by arriving after the day turned.
  perform charge_float_levy(v_f.id);
  select * into v_f from floats where id = v_f.id;

  if p_amount is null or p_amount <= 0 then
    raise exception 'enter an amount to repay' using errcode = '22023';
  end if;

  if p_amount > greatest(v_f.owed - v_f.repaid, 0) then
    raise exception 'you owe % UGX', greatest(v_f.owed - v_f.repaid, 0) using errcode = '22023';
  end if;

  select balance_px into v_balance from wallets where user_id = v_uid for update;
  if v_balance < p_amount then
    raise exception 'insufficient balance' using errcode = 'P0001';
  end if;

  v_after := v_balance - p_amount;
  update wallets set balance_px = v_after where user_id = v_uid;

  -- Levies are paid before the principal: they are the cost of being late, and a
  -- player clearing the principal while a levy is unpaid would be out of arrears
  -- on paper and not in fact.
  v_fee      := greatest(v_f.owed - v_f.principal, 0);
  v_fee_left := greatest(v_fee - v_f.fee_paid, 0);

  v_take := least(p_amount, v_fee_left);
  if v_take > 0 then
    update floats
       set fee_paid = fee_paid + v_take,
           repaid   = repaid + v_take
     where id = v_f.id;
  end if;
  v_left := p_amount - v_take;

  -- Then the instalments, oldest first.
  while v_left > 0 loop
    select * into v_row
      from float_installments
     where float_id = v_f.id and paid < amount
     order by n
     limit 1
     for update;
    exit when not found;

    v_take := least(v_left, v_row.amount - v_row.paid);

    update float_installments
       set paid = paid + v_take
     where id = v_row.id;

    update floats
       set repaid = repaid + v_take
     where id = v_f.id;

    v_left := v_left - v_take;
  end loop;

  select * into v_f from floats where id = v_f.id;
  v_status := case when v_f.repaid >= v_f.owed then 'settled' else 'active' end;

  if v_status = 'settled' then
    update floats set status = 'settled', settled_at = now() where id = v_f.id;
  end if;

  insert into ledger (user_id, kind, delta_px, balance_after, ref, meta)
  values (v_uid, 'float_out', -p_amount, v_after, v_f.id::text,
          jsonb_build_object('float', v_f.id, 'repaid', p_amount, 'status', v_status));

  return jsonb_build_object(
    'float', v_f.id,
    'paid', p_amount,
    'balance', v_after,
    'repaid', v_f.repaid,
    'owed', v_f.owed,
    'outstanding', greatest(v_f.owed - v_f.repaid, 0),
    'status', v_status
  );
end $$;

revoke all on function repay_float(bigint) from public, anon;
grant execute on function repay_float(bigint) to authenticated, service_role;

-- ------------------------------------------------------------- the state ------

/** Everything the credit screen needs, computed server-side. */
create or replace function float_state()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_f     floats;
  v_fee   bigint;
  v_owed  bigint;
  v_bal   bigint;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;

  select balance_px into v_bal from wallets where user_id = v_uid;
  select * into v_f from floats where user_id = v_uid and status = 'active';

  if v_f.id is null then
    return jsonb_build_object('open', false, 'balance', coalesce(v_bal, 0),
                              'offer', float_offer());
  end if;

  v_owed := greatest(v_f.owed - v_f.repaid, 0);
  v_fee  := float_accrued_levy(v_f.id);

  return jsonb_build_object(
    'open', true,
    'float', v_f.id,
    'principal', v_f.principal,
    'owed', v_f.owed,
    'repaid', v_f.repaid,
    'outstanding', v_owed,
    'levy_due', v_fee,
    'levy_rate', float_levy_rate(),
    'due_at', v_f.due_at,
    'overdue', now() > v_f.due_at,
    'balance', coalesce(v_bal, 0),
    'installments', (select coalesce(jsonb_agg(jsonb_build_object(
                        'n', n, 'due_at', due_at, 'amount', amount, 'paid', paid) order by n), '[]'::jsonb)
                       from float_installments where float_id = v_f.id)
  );
end $$;

revoke all on function float_state() from public, anon;
grant execute on function float_state() to authenticated, service_role;

-- ------------------------------------------- borrowed money cannot be withdrawn --

/**
 * `request_cashout`, with one extra gate: anything still owed on a float is held
 * back from what may leave the platform.
 *
 * Without this, a player could borrow the maximum, cash it straight out to a
 * mobile-money number, and the "loan" would be a gift. It is the same function
 * as 0017 otherwise — the 18+ gate is kept, the account-age and phone gates stay
 * removed, the row lock stays.
 */
create or replace function request_cashout(
  p_kind cashout_kind,
  p_amount_px bigint,
  p_phone text default null,
  p_rail text default null,
  p_asset text default null,
  p_address text default null
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_balance bigint;
  v_after bigint;
  v_ugx bigint;
  v_profile profiles;
  v_id uuid;
  v_float floats;
  v_owed bigint;
  v_spendable bigint;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;

  select * into v_profile from profiles where id = v_uid;
  if not found then raise exception 'profile missing' using errcode = 'P0002'; end if;
  if v_profile.suspended then raise exception 'account suspended' using errcode = '42501'; end if;

  if not v_profile.age_confirmed then
    raise exception 'confirm you are 18 or older before cashing out' using errcode = '42501';
  end if;

  if p_amount_px is null or p_amount_px <= 0 then
    raise exception 'amount must be positive' using errcode = '22023';
  end if;

  if p_kind = 'momo' and (p_phone is null or length(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g')) < 9) then
    raise exception 'a mobile money number is required for this payout' using errcode = '22023';
  end if;

  v_ugx := p_amount_px;
  if v_ugx < 1000 then
    raise exception 'minimum cashout is 1,000 UGX' using errcode = '22023';
  end if;

  select balance_px into v_balance from wallets where user_id = v_uid for update;
  if v_balance is null then raise exception 'wallet missing' using errcode = 'P0002'; end if;

  -- What is still owed on a float (principal, levies and today's accrual) may not
  -- be paid out. This is the loan's only real collateral.
  select * into v_float from floats where user_id = v_uid and status = 'active';
  v_owed := 0;
  if v_float.id is not null then
    v_owed := greatest(v_float.owed - v_float.repaid, 0) + float_accrued_levy(v_float.id);
  end if;
  v_spendable := greatest(v_balance - v_owed, 0);

  if p_amount_px > v_spendable then
    if v_owed > 0 then
      raise exception 'you have % UGX of float outstanding, so only % UGX can be withdrawn',
        v_owed, v_spendable using errcode = 'P0001';
    else
      raise exception 'insufficient balance' using errcode = 'P0001';
    end if;
  end if;

  v_after := v_balance - p_amount_px;
  update wallets set balance_px = v_after where user_id = v_uid;

  insert into cashouts (user_id, kind, amount_px, ugx, phone, rail, asset, address)
  values (v_uid, p_kind, p_amount_px, v_ugx, p_phone, p_rail, p_asset, p_address)
  returning id into v_id;

  insert into ledger (user_id, kind, delta_px, balance_after, ref, meta)
  values (v_uid, 'cashout_hold', -p_amount_px, v_after, v_id::text,
          jsonb_build_object('ugx', v_ugx, 'kind', p_kind));

  return v_id;
end $$;

revoke all on function request_cashout(cashout_kind, bigint, text, text, text, text) from public, anon;
grant execute on function request_cashout(cashout_kind, bigint, text, text, text, text) to authenticated, service_role;

comment on function request_cashout(cashout_kind, bigint, text, text, text, text) is
  'Requests a cashout. Requires 18+; money outstanding on a float cannot be withdrawn.';

-- ------------------------------------------------------------- operations -----

/**
 * Write off a float nobody is going to repay. service_role only: this is an
 * operator decision, and it closes borrowing on the account.
 */
create or replace function write_off_float(p_float uuid, p_reason text default null)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_f floats;
begin
  select * into v_f from floats where id = p_float for update;
  if not found or v_f.status <> 'active' then return false; end if;

  -- Writing off means the debt stops existing: a written-off float must not keep
  -- blocking the player's withdrawals forever.
  update floats
     set status = 'written_off',
         owed = repaid,
         settled_at = now()
   where id = p_float;

  insert into ledger (user_id, kind, delta_px, balance_after, ref, meta)
  select v_f.user_id, 'adjustment', 0,
         coalesce((select balance_px from wallets where user_id = v_f.user_id), 0),
         p_float::text,
         jsonb_build_object('kind', 'float_write_off', 'float', p_float, 'reason', p_reason);

  return true;
end $$;

revoke all on function write_off_float(uuid, text) from public, anon, authenticated;
grant execute on function write_off_float(uuid, text) to service_role;

-- The levy only grows with the clock, so it is posted by the scheduler (or by any
-- later float call) rather than by a browser. This posts it for every overdue
-- float at once and is safe to call as often as you like.
create or replace function charge_all_float_levies()
returns int
language plpgsql security definer set search_path = public as $$
declare
  r record;
  n int := 0;
begin
  for r in select id from floats where status = 'active' and now() > due_at loop
    if charge_float_levy(r.id) > 0 then n := n + 1; end if;
  end loop;
  return n;
end $$;

revoke all on function charge_all_float_levies() from public, anon, authenticated;
grant execute on function charge_all_float_levies() to service_role;

comment on table floats is
  'Money lent to a player, credited to their gaming wallet, repaid in 3 instalments inside 24h; 6% per day thereafter.';
