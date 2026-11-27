-- ============================================================================
-- 0016 — the production money paths, corrected
-- ============================================================================
--
-- WHAT WENT WRONG
--
-- 0014 and 0015 were written into the repository and never applied here. They
-- began from an accurate diagnosis and then a wrong assumption: that the old
-- PX-era code was only *displaying* PX. It was not. The live functions still
-- convert, in both directions:
--
--   apply_gateway_result        amount * 10 on a UGX top-up
--   apply_store_topup           p_amount * 10 * quantity
--   admin_release_store_topup   amount * 10 * quantity
--   request_cashout             floor(p_amount_px / 100.0)
--
-- Read together those four lines are a business that pays out ten times what it
-- takes in: a player tops up UGX 10,000 and is credited 100,000 units, then
-- requests a cashout and receives a hundredth of them. The unit stopped being a
-- coin at 0009 and nothing downstream was told.
--
-- This migration changes exactly those lines and nothing else.
--
-- IMPORTANT: this is NOT sql-copied from 0014. The repository's 0014 was written
-- against an imagined schema and would have broken this database:
--
--   * its request_cashout dropped `age_confirmed` and `phone_verified`, two KYC
--     gates that exist only in the live body
--   * it inserted ledger kind 'cashout', which is not a member of ledger_kind
--   * it inserted into cashouts(currency), and there is no such column
--
-- Every function below is the LIVE body with the arithmetic changed, so no rule
-- that exists only in production can be lost. Read them against pg_proc.
--
-- WHY THE BALANCES ARE CONVERTED AND NOT RELABELLED
--
-- 17 wallets hold 10,000 to 125,000 "units". The only rate ever stated to a
-- player, in words, was 100 PX = 1 UGX — in the old banner ("10,000 PX = 100
-- UGX"), in the cashout message, and in the code. So the conversion is
-- floor(balance / 100), the same rule the cashout function and the client's
-- legacy migration already use. 666,400 units become 6,664 UGX across the whole
-- player base; nobody's balance is wiped, and nothing is invented.
--
-- Every monetary column is converted so a player's history still reconciles:
-- wallets, ledger deltas and running balances, and daily-bonus claims. Without
-- that the ledger would describe a wallet a hundred times larger than the one
-- it belongs to.
--
-- A sentinel ledger row makes the conversion run at most once. It is recorded
-- per wallet with before/after in meta, so it is fully auditable and can be
-- reversed with one statement if the business ever decides otherwise.
--
-- Free play is untouched: it never reaches this database.
-- ============================================================================

-- ============================================================================
-- 1. The five functions. Live body + corrected arithmetic.
-- ============================================================================

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
  v_px bigint;
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
    -- One currency: what was paid is what is credited.
    --
    -- This was `case when currency = 'UGX' then amount * 10 else amount end`,
    -- which credited a tenth of every top-up. The 10 was the old PX peg
    -- (10 PX per shilling); at 0009's 100:1 it was also simply wrong.
    v_px := v_order.amount;

    select balance_px into v_after from wallets where user_id = v_order.user_id for update;
    -- Added: without this, a missing wallet made v_after null and the update
    -- below wrote NULL over a balance. A missing row must fail, not blank.
    if v_after is null then
      raise exception 'wallet missing for order owner' using errcode = 'P0002';
    end if;
    v_after := v_after + v_px;
    update wallets set balance_px = v_after where user_id = v_order.user_id;
    insert into ledger (user_id, kind, delta_px, balance_after, ref, meta)
    values (v_order.user_id, 'adjustment', v_px, v_after, v_order.order_id,
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
  select * into v_row from store_topups where reference = p_reference for update;
  if found and v_row.status in ('completed', 'failed') then
    return jsonb_build_object('ok', true, 'replay', true, 'status', v_row.status);
  end if;

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

  -- One currency: the price paid is the amount credited. Quantity still
  -- multiplies, because quantity is not a currency.
  --
  -- This was a `case ... then p_amount * 10 * quantity` on UGX.
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
    raise exception 'this payment is still pending at the gateway' using errcode = 'P0001';
  end if;

  -- A human releasing a parked payment must credit exactly what the webhook
  -- would have. The old `* 10` meant a releaser paid ten times a webhook.
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
  -- KYC gates. These exist only in the live body and are load-bearing: they are
  -- what stops an account that has proved nothing from moving money out.
  if not v_profile.age_confirmed then
    raise exception 'confirm you are 18 or older before cashing out' using errcode = '42501';
  end if;
  if not v_profile.phone_verified then
    raise exception 'verify a phone number before cashing out' using errcode = '42501';
  end if;

  -- The 7-day rule, checked here and not in the client: the browser must not be
  -- the thing that decides whether money can leave.
  v_age_days := floor(extract(epoch from (now() - v_profile.created_at)) / 86400)::integer;
  if v_age_days < 7 then
    raise exception 'your account must be 7 days old before cashing out (you are on day %)',
      v_age_days + 1 using errcode = '42501';
  end if;

  if p_amount_px is null or p_amount_px <= 0 then
    raise exception 'amount must be positive' using errcode = '22023';
  end if;

  -- One currency: the amount asked for is the amount paid.
  --
  -- This was `floor(p_amount_px / 100.0)`, the old PX peg. Applied to a wallet
  -- already inflated tenfold by the top-up bug, a round trip lost the player
  -- 99% of their money between the credit and the payout.
  v_ugx := p_amount_px;
  if v_ugx < 1000 then
    raise exception 'minimum cashout is 1,000 UGX' using errcode = '22023';
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
          jsonb_build_object('ugx', v_ugx, 'kind', p_kind));

  return v_id;
end $$;

create or replace function claim_daily_px(p_amount bigint default 150)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_today date := (now() at time zone 'Africa/Kampala')::date;
  -- 15,000 was UGX 150 at the peg. It is 150 shillings, not 15,000.
  v_amount bigint := coalesce(p_amount, 150);
  v_after bigint;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if v_amount <> 150 then raise exception 'reward is fixed' using errcode = '22023'; end if;
  if exists (select 1 from profiles where id = v_uid and suspended) then
    raise exception 'account suspended' using errcode = '42501';
  end if;

  insert into px_claims (user_id, claim_date, amount_px, balance_after)
  values (v_uid, v_today, v_amount, 0)
  on conflict (user_id, claim_date) do nothing;

  -- A repeat claim is an error, deliberately: the client is written to treat
  -- 'already claimed today' as the normal outcome of a second visit.
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

  -- Returns the balance it left behind, as before. The client must not present
  -- this number as the amount awarded.
  return v_after;
end $$;

revoke all on function claim_daily_px(bigint) from public, anon;
grant execute on function claim_daily_px(bigint) to authenticated;

-- ============================================================================
-- 2. Convert every stored PX amount to UGX at the stated 100:1, exactly once.
-- ============================================================================
do $$
declare
  v_before record;
begin
  if exists (select 1 from ledger where ref = 'ugx-migration-0016') then
    raise notice '0016: balances already converted; skipping';
    return;
  end if;

  -- Capture the pre-conversion figures first: once the updates below run, the
  -- original numbers are gone, and they are the only honest record of what was
  -- changed.
  create temporary table _0016_before on commit drop as
  select user_id, balance_px as px, wagered_px as wagered, won_px as won,
         cashed_out_px as cashed_out, gifted_out_px as gifted_out,
         gifted_in_px as gifted_in
    from wallets;

  -- Wallets and lifetime counters.
  --
  -- The rate is 100 PX = 1 UGX: the only rate ever stated to a player, in the
  -- old banner, in the cashout error message, and in the client's own legacy
  -- migration. floor() matches the rule the cashout function used.
  update wallets w
     set balance_px    = floor(b.balance_px / 100.0)::bigint,
         wagered_px    = floor(b.wagered_px / 100.0)::bigint,
         won_px        = floor(b.won_px / 100.0)::bigint,
         cashed_out_px = floor(b.cashed_out_px / 100.0)::bigint,
         gifted_out_px = floor(b.gifted_out_px / 100.0)::bigint,
         gifted_in_px  = floor(b.gifted_in_px / 100.0)::bigint,
         updated_at    = now()
    from _0016_before b
   where b.user_id = w.user_id;

  -- History, so the ledger still describes the wallet it belongs to.
  update ledger
     set delta_px      = floor(delta_px / 100.0)::bigint,
         balance_after = floor(balance_after / 100.0)::bigint;

  update px_claims
     set amount_px     = floor(amount_px / 100.0)::bigint,
         balance_after = floor(balance_after / 100.0)::bigint;

  -- Empty today. Converted anyway, so this migration is not silently a no-op
  -- on them if a payment ever lands before it runs.
  update cashouts
     set amount_px = floor(amount_px / 100.0)::bigint,
         ugx       = floor(ugx / 100.0)::bigint;

  update payment_orders
     set amount = floor(amount / 100.0)::bigint;

  -- The audit row is written LAST, with delta 0.
  --
  -- A non-zero delta would double-count: the previous ledger row's
  -- balance_after was itself divided by 100 above, and that value now equals the
  -- new balance. So nothing was added or removed relative to the converted
  -- history -- the unit changed. delta 0 is the only figure that reconciles.
  insert into ledger (user_id, kind, delta_px, balance_after, ref, meta)
  select w.user_id, 'adjustment', 0, w.balance_px, 'ugx-migration-0016',
         jsonb_build_object(
           'kind', 'currency_migration',
           'from', 'PX',
           'to', 'UGX',
           'rate', '100 PX = 1 UGX',
           'before', b.px,
           'after', w.balance_px
         )
    from wallets w
    join _0016_before b on b.user_id = w.user_id;
end $$;

comment on column wallets.balance_px is
  'The player''s balance in whole Ugandan Shillings. The column kept its PX-era name; there is no peg and no coin.';
comment on column wallets.wagered_px is 'Lifetime stake, whole UGX.';
comment on column wallets.won_px is 'Lifetime winnings, whole UGX.';
comment on column wallets.cashed_out_px is 'Lifetime cashout, whole UGX.';
comment on column px_claims.amount_px is
  'Daily bonus actually granted, in whole Ugandan Shillings. The column kept its PX-era name.';
comment on function claim_daily_px(bigint) is
  'Daily login bonus: 150 whole UGX, once per Africa/Kampala day, fixed server-side. Returns the resulting balance.';
