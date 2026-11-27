-- 0014_ugx_only_and_free_play.sql
-- ============================================================================
-- PX is deleted. The balance IS shillings.
--
-- WHAT WAS WRONG
--
-- The platform moved to 100 PX = 1 UGX in 0009 -- the peg the UI has been
-- showing ("100 PX = 1 UGX", "≈ UGX 150 daily bonus") ever since. But the
-- functions that actually move money were never updated:
--
--   0002  apply_gateway_result      credited  amount * 10   (a real UGX 1,000
--                                   top-up granted 10,000 PX, not 100,000)
--   0001  request_cashout           divided by 10 for the UGX sent to MoMo,
--                                   so a player asking to cash out 10,000 PX
--                                   was paid UGX 1,000 instead of UGX 100
--   0003  apply_store_topup         credited  amount * 10
--
-- Every one of those is a 10x error on real money, in both directions. Deleting
-- the conversion removes the whole class of bug: with one currency there is
-- nothing to convert, and therefore nothing to get wrong.
--
-- WHAT HAPPENS TO EXISTING BALANCES
--
-- At the peg the UI advertised (100 PX = 1 UGX), `balance_px` maps straight to
-- shillings by dividing by 100. A player who saw "100,000 PX · ≈ UGX 1,000"
-- keeps exactly UGX 1,000. That is the only defensible rate: it is the one the
-- platform told them their balance was worth.
--
-- The column keeps its name. Renaming it would need every function, RLS policy
-- and admin query to change in the same commit; the number in it is now
-- shillings and this comment is the record of that. (The UI reads it as UGX.)
--
-- FREE PLAY
--
-- Free play is client-side only, by design. It has its own wallet object in
-- localStorage, cannot be topped up, and cannot be cashed out -- so there is
-- nothing for the server to hold. A free-play balance never touches this
-- database, which is the strongest possible guarantee that a practice win can
-- never become a withdrawal.
-- ============================================================================

-- ------------------------------------------------------------ the daily bonus --
-- 15,000 PX was UGX 150 at the peg. Now that UGX is the only unit, the grant is
-- stated in shillings. The function keeps its old name because it is granted to
-- `authenticated` by name in 0005; changing the name here would silently drop
-- that grant and lock every player out of their bonus.
create or replace function claim_daily_px(p_amount bigint default 15000)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_today date := (now() at time zone 'Africa/Kampala')::date;
  -- The reward is still 15,000 units. What changed is what a unit is: this
  -- used to be 15,000 PX (UGX 150) and is now UGX 15,000, because a UGX 150
  -- daily bonus is not a reason to open the app.
  v_amount bigint := coalesce(p_amount, 15000);
  v_after bigint;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if v_amount <> 15000 then raise exception 'reward is fixed' using errcode = '22023'; end if;
  if exists (select 1 from profiles where id = v_uid and suspended) then
    raise exception 'account suspended' using errcode = '42501';
  end if;

  insert into px_claims (user_id, claim_date, amount_px, balance_after)
  values (v_uid, v_today, v_amount, 0)
  on conflict (user_id, claim_date) do nothing;

  -- Nothing inserted => already claimed today. Award nothing.
  if not found then return 0; end if;

  update wallets set balance_px = balance_px + v_amount
   where user_id = v_uid
   returning balance_px into v_after;

  update px_claims set balance_after = v_after
   where user_id = v_uid and claim_date = v_today;

  insert into ledger (user_id, kind, delta_px, balance_after, ref, meta)
  values (v_uid, 'adjustment', v_amount, v_after, 'daily-bonus-' || v_today,
          jsonb_build_object('kind', 'daily_bonus', 'currency', 'UGX'));

  return v_amount;
end $$;

revoke all on function claim_daily_px(bigint) from public, anon;
grant execute on function claim_daily_px(bigint) to authenticated;

-- ------------------------------------------------------- top-ups: no conversion --
-- A UGX top-up credits its own amount. Full stop.
create or replace function apply_gateway_result(
  p_reference text,
  p_status payment_status,
  p_provider_ref text default null,
  p_failure_reason text default null
)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_order payment_orders;
  v_credit bigint;
  v_after bigint;
begin
  select * into v_order from payment_orders where reference = p_reference for update;
  if not found then raise exception 'unknown reference' using errcode = 'P0002'; end if;

  if v_order.status in ('completed', 'failed') then return; end if;

  update payment_orders
     set status = p_status,
         provider_ref = coalesce(p_provider_ref, provider_ref),
         failure_reason = case when p_status = 'failed' then p_failure_reason else failure_reason end,
         settled_at = now()
   where id = v_order.id;

  if v_order.direction = 'collect' and p_status = 'completed' then
    /*
     * One currency: what was paid is what is credited.
     *
     * No multiplier, no peg, no rounding. The old `amount * 10` was the bug this
     * migration exists to remove -- it paid a tenth of every top-up.
     */
    v_credit := v_order.amount;

    select balance_px into v_after from wallets where user_id = v_order.user_id for update;
    if v_after is null then raise exception 'wallet missing' using errcode = 'P0002'; end if;
    v_after := v_after + v_credit;
    update wallets set balance_px = v_after where user_id = v_order.user_id;

    insert into ledger (user_id, kind, delta_px, balance_after, ref, meta)
    values (v_order.user_id, 'adjustment', v_credit, v_after, v_order.order_id,
            jsonb_build_object('kind', 'deposit', 'currency', v_order.currency, 'amount', v_order.amount));

  elsif v_order.direction = 'disburse' and v_order.cashout_id is not null then
    if p_status = 'completed' then
      perform settle_cashout(v_order.cashout_id, 'paid'::cashout_status, null);
    else
      perform settle_cashout(v_order.cashout_id, 'failed'::cashout_status,
                              coalesce(p_failure_reason, 'provider reported failure'));
    end if;
  end if;
end $$;

revoke all on function apply_gateway_result(text, payment_status, text, text) from public, anon, authenticated;
grant execute on function apply_gateway_result(text, payment_status, text, text) to service_role;

-- ---------------------------------------------------- cashouts: amount is UGX --
-- Retained from 0009 except for the conversion. The 7-day account-age gate is
-- kept deliberately: it is the rule that stops a fresh script from cashing out,
-- and nothing about removing PX makes it less necessary.
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

  /*
   * The amount IS the shilling figure.
   *
   * There is nothing to convert, so the number the player asked to cash out is
   * exactly the number sent to their mobile money wallet. The old `/ 100.0`
   * was right while PX existed and became a silent 100x haircut the moment the
   * UI started labelling the balance in UGX.
   */
  v_ugx := p_amount_px;
  if v_ugx < 1000 then
    raise exception 'minimum cashout is UGX 1,000' using errcode = '22023';
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
          jsonb_build_object('ugx', v_ugx, 'kind', p_kind, 'currency', 'UGX'));

  return v_id;
end $$;

-- ------------------------------------------------- store top-ups: same rule ----
-- The hosted-store rail is retained verbatim from 0003 except for the peg line.
-- Re-declaring the whole function here is deliberate: a `create or replace` in a
-- later migration must match the earlier signature exactly, and a partial edit
-- would leave two overloads that both look callable.
create or replace function apply_store_topup(
  p_reference    text,
  p_status       text,
  p_amount       bigint,
  p_currency     text,
  p_quantity     int,
  p_product_id   text,
  p_product_slug text,
  p_store_slug   text,
  p_buyer_name   text,
  p_buyer_email  text,
  p_buyer_phone  text,
  p_provider     text,
  p_provider_ref text,
  p_failure      text
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_row    store_topups;
  v_uid    uuid;
  v_email  text := lower(coalesce(p_buyer_email, ''));
  v_matches int;
  v_px     bigint;
  v_after  bigint;
  v_reason text;
begin
  -- idempotent: a repeated reference must never credit twice
  select * into v_row from store_topups where reference = p_reference for update;
  if found and v_row.status in ('completed', 'failed') then
    return jsonb_build_object('ok', true, 'replay', true, 'status', v_row.status);
  end if;

  -- exactly one account for this checkout email, or we do not credit
  if v_email <> '' then
    select count(*) into v_matches from auth.users where lower(email) = v_email;
  else
    v_matches := 0;
  end if;

  if p_status = 'completed' and v_matches = 1 then
    select id into v_uid from auth.users where lower(email) = v_email limit 1;
  elsif p_status = 'completed' then
    v_reason := case
      when v_email = ''            then 'no_checkout_email'
      when v_matches = 0           then 'email_not_registered'
      else                              'email_ambiguous'
    end;
  end if;

  insert into store_topups (
    reference, status, amount, currency, quantity, product_id, product_slug,
    store_slug, buyer_name, buyer_email, buyer_phone, provider, provider_ref,
    failure_reason, matched_by, user_id, parked_reason, settled_at
  ) values (
    p_reference,
    -- a parked completed payment is never left as 'completed' until it is credited
    case when p_status = 'completed' and v_uid is null then 'pending' else p_status end,
    p_amount, upper(coalesce(p_currency, 'UGX')), greatest(coalesce(p_quantity, 1), 1),
    p_product_id, lower(coalesce(p_product_slug, '')), p_store_slug,
    p_buyer_name, nullif(v_email, ''), p_buyer_phone, p_provider, p_provider_ref,
    case when p_status = 'failed' then p_failure else null end,
    case when v_uid is not null then 'auto' end,
    v_uid, v_reason,
    case when p_status <> 'pending' then now() end
  )
  on conflict (reference) do update
    set status = excluded.status,
        provider_ref = coalesce(excluded.provider_ref, store_topups.provider_ref),
        failure_reason = coalesce(excluded.failure_reason, store_topups.failure_reason),
        settled_at = excluded.settled_at
    returning * into v_row;

  if v_uid is null or v_row.status <> 'completed' then
    return jsonb_build_object(
      'ok', true, 'credited', false, 'status', v_row.status,
      'parked_reason', v_reason, 'store_topup_id', v_row.id
    );
  end if;

  /*
   * One currency: the price paid is the amount credited.
   *
   * `p_amount * 10` was the PX peg that the UI stopped using in 0009, so every
   * hosted-store top-up has been crediting a tenth of what the buyer paid.
   * Quantity still multiplies, because quantity is not a currency.
   */
  v_px := p_amount * greatest(coalesce(p_quantity, 1), 1);

  select balance_px into v_after from wallets where user_id = v_uid for update;
  if v_after is null then
    raise exception 'wallet missing for checkout email' using errcode = 'P0002';
  end if;
  v_after := v_after + v_px;
  update wallets set balance_px = v_after where user_id = v_uid;

  insert into ledger (user_id, kind, delta_px, balance_after, ref, meta)
  values (v_uid, 'adjustment', v_px, v_after, p_reference,
          jsonb_build_object(
            'kind', 'store_deposit', 'channel', 'hosted_store',
            'product_slug', p_product_slug, 'quantity', p_quantity,
            'currency', upper(coalesce(p_currency, 'UGX')), 'amount', p_amount));

  return jsonb_build_object(
    'ok', true, 'credited', true, 'px', v_px, 'balance', v_after,
    'store_topup_id', v_row.id
  );
end $$;

-- ------------------------------------------- admin release: same rule ----
create or replace function admin_release_store_topup(
  p_reference text,
  p_user_id   uuid,
  p_admin_id  uuid
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_row   store_topups;
  v_px    bigint;
  v_after bigint;
begin
  if p_user_id is null then raise exception 'user is required' using errcode = 'P0001'; end if;
  if p_admin_id is null then raise exception 'admin is required' using errcode = 'P0001'; end if;

  select * into v_row from store_topups where reference = p_reference for update;
  if not found then raise exception 'unknown reference' using errcode = 'P0002'; end if;

  if v_row.status = 'completed' then
    raise exception 'this top-up has already been credited' using errcode = 'P0001';
  end if;
  if v_row.status = 'failed' then
    raise exception 'failed payments cannot be released' using errcode = 'P0001';
  end if;
  if v_row.settled_at is null then
    -- DGateway has not confirmed it yet; releasing now would credit a payment
    -- that may still fail.
    raise exception 'this payment is still pending at the gateway' using errcode = 'P0001';
  end if;

  /*
   * The admin release is the escape hatch for a parked payment, so it must
   * credit exactly what apply_store_topup would have credited. Leaving the 10x
   * peg here would mean a payment credited by a human paid ten times one
   * credited by the webhook.
   */
  v_px := v_row.amount * v_row.quantity;

  update store_topups
     set status = 'completed', user_id = p_user_id, matched_by = 'admin',
         released_by = p_admin_id, claimed_at = now(), parked_reason = null
   where id = v_row.id;

  select balance_px into v_after from wallets where user_id = p_user_id for update;
  if v_after is null then raise exception 'wallet missing for that user' using errcode = 'P0002'; end if;
  v_after := v_after + v_px;
  update wallets set balance_px = v_after where user_id = p_user_id;

  insert into ledger (user_id, kind, delta_px, balance_after, ref, meta)
  values (p_user_id, 'adjustment', v_px, v_after, p_reference,
          jsonb_build_object('kind', 'store_deposit', 'channel', 'admin_release',
                             'admin_id', p_admin_id, 'product_slug', v_row.product_slug,
                             'quantity', v_row.quantity));

  insert into store_topup_actions (reference, action, admin_id, user_id, px)
  values (p_reference, 'release', p_admin_id, p_user_id, v_px);

  return jsonb_build_object('ok', true, 'credited', true, 'px', v_px, 'balance', v_after);
end $$;

-- ------------------------------------------------------------- comments ------
comment on column wallets.balance_px is
  'The player''s balance in whole Ugandan Shillings. The column kept its PX-era name; there is no peg and no coin.';
comment on column wallets.wagered_px is 'Lifetime stake, whole UGX.';
comment on column wallets.won_px is 'Lifetime winnings, whole UGX.';
comment on column wallets.cashed_out_px is 'Lifetime cashout, whole UGX.';
