-- 0010_admin_operations.sql
-- Admin operations that change state, plus the audit trail they write.
--
-- Everything here is SECURITY DEFINER and granted to service_role only. The
-- admin flag is re-checked against profiles inside each function, so a bug in
-- the HTTP layer cannot turn "I am an admin" into a claim the database trusts.
--
-- Two rules hold throughout:
--   1. Every function that moves PX writes a ledger row. There is no path to a
--      balance change that leaves no trace, because an operator reconciling the
--      books a month from now has nothing else to go on.
--   2. Every function records who did it in admin_actions. An unattributed
--      adjustment is indistinguishable from a compromise.

-- ------------------------------------------------------- audit trail ------
create table if not exists admin_actions (
  id         bigserial primary key,
  admin_id   uuid not null references profiles(id) on delete restrict,
  action     text not null,
  target_id  uuid,
  detail     jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists admin_actions_time on admin_actions (created_at desc);
create index if not exists admin_actions_target on admin_actions (target_id, created_at desc);

alter table admin_actions enable row level security;
-- Admins read it through the service role. Players never see it.
revoke all on admin_actions from anon, authenticated;
grant select on admin_actions to service_role;

/** True when the given user is a real, unsuspended admin. */
create or replace function is_admin(p_user uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select coalesce(
    (select is_admin and not suspended from profiles where id = p_user),
    false
  );
$$;
revoke all on function is_admin(uuid) from anon, authenticated;

-- --------------------------------------------------------- adjustments ----
/**
 * Credit or debit a player's wallet by hand.
 *
 * This is the function an operator reaches for when money goes wrong: a stuck
 * payout, a duplicated charge, a goodwill gesture. It is deliberately the only
 * hand-written balance change in the schema, and it is loud: a non-zero delta
 * is required, the reason is mandatory, and both the ledger and the audit
 * trail get a row.
 *
 * A debit cannot take a wallet below zero; the check constraint on wallets
 * would reject it anyway, but failing with a readable message beats a 23514.
 */
create or replace function admin_adjust_balance(
  p_admin   uuid,
  p_user    uuid,
  p_delta   bigint,
  p_reason  text
) returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_after bigint;
begin
  if not is_admin(p_admin) then
    raise exception 'admin access required' using errcode = '42501';
  end if;
  if p_delta = 0 then
    raise exception 'adjustment must be non-zero' using errcode = '22023';
  end if;
  if p_reason is null or length(trim(p_reason)) < 8 then
    raise exception 'a reason of at least 8 characters is required' using errcode = '22023';
  end if;

  select balance_px into v_after from wallets where user_id = p_user for update;
  if not found then raise exception 'no wallet for that player' using errcode = 'P0002'; end if;

  v_after := v_after + p_delta;
  if v_after < 0 then
    raise exception 'that would take the balance below zero' using errcode = '22023';
  end if;

  update wallets set balance_px = v_after, updated_at = now() where user_id = p_user;

  insert into ledger (user_id, kind, delta_px, balance_after, ref, meta)
  values (p_user, 'adjustment', p_delta, v_after, 'admin:' || p_admin::text,
          jsonb_build_object('reason', p_reason, 'admin', p_admin));

  insert into admin_actions (admin_id, action, target_id, detail)
  values (p_admin, 'adjust_balance', p_user,
          jsonb_build_object('delta_px', p_delta, 'reason', p_reason, 'balance_after', v_after));

  return v_after;
end $$;

-- ------------------------------------------------------------- suspend ----
/**
 * Stop a player playing, or let them back in.
 *
 * Suspension is not deletion: the wallet, the ledger and the payout history all
 * stay exactly where they are, because a suspicious account is usually also an
 * account with money owed to it or by it. request_cashout honours `suspended`,
 * and claim_daily_px refuses, so this genuinely stops the bleeding.
 */
create or replace function admin_set_suspended(
  p_admin  uuid,
  p_user   uuid,
  p_state  boolean,
  p_reason text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin(p_admin) then
    raise exception 'admin access required' using errcode = '42501';
  end if;
  if p_user = p_admin and p_state then
    raise exception 'you cannot suspend your own account' using errcode = '22023';
  end if;
  if not exists (select 1 from profiles where id = p_user) then
    raise exception 'no such player' using errcode = 'P0002';
  end if;

  update profiles set suspended = p_state, updated_at = now() where id = p_user;

  insert into admin_actions (admin_id, action, target_id, detail)
  values (p_admin, case when p_state then 'suspend' else 'unsuspend' end, p_user,
          jsonb_build_object('reason', p_reason));
end $$;

-- ---------------------------------------------------------- admin flag ----
create or replace function admin_set_admin_flag(
  p_admin uuid,
  p_user  uuid,
  p_state boolean
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin(p_admin) then
    raise exception 'admin access required' using errcode = '42501';
  end if;
  -- Losing the last admin locks everyone out of every admin screen, including
  -- the one that would grant it back. Refuse rather than discover it later.
  if not p_state and (select count(*) from profiles where is_admin) <= 1 then
    raise exception 'this is the last admin account' using errcode = '22023';
  end if;

  update profiles set is_admin = p_state, updated_at = now() where id = p_user;

  insert into admin_actions (admin_id, action, target_id, detail)
  values (p_admin, case when p_state then 'grant_admin' else 'revoke_admin' end, p_user, '{}'::jsonb);
end $$;

-- ----------------------------------------------------------- cashouts -----
/**
 * Finish a withdrawal, either by paying it or by giving the money back.
 *
 * This wraps settle_cashout rather than replacing it, for two reasons:
 *
 *  - Settling a payout and recording who decided are one act. If they were two
 *    calls, a crash between them would leave money moved and nobody to ask.
 *  - A rejection MUST refund, and settle_cashout already does that correctly
 *    (it adds the held PX back and writes a cashout_refund ledger row). Duplicating
 *    that logic here would give us two implementations of the same money rule,
 *    which is how balances drift.
 *
 * `paid` is only ever true when a provider has actually confirmed it. Approving
 * a payout in the UI calls /api/disburse first and passes the provider result
 * in; this function trusts the caller only because the caller is the service
 * role behind an admin check.
 */
create or replace function admin_settle_cashout(
  p_admin  uuid,
  p_cashout uuid,
  p_status cashout_status,
  p_reason text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin(p_admin) then
    raise exception 'admin access required' using errcode = '42501';
  end if;

  perform settle_cashout(p_cashout, p_status, p_reason);

  insert into admin_actions (admin_id, action, target_id, detail)
  values (p_admin, 'settle_cashout', p_cashout,
          jsonb_build_object('status', p_status, 'reason', p_reason));
end $$;

-- ------------------------------------------------------------- grants -----
--
-- REVOKE FROM PUBLIC IS NOT OPTIONAL.
--
-- Postgres grants EXECUTE on a new function to PUBLIC by default. Revoking only
-- from `anon` and `authenticated` leaves that default in place, and both roles
-- inherit through PUBLIC -- so the functions stay callable from the browser over
-- PostgREST even though the explicit revoke appears to have worked.
--
-- This was caught by has_function_privilege() on the live project, not by
-- reading the SQL, and it is the difference between "admins can adjust balances"
-- and "any signed-in player can credit themselves". The revoke from PUBLIC comes
-- first and the per-role revokes follow, so neither path is left open.
revoke all on function admin_adjust_balance(uuid, uuid, bigint, text) from public;
revoke all on function admin_set_suspended(uuid, uuid, boolean, text) from public;
revoke all on function admin_set_admin_flag(uuid, uuid, boolean) from public;
revoke all on function admin_settle_cashout(uuid, uuid, cashout_status, text) from public;
revoke all on function is_admin(uuid) from public;

revoke all on function admin_adjust_balance(uuid, uuid, bigint, text) from anon, authenticated;
revoke all on function admin_set_suspended(uuid, uuid, boolean, text)   from anon, authenticated;
revoke all on function admin_set_admin_flag(uuid, uuid, boolean)        from anon, authenticated;
revoke all on function admin_settle_cashout(uuid, uuid, cashout_status, text) from anon, authenticated;
grant execute on function admin_adjust_balance(uuid, uuid, bigint, text) to service_role;
grant execute on function admin_set_suspended(uuid, uuid, boolean, text) to service_role;
grant execute on function admin_set_admin_flag(uuid, uuid, boolean)      to service_role;
grant execute on function admin_settle_cashout(uuid, uuid, cashout_status, text) to service_role;
