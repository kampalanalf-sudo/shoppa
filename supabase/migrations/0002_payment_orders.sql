-- ============================================================================
-- 0002_payment_orders.sql
-- ----------------------------------------------------------------------------
-- Server-side order book for the DGateway routes under /api.
--
-- The browser never writes here. Each row stores the DGateway `reference` so a
-- webhook can be matched back to the order that started it, and so a repeated
-- webhook can be recognised as idempotent.
-- ============================================================================

do $$ begin
  create type payment_direction as enum ('collect', 'disburse');
exception when duplicate_object then null; end $$;

do $$ begin
  create type payment_status as enum ('pending', 'completed', 'failed');
exception when duplicate_object then null; end $$;

create table if not exists payment_orders (
  id             uuid primary key default uuid_generate_v4(),
  -- caller-supplied id so the client can show progress before DGateway replies
  order_id       text not null unique,
  user_id        uuid not null references profiles(id) on delete cascade,
  direction      payment_direction not null,
  amount         bigint not null check (amount > 0),
  currency       text not null default 'UGX',
  phone          text,
  provider       text,
  -- the reference DGateway returned; unique so a webhook cannot match twice
  reference      text not null unique,
  status         payment_status not null default 'pending',
  provider_ref   text,
  failure_reason text,
  -- set when this payout belongs to a cashout hold
  cashout_id     uuid references cashouts(id) on delete set null,
  created_at     timestamptz not null default now(),
  settled_at     timestamptz
);

create index if not exists payment_orders_user on payment_orders (user_id, created_at desc);
create index if not exists payment_orders_pending on payment_orders (status) where status = 'pending';

alter table payment_orders enable row level security;

-- players may read their own orders, never write them
drop policy if exists payment_orders_read_own on payment_orders;
create policy payment_orders_read_own on payment_orders for select
  using (auth.uid() = user_id);

-- ======================================================== RPCs ==============
-- Called only by the server routes, which authenticate with the service role.

/** Top-up started: remember the DGateway reference against the order. */
create or replace function record_collect(
  p_user uuid,
  p_order text,
  p_reference text,
  p_amount bigint,
  p_currency text,
  p_phone text default null,
  p_provider text default null
)
returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into payment_orders (order_id, user_id, direction, amount, currency, phone, provider, reference)
  values (p_order, p_user, 'collect', p_amount, upper(coalesce(p_currency, 'UGX')), p_phone, p_provider, p_reference)
  on conflict (order_id) do update
    set reference = excluded.reference,
        provider = excluded.provider;
end $$;

/** Payout started. */
create or replace function record_disburse(
  p_user uuid,
  p_order text,
  p_reference text,
  p_amount bigint,
  p_currency text,
  p_phone text default null,
  p_provider text default null,
  p_cashout uuid default null
)
returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into payment_orders
    (order_id, user_id, direction, amount, currency, phone, provider, reference, cashout_id)
  values
    (p_order, p_user, 'disburse', p_amount, upper(coalesce(p_currency, 'UGX')), p_phone, p_provider, p_reference, p_cashout)
  on conflict (order_id) do update
    set reference = excluded.reference,
        provider = excluded.provider,
        cashout_id = excluded.cashout_id;

  -- A payout is in flight: mark the cashout so the UI shows progress.
  if p_cashout is not null then
    update cashouts
       set status = 'pending_provider',
           provider_ref = p_reference
     where id = p_cashout
       and user_id = p_user
       and status = 'requested';
  end if;
end $$;

/**
 * Terminal result from the webhook. Atomic and idempotent:
 *   completed collect  -> credit the wallet with the converted PX
 *   failed    collect  -> record only, nothing is credited
 *   completed disburse -> finalise the cashout hold as paid
 *   failed    disburse -> refund the hold back to the player
 */
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

  -- idempotent: a repeated webhook is a no-op
  if v_order.status in ('completed', 'failed') then return; end if;

  update payment_orders
     set status = p_status,
         provider_ref = coalesce(p_provider_ref, provider_ref),
         failure_reason = case when p_status = 'failed' then p_failure_reason else failure_reason end,
         settled_at = now()
   where id = v_order.id;

  if v_order.direction = 'collect' and p_status = 'completed' then
    -- UGX top-up converts to PX at the platform peg (10 PX = 1 UGX)
    v_px := case
      when upper(v_order.currency) = 'UGX' then v_order.amount * 10
      else v_order.amount
    end;

    select balance_px into v_after from wallets where user_id = v_order.user_id for update;
    v_after := v_after + v_px;
    update wallets set balance_px = v_after where user_id = v_order.user_id;

    insert into ledger (user_id, kind, delta_px, balance_after, ref, meta)
    values (v_order.user_id, 'adjustment', v_px, v_after, v_order.order_id,
            jsonb_build_object('kind', 'deposit', 'currency', v_order.currency, 'amount', v_order.amount));

  elsif v_order.direction = 'disburse' and v_order.cashout_id is not null then
    if p_status = 'completed' then
      perform settle_cashout(v_order.cashout_id, 'paid'::cashout_status, null);
    else
      -- provider failed the payout: release the hold back to the player
      perform settle_cashout(v_order.cashout_id, 'failed'::cashout_status,
                             coalesce(p_failure_reason, 'provider reported failure'));
    end if;
  end if;
end $$;

-- server-only: the service role calls these, never `authenticated`
revoke all on function record_collect(uuid, text, text, bigint, text, text, text) from public;
revoke all on function record_disburse(uuid, text, text, bigint, text, text, text, uuid) from public;
revoke all on function apply_gateway_result(text, payment_status, text, text) from public;
grant execute on function record_collect(uuid, text, text, bigint, text, text, text) to service_role;
grant execute on function record_disburse(uuid, text, text, bigint, text, text, text, uuid) to service_role;
grant execute on function apply_gateway_result(text, payment_status, text, text) to service_role;
