-- ============================================================================
-- 0017 — the cashout gates, as the business wants them
-- ============================================================================
--
-- Two changes, requested explicitly:
--
--   1. no 7-day account-age wait before a cashout
--   2. no phone-verification requirement before a cashout
--
-- Both live only in this function, so this is the whole change. The 18+ gate
-- (`age_confirmed`) is deliberately KEPT: it was not part of the request, and an
-- unconfirmed-minor payout is a legal problem rather than a friction problem.
--
-- WHAT IS STILL ENFORCED
--
--   * the account exists and is not suspended
--   * the player confirmed they are 18 or older
--   * the amount is positive, is at least UGX 1,000, and is covered by the
--     balance, all read under a row lock so two tabs cannot overdraw
--   * the debit and the cashout row are written together
--
-- WHAT IS NOT HERE ANY MORE, AND WHY IT MATTERS
--
-- The age gate was the only thing slowing a fresh account from draining a
-- balance. With it gone, an account can deposit and withdraw in the same
-- session. That is the requested behaviour; the protection it provided does not
-- disappear, it moves to the network: the payout only reaches a phone the payer
-- nominates, and ZENGAPAY transfers require IP whitelisting on our side.
--
-- The phone-verification gate was never actually a check that the payout phone
-- belonged to the account — the nominated number is a free-text field. Removing
-- it costs less than it appears to, but it also removes the one place that would
-- have caught a mismatch, so the payout number is now the single source of truth
-- and is shown back to the player before they confirm.
-- ============================================================================

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
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;

  select * into v_profile from profiles where id = v_uid;
  if not found then raise exception 'profile missing' using errcode = 'P0002'; end if;
  if v_profile.suspended then raise exception 'account suspended' using errcode = '42501'; end if;

  -- 18+. Kept deliberately: not part of the change that removed the wait, and an
  -- unconfirmed minor must not be paid out.
  if not v_profile.age_confirmed then
    raise exception 'confirm you are 18 or older before cashing out' using errcode = '42501';
  end if;

  -- REMOVED: the 7-day account-age gate.
  -- REMOVED: the phone_verified gate.

  if p_amount_px is null or p_amount_px <= 0 then
    raise exception 'amount must be positive' using errcode = '22023';
  end if;

  -- A mobile-money payout with no number is a request nobody can pay. This is a
  -- shape check on the request, not a verification of the owner.
  if p_kind = 'momo' and (p_phone is null or length(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g')) < 9) then
    raise exception 'a mobile money number is required for this payout' using errcode = '22023';
  end if;

  -- One currency: the amount asked for is the amount paid.
  v_ugx := p_amount_px;
  if v_ugx < 1000 then
    raise exception 'minimum cashout is 1,000 UGX' using errcode = '22023';
  end if;

  select balance_px into v_balance from wallets where user_id = v_uid for update;
  if v_balance is null then raise exception 'wallet missing' using errcode = 'P0002'; end if;
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
          jsonb_build_object('ugx', v_ugx, 'kind', p_kind));

  return v_id;
end $$;

-- Grants as measured on the live database: authenticated and service_role only.
-- `anon` must not be able to call this, and neither should PUBLIC.
revoke all on function request_cashout(cashout_kind, bigint, text, text, text, text) from public, anon;
grant execute on function request_cashout(cashout_kind, bigint, text, text, text, text) to authenticated, service_role;

comment on function request_cashout(cashout_kind, bigint, text, text, text, text) is
  'Requests a cashout. Requires 18+ confirmation; no account-age wait and no phone verification, by request.';
