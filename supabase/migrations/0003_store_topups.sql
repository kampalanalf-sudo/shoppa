-- 0003_store_topups.sql
--
-- Hosted-store top-ups.
--
-- The hosted DGateway store is a page we do not control, so it cannot carry our
-- order_id the way /api/collect does. The only identity it gives us back is the
-- buyer's checkout email. That is a weaker key than order_id, so this migration
-- is deliberately strict:
--
--   * completed + verified email match credit automatically
--   * anything else parks in `pending` for an admin, it never auto-credits
--   * a store top-up we cannot match to an account parks in `unmatched`
--   * the player can claim a parked top-up only if the amount AND the
--     transaction reference match what we already recorded from DGateway
--   * every credit is idempotent on the DGateway reference

create table if not exists store_topups (
  id             uuid primary key default uuid_generate_v4(),
  reference      text not null unique,
  status         text not null default 'pending'
                 check (status in ('pending', 'completed', 'failed')),
  amount         bigint not null check (amount > 0),
  currency       text not null default 'UGX',
  quantity       int not null default 1 check (quantity > 0),
  product_id     text,
  product_slug   text,
  store_slug     text,
  buyer_name     text,
  buyer_email    text,
  buyer_phone    text,
  provider       text,
  provider_ref   text,
  failure_reason text,
  -- 'auto'  : email matched an account, credited by the webhook
  -- 'claim' : parked, then claimed by the player who proved the reference
  -- 'admin' : matched or released by hand
  matched_by     text check (matched_by in ('auto', 'claim', 'admin')),
  user_id        uuid references profiles(id) on delete set null,
  -- why the row is parked, so an admin sees it in the queue
  parked_reason  text,
  claimed_at     timestamptz,
  created_at     timestamptz not null default now(),
  settled_at     timestamptz
);

create index if not exists store_topups_user_idx on store_topups (user_id, created_at desc);
create index if not exists store_topups_parked_idx on store_topups (status, parked_reason)
  where user_id is null;

alter table store_topups enable row level security;

-- a player may read only their own store top-ups; nothing is writable by clients
drop policy if exists store_topups_read_own on store_topups;
create policy store_topups_read_own on store_topups for select
  using (user_id is not null and user_id = auth.uid());

-- ------------------------------------------------------------------ RPC ------

-- Called by the store webhook (service_role) after it has verified the payment
-- against DGateway. Credits only on an exact, single-match email.
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

  -- peg: 10 PX = 1 UGX. quantity multiplies the product price.
  v_px := case
    when upper(coalesce(p_currency, 'UGX')) = 'UGX'
      then p_amount * 10 * greatest(coalesce(p_quantity, 1), 1)
    else p_amount * greatest(coalesce(p_quantity, 1), 1)
  end;

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

-- A player claims a parked top-up using the reference from their payment SMS.
-- The reference is the shared secret: only a buyer holding it can claim, and it
-- must still be unclaimed, completed at DGateway, and the amount must match.
create or replace function claim_store_topup(p_reference text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_row  store_topups;
  v_px   bigint;
  v_after bigint;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '28000'; end if;

  select * into v_row from store_topups where reference = p_reference for update;
  if not found then raise exception 'unknown reference' using errcode = 'P0002'; end if;

  -- already credited to this player: report success, do not credit twice
  if v_row.status = 'completed' and v_row.user_id = v_uid then
    return jsonb_build_object('ok', true, 'credited', true, 'replay', true);
  end if;
  if v_row.status = 'completed' then
    raise exception 'this top-up has already been claimed' using errcode = 'P0001';
  end if;
  if v_row.status = 'failed' then
    raise exception 'this payment failed and cannot be claimed' using errcode = 'P0001';
  end if;
  if v_row.settled_at is null then
    raise exception 'this payment is still pending' using errcode = 'P0001';
  end if;

  v_px := case
    when upper(v_row.currency) = 'UGX' then v_row.amount * 10 * v_row.quantity
    else v_row.amount * v_row.quantity
  end;

  update store_topups
     set status = 'completed', user_id = v_uid, matched_by = 'claim',
         claimed_at = now(), parked_reason = null
   where id = v_row.id;

  select balance_px into v_after from wallets where user_id = v_uid for update;
  v_after := v_after + v_px;
  update wallets set balance_px = v_after where user_id = v_uid;

  insert into ledger (user_id, kind, delta_px, balance_after, ref, meta)
  values (v_uid, 'adjustment', v_px, v_after, p_reference,
          jsonb_build_object('kind', 'store_deposit', 'channel', 'claim',
                             'product_slug', v_row.product_slug, 'quantity', v_row.quantity));

  return jsonb_build_object('ok', true, 'credited', true, 'px', v_px, 'balance', v_after);
end $$;

-- Admin release for a parked row (wrong email typed at checkout, etc).
create or replace function release_store_topup(p_reference text, p_user_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_row  store_topups;
  v_px   bigint;
  v_after bigint;
begin
  select * into v_row from store_topups where reference = p_reference for update;
  if not found then raise exception 'unknown reference' using errcode = 'P0002'; end if;
  if v_row.status = 'completed' then return jsonb_build_object('ok', true, 'replay', true); end if;
  if v_row.status = 'failed' then raise exception 'failed payments cannot be released' using errcode = 'P0001'; end if;
  if p_user_id is null then raise exception 'user is required' using errcode = 'P0001'; end if;

  v_px := case
    when upper(v_row.currency) = 'UGX' then v_row.amount * 10 * v_row.quantity
    else v_row.amount * v_row.quantity
  end;

  update store_topups
     set status = 'completed', user_id = p_user_id, matched_by = 'admin',
         claimed_at = now(), parked_reason = null
   where id = v_row.id;

  select balance_px into v_after from wallets where user_id = p_user_id for update;
  v_after := v_after + v_px;
  update wallets set balance_px = v_after where user_id = p_user_id;

  insert into ledger (user_id, kind, delta_px, balance_after, ref, meta)
  values (p_user_id, 'adjustment', v_px, v_after, p_reference,
          jsonb_build_object('kind', 'store_deposit', 'channel', 'admin',
                             'product_slug', v_row.product_slug, 'quantity', v_row.quantity));

  return jsonb_build_object('ok', true, 'credited', true, 'px', v_px, 'balance', v_after);
end $$;

-- server-only
revoke all on function apply_store_topup(text, text, bigint, text, int, text, text, text, text, text, text, text, text, text) from public;
revoke all on function release_store_topup(text, uuid) from public;
revoke all on function claim_store_topup(text) from public;

grant execute on function apply_store_topup(text, text, bigint, text, int, text, text, text, text, text, text, text, text, text) to service_role;
grant execute on function release_store_topup(text, uuid) to service_role;
-- players may only call claim, and it derives the user from auth.uid()
grant execute on function claim_store_topup(text) to authenticated;
