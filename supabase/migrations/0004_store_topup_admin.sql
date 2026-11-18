-- 0004_store_topup_admin.sql
--
-- Admin release / dismiss for the parked-payment queue.
--
-- 0003 could only release by calling release_store_topup(reference, user_id) with
-- no record of who did it. This adds the attribution: every manual credit names
-- the admin who approved it, in both store_topups and the ledger.
--
-- The player-facing claim path in 0003 is unchanged and unaffected.

alter table store_topups
  add column if not exists released_by uuid references profiles(id) on delete set null,
  add column if not exists dismissed_by uuid references profiles(id) on delete set null;

-- One audit trail for every manual decision, kept separately from the row so a
-- later status change can never erase who authorized the credit.
create table if not exists store_topup_actions (
  id         bigserial primary key,
  reference  text not null,
  action     text not null check (action in ('release', 'dismiss')),
  admin_id   uuid references profiles(id) on delete set null,
  -- the account credited on a release; null on a dismiss
  user_id    uuid references profiles(id) on delete set null,
  px         bigint,
  note       text,
  created_at timestamptz not null default now()
);

create index if not exists store_topup_actions_ref_idx on store_topup_actions (reference, created_at desc);

alter table store_topup_actions enable row level security;
-- No policies: admins read this through the service role only.

-- Release a parked top-up to a named account.
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

  v_px := case
    when upper(v_row.currency) = 'UGX' then v_row.amount * 10 * v_row.quantity
    else v_row.amount * v_row.quantity
  end;

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

-- Dismiss a parked top-up: it will never be credited.
create or replace function dismiss_store_topup(
  p_reference text,
  p_admin_id  uuid,
  p_note      text default null
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_row store_topups;
begin
  if p_admin_id is null then raise exception 'admin is required' using errcode = 'P0001'; end if;

  select * into v_row from store_topups where reference = p_reference for update;
  if not found then raise exception 'unknown reference' using errcode = 'P0002'; end if;
  if v_row.status = 'completed' then
    raise exception 'this top-up has already been credited' using errcode = 'P0001';
  end if;

  update store_topups
     set status = 'failed', dismissed_by = p_admin_id,
         failure_reason = coalesce(p_note, 'dismissed by admin')
   where id = v_row.id;

  insert into store_topup_actions (reference, action, admin_id, user_id, note)
  values (p_reference, 'dismiss', p_admin_id, v_row.user_id, p_note);

  return jsonb_build_object('ok', true, 'status', 'failed');
end $$;

revoke all on function admin_release_store_topup(text, uuid, uuid) from public;
revoke all on function dismiss_store_topup(text, uuid, text) from public;
grant execute on function admin_release_store_topup(text, uuid, uuid) to service_role;
grant execute on function dismiss_store_topup(text, uuid, text) to service_role;

-- The 0003 player-facing release had no attribution; retire it so there is
-- exactly one way to release a parked payment, and it always records an admin.
revoke all on function release_store_topup(text, uuid) from public;
revoke all on function release_store_topup(text, uuid) from service_role;
