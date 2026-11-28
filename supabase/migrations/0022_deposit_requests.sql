-- ============================================================================
-- 0022 — deposits a player can ask someone else to pay for ("Float Me")
-- ============================================================================
--
-- The normal deposit is: the player's own mobile-money number is charged and
-- their own wallet is credited. That is the whole rail, and it stays.
--
-- This adds the second case the product asked for: a player who cannot fund the
-- account right now asks ANOTHER number to pay for them. The payer is a
-- different person on a different phone, and the money is still credited to the
-- REQUESTER's wallet — because it is the requester's deposit.
--
--   requester  create_deposit_request(amount)  -> a short code
--   sponsor    opens the code, enters their own number, approves the MoMo prompt
--   webhook    credits the REQUESTER, marks the request paid
--
-- WHAT MAKES THIS SAFE
--
--   * The amount is fixed when the request is made. A sponsor cannot pay a
--     different amount and have it count for more.
--   * The code is single-use. `mark_deposit_request_paid` flips it and only the
--     webhook (service_role) can call it; a second payment against a paid code
--     is refused by `record_sponsor_collect` before any charge is attempted.
--   * A sponsor needs no account: they are a phone number approving a prompt.
--     They therefore cannot name a beneficiary — the code already carries one.
--   * The credit still goes through `apply_gateway_result`, which re-verifies
--     the transaction with ZENGAPAY and is idempotent on the reference. No new
--     path in can create money.
--   * Codes are readable only by their creator (RLS). The sponsor path does not
--     read the table with the caller's rights: the edge function uses the
--     service role after matching the code, and returns no personal data.
-- ============================================================================

create table if not exists deposit_requests (
  id            uuid primary key default uuid_generate_v4(),
  user_id       uuid not null references profiles(id) on delete cascade,
  -- short, shareable, unambiguous (no 0/O, 1/I/L)
  code          text not null unique,
  amount        bigint not null check (amount >= 500 and amount <= 5000000),
  currency      text not null default 'UGX',
  status        text not null default 'pending'
                  check (status in ('pending', 'paid', 'expired', 'cancelled')),
  -- who actually paid, kept for the audit trail
  payer_phone   text,
  reference     text,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null default now() + interval '24 hours',
  paid_at       timestamptz
);

create index if not exists deposit_requests_user on deposit_requests (user_id, created_at desc);
create index if not exists deposit_requests_pending on deposit_requests (code) where status = 'pending';

alter table deposit_requests enable row level security;

-- A player may read their own requests (to see whether a friend paid yet).
drop policy if exists deposit_requests_read_own on deposit_requests;
create policy deposit_requests_read_own on deposit_requests for select
  using (auth.uid() = user_id);

-- No insert/update/delete policy: every write goes through a function below.

-- ------------------------------------------------------------ the alphabet ---

-- 32 characters: no 0/O/1/I/L, so a code dictated over the phone cannot be
-- mistyped into a different valid code.
create or replace function deposit_code()
returns text
language plpgsql
as $$
declare
  alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  out_code text := '';
  i int;
begin
  for i in 1..8 loop
    out_code := out_code || substr(alphabet, 1 + floor(random() * 32)::int, 1);
  end loop;
  return out_code;
end $$;

-- ------------------------------------------------------- create a request ---

create or replace function create_deposit_request(p_amount bigint, p_currency text default 'UGX')
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_code  text;
  v_try   int := 0;
  v_row   deposit_requests;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;

  if exists (select 1 from profiles where id = v_uid and suspended) then
    raise exception 'account suspended' using errcode = '42501';
  end if;

  if upper(coalesce(p_currency, 'UGX')) <> 'UGX' then
    raise exception 'only UGX deposits are supported' using errcode = '22023';
  end if;

  if p_amount is null or p_amount < 500 then
    raise exception 'the minimum deposit is 500 UGX' using errcode = '22023';
  end if;
  if p_amount > 5000000 then
    raise exception 'the maximum deposit is 5,000,000 UGX' using errcode = '22023';
  end if;

  -- One live request at a time: two open codes for the same player is two people
  -- paying for one deposit, and the second credit would be the surprise one.
  if exists (
    select 1 from deposit_requests
     where user_id = v_uid and status = 'pending' and expires_at > now()
  ) then
    raise exception 'you already have a deposit request open' using errcode = '55000';
  end if;

  -- Expire anything stale so the "one live request" rule cannot be permanent.
  update deposit_requests
     set status = 'expired'
   where user_id = v_uid and status = 'pending' and expires_at <= now();

  loop
    v_try := v_try + 1;
    v_code := deposit_code();
    begin
      insert into deposit_requests (user_id, code, amount, currency)
      values (v_uid, v_code, p_amount, 'UGX')
      returning * into v_row;
      exit;
    exception when unique_violation then
      if v_try >= 5 then raise; end if;
    end;
  end loop;

  return jsonb_build_object(
    'id', v_row.id,
    'code', v_row.code,
    'amount', v_row.amount,
    'currency', v_row.currency,
    'status', v_row.status,
    'expires_at', v_row.expires_at
  );
end $$;

revoke all on function create_deposit_request(bigint, text) from public, anon;
grant execute on function create_deposit_request(bigint, text) to authenticated, service_role;

/**
 * Withdraw a request that nobody has paid. A pending code the requester no
 * longer wants is one less thing for a friend to pay by mistake.
 */
create or replace function cancel_deposit_request(p_code text)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;

  update deposit_requests
     set status = 'cancelled'
   where user_id = v_uid
     and code = upper(trim(coalesce(p_code, '')))
     and status = 'pending';

  return found;
end $$;

revoke all on function cancel_deposit_request(text) from public, anon;
grant execute on function cancel_deposit_request(text) to authenticated, service_role;

-- ------------------------------------------------- sponsor side (server only) ---

/**
 * Resolve a code for the sponsor page. Returns no personal data — not the
 * requester's name, phone or balance — because the caller is anonymous.
 */
create or replace function deposit_request_public(p_code text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_row deposit_requests;
begin
  select * into v_row from deposit_requests where code = upper(trim(coalesce(p_code, '')));
  if not found then
    return jsonb_build_object('found', false);
  end if;

  return jsonb_build_object(
    'found', true,
    'code', v_row.code,
    'amount', v_row.amount,
    'currency', v_row.currency,
    'status', case when v_row.status = 'pending' and v_row.expires_at <= now()
                   then 'expired' else v_row.status end,
    'expires_at', v_row.expires_at
  );
end $$;

revoke all on function deposit_request_public(text) from public, anon, authenticated;
grant execute on function deposit_request_public(text) to service_role;

/**
 * Open a payment order for a sponsor's payment against a request code.
 *
 * The order's user_id is the REQUESTER, so the existing webhook path credits the
 * requester with no special case in `apply_gateway_result`. Returns the order id
 * the caller should use, or null when the code cannot be paid.
 */
create or replace function record_sponsor_collect(
  p_code      text,
  p_order     text,
  p_reference text,
  p_amount    bigint,
  p_currency  text,
  p_phone     text,
  p_provider  text default null
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_req deposit_requests;
begin
  select * into v_req from deposit_requests
   where code = upper(trim(coalesce(p_code, '')))
   for update;

  if not found then raise exception 'unknown deposit request' using errcode = 'P0002'; end if;
  if v_req.status <> 'pending' then
    raise exception 'this deposit request is already %', v_req.status using errcode = '55000';
  end if;
  if v_req.expires_at <= now() then
    raise exception 'this deposit request has expired' using errcode = '55000';
  end if;
  if p_amount is distinct from v_req.amount then
    -- The amount is fixed by the requester. A sponsor paying something else is a
    -- different deposit and must not be counted as this one.
    raise exception 'this request is for % %', v_req.amount, v_req.currency using errcode = '22023';
  end if;

  insert into payment_orders (order_id, user_id, direction, amount, currency, phone, provider, reference)
  values (p_order, v_req.user_id, 'collect', p_amount, upper(coalesce(p_currency, 'UGX')), p_phone, p_provider, p_reference)
  on conflict (order_id) do update
    set reference = excluded.reference,
        provider = excluded.provider;

  update deposit_requests
     set payer_phone = p_phone,
         reference = p_reference
   where id = v_req.id;

  return v_req.id;
end $$;

revoke all on function record_sponsor_collect(text, text, text, bigint, text, text, text)
  from public, anon, authenticated;
grant execute on function record_sponsor_collect(text, text, text, bigint, text, text, text)
  to service_role;

-- ------------------------------------------------------- settle the request ---

/**
 * Flip a request to paid. Called by a trigger on payment_orders, so it cannot be
 * forgotten by a code path, and it is idempotent on the reference.
 */
create or replace function mark_deposit_request_paid()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.direction = 'collect' and new.status = 'completed' then
    update deposit_requests
       set status = 'paid',
           paid_at = now(),
           reference = coalesce(deposit_requests.reference, new.reference)
     where reference = new.reference
       and status = 'pending';
  end if;
  return new;
end $$;

drop trigger if exists payment_orders_settle_deposit_request on payment_orders;
create trigger payment_orders_settle_deposit_request
  after update of status on payment_orders
  for each row execute function mark_deposit_request_paid();

-- The inverse: a sponsor's payment that failed should free the code so it can be
-- retried instead of burning the requester's 24 hours.
create or replace function release_deposit_request()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.direction = 'collect' and new.status = 'failed' then
    update deposit_requests
       set payer_phone = null,
           reference = null
     where reference = new.reference
       and status = 'pending';
  end if;
  return new;
end $$;

drop trigger if exists payment_orders_release_deposit_request on payment_orders;
create trigger payment_orders_release_deposit_request
  after update of status on payment_orders
  for each row execute function release_deposit_request();

revoke all on function mark_deposit_request_paid() from public, anon, authenticated;
revoke all on function release_deposit_request() from public, anon, authenticated;

comment on table deposit_requests is
  'A deposit the requester asks another mobile-money number to pay for. Credited to the requester.';
