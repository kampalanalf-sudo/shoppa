-- 0009_px_daily_grant_and_peg.sql
-- ============================================================================
-- PX becomes the in-house currency, and UGX becomes the money it converts to.
--
-- Three changes, ordered by how much damage they do if wrong:
--
--   1. The peg moves from 10 PX/UGX to 100 PX/UGX. Existing balances keep
--      their PX and therefore lose 90% of their UGX value. That was an
--      explicit decision, taken when the platform held 9 wallets and 91,500 PX
--      in total -- i.e. test data. On a live book this migration would need a
--      balance-adjusting step first; it deliberately does not have one, because
--      silently multiplying balances is a worse default than making the
--      decision visible.
--   2. 15,000 PX once per calendar day, credited on login.
--   3. Only accounts at least 7 days old may convert PX to UGX.
--
-- The ordering matters: once PX is *given away* daily, the conversion gate is
-- the only thing standing between a script and free money. A new account can
-- collect 15,000 PX on day one and every day after; without the 7-day rule it
-- could cash out on day one, which makes the daily grant a payout scheme.
-- ============================================================================

-- ------------------------------------------------------------ daily claim ----
-- One row per player per day. The primary key *is* the rule: a second attempt
-- on the same day conflicts and awards nothing, so the UI cannot be spammed and
-- a retried request cannot double-pay.
create table if not exists px_claims (
  user_id       uuid not null references profiles(id) on delete cascade,
  claim_date    date not null,
  amount_px     bigint not null check (amount_px > 0),
  balance_after bigint not null,
  created_at    timestamptz not null default now(),
  primary key (user_id, claim_date)
);

create or replace function claim_daily_px(p_amount bigint default 15000)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  -- Kampala, not UTC. A player claiming at 01:00 local must not be told they
  -- have to wait until 03:00 because the server's day starts at midnight UTC.
  v_today date := (now() at time zone 'Africa/Kampala')::date;
  v_amount bigint := coalesce(p_amount, 15000);
  v_after bigint;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  -- A caller may not name their own reward.
  if v_amount <> 15000 then raise exception 'reward is fixed' using errcode = '22023'; end if;
  if exists (select 1 from profiles where id = v_uid and suspended) then
    raise exception 'account suspended' using errcode = '42501';
  end if;

  insert into px_claims (user_id, claim_date, amount_px, balance_after)
  values (v_uid, v_today, v_amount, 0)
  on conflict (user_id, claim_date) do nothing;

  if not found then
    raise exception 'already claimed today' using errcode = '23505';
  end if;

  update wallets set balance_px = balance_px + v_amount, updated_at = now()
   where user_id = v_uid
  returning balance_px into v_after;

  if v_after is null then raise exception 'wallet missing' using errcode = 'P0002'; end if;

  update px_claims set balance_after = v_after
   where user_id = v_uid and claim_date = v_today;

  insert into ledger (user_id, kind, delta_px, balance_after, ref, meta)
  values (v_uid, 'grant', v_amount, v_after, 'daily_px',
          jsonb_build_object('date', v_today));

  return v_after;
end $$;

-- ------------------------------------------------------- conversion gate -----
-- Same function as 0001, with the peg corrected and an age gate added ahead of
-- the balance lock. This is the only place PX becomes UGX, so it is the only
-- place the rule needs to be enforced -- the client asking nicely is not a
-- control.
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
  v_age_days integer;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;

  select * into v_profile from profiles where id = v_uid;
  if v_profile.suspended then raise exception 'account suspended' using errcode = '42501'; end if;
  if not v_profile.age_confirmed then
    raise exception 'confirm you are 18 or older before cashing out' using errcode = '42501';
  end if;
  if not v_profile.phone_verified then
    raise exception 'verify a phone number before cashing out' using errcode = '42501';
  end if;

  -- The 7-day rule: an account must have *spent* a week on the platform before
  -- it can turn PX into money. Measured from profiles.created_at, so it cannot
  -- be reset by logging out, changing a phone number, or anything else a
  -- player (or a script) controls.
  v_age_days := floor(extract(epoch from (now() - v_profile.created_at)) / 86400)::integer;
  if v_age_days < 7 then
    raise exception 'your account must be 7 days old before converting PX to UGX (you are on day %)',
      v_age_days + 1 using errcode = '42501';
  end if;

  if p_amount_px is null or p_amount_px <= 0 then
    raise exception 'amount must be positive' using errcode = '22023';
  end if;

  -- 100 PX = 1 UGX, rounded down in the house's favour by a whole shilling.
  v_ugx := floor(p_amount_px / 100.0)::bigint;
  if v_ugx < 1000 then
    raise exception 'minimum cashout is 100,000 PX (1,000 UGX)' using errcode = '22023';
  end if;

  select balance_px into v_balance from wallets where user_id = v_uid for update;
  if v_balance < p_amount_px then
    raise exception 'insufficient balance' using errcode = 'P0001';
  end if;

  v_after := v_balance - p_amount_px;
  update wallets set balance_px = v_after where user_id = v_uid;

  insert into cashouts (user_id, kind, amount_px, ugx, phone, rail, asset, address)
  values (v_uid, p_kind, p_amount_px, v_ugx, p_phone, p_rail, p_asset, p_address)
  returning id into v_id;

  insert into ledger (user_id, kind, delta_px, balance_after, ref, meta)
  values (v_uid, 'cashout_hold', -p_amount_px, v_after, v_id::text,
          jsonb_build_object('ugx', v_ugx, 'kind', p_kind, 'peg', 100));

  return v_id;
end $$;

-- A player may see their own claim history and nothing else. Without this the
-- table would be readable through PostgREST by arbitrary users.
alter table px_claims enable row level security;
drop policy if exists px_claims_read_own on px_claims;
create policy px_claims_read_own on px_claims
  for select using (auth.uid() = user_id);

revoke all on function claim_daily_px(bigint) from public, anon;
grant execute on function claim_daily_px(bigint) to authenticated;
