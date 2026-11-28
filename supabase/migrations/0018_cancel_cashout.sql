-- 0018_cancel_cashout.sql
--
-- Let a player release their own withdrawal hold.
--
-- WHY
--
-- request_cashout takes the amount out of the spendable balance immediately and
-- records a `cashout_hold` ledger row. The payout is then sent from the server.
-- When the provider refuses that payout, nothing had the authority to give the
-- money back: settle_cashout is service_role only, and the cashout stayed
-- `requested` forever. The player's balance was short by the amount with no
-- payout and nothing on screen explaining it.
--
-- The first time this mattered in production was an IP whitelisting fault, not a
-- banking one: the transfer was refused before any money moved. A configuration
-- problem must never silently cost a player their balance.
--
-- WHAT THIS DELIBERATELY CANNOT DO
--
--   * It only works on `requested`. Once the provider has accepted a payout the
--     row is `pending_provider`, and cancelling it would let a player who has
--     already been paid claw money back. That transition is refused outright.
--   * It only works on the caller's own cashout. auth.uid() is the filter, not a
--     parameter, so no id can be guessed to reach another account.
--   * It refunds through settle_cashout, so the money goes back through the one
--     tested path that writes `cashout_refund` and restores balance_px. There is
--     no second implementation of "give money back" here.

create or replace function public.cancel_cashout(p_cashout uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_co cashouts;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  -- Locked so a concurrent settle cannot race this into a double refund.
  select * into v_co from cashouts where id = p_cashout for update;
  if not found then
    raise exception 'cashout not found' using errcode = 'P0002';
  end if;

  if v_co.user_id <> v_uid then
    raise exception 'not your cashout' using errcode = '42501';
  end if;

  if v_co.status = 'cancelled' then
    return false; -- already released; nothing more to do
  end if;

  if v_co.status <> 'requested' then
    raise exception 'this payout has already been sent and cannot be cancelled'
      using errcode = '22023';
  end if;

  -- Refunds the hold and writes the cashout_refund ledger row.
  perform settle_cashout(p_cashout, 'cancelled', 'released before payout');
  return true;
end;
$$;

revoke all on function public.cancel_cashout(uuid) from public;
revoke all on function public.cancel_cashout(uuid) from anon;
grant execute on function public.cancel_cashout(uuid) to authenticated, service_role;
