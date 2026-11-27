-- ============================================================================
-- 0015 — make the daily bonus the amount the app promises
-- ============================================================================
--
-- 0014 shipped a deliberate contradiction and this migration resolves it.
--
-- Before UGX-only, the daily bonus was 15,000 PX. At the 100:1 peg that was
-- worth UGX 150, and the interface said so: "≈ UGX 150 daily bonus". When the
-- peg was removed, 0014 kept the *number of units* at 15,000 and changed what a
-- unit was — so the same claim silently became UGX 15,000, one hundred times its
-- old value, in real withdrawable money.
--
-- 0014's own comment justified that as "a UGX 150 daily bonus is not a reason to
-- open the app". That is a product decision, and it is the wrong one to make
-- silently on a payouts table: it turns a promise of UGX 150, printed to the
-- player before they tap, into a UGX 15,000 credit. A player who taps because
-- they were told 150 and receives 15,000 has not been rewarded, they have been
-- paid a different contract than the one they were shown.
--
-- The rule this file restores: the number the interface promises is the number
-- the database pays. UGX 150, once per day, unchanged by any client input.
--
-- Consequences worth knowing before deploying:
--   * Players who already claimed at 15,000 today have been overpaid. This
--     migration does not claw that back -- retroactively debiting a wallet to
--     fix our own inconsistency is worse than absorbing the difference. It only
--     fixes every claim from here on.
--   * The claim date is Africa/Kampala, so "once per day" still rolls over at
--     local midnight, not UTC.
--
-- Free play is untouched: it never reaches this database.
-- ============================================================================

-- The signature must match 0009/0014 exactly, or `create or replace` creates a
-- SECOND overload and the grant below applies to the wrong one. Keeping the
-- parameter (with its default) preserves that identity even though the client
-- never passes it.
create or replace function claim_daily_px(p_amount bigint default 150)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_today date := (now() at time zone 'Africa/Kampala')::date;
  -- One hundred and fifty shillings. The old 15,000 was that same value
  -- expressed in PX at the peg; it is not 15,000 shillings.
  v_amount bigint := coalesce(p_amount, 150);
  v_after bigint;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  -- The client passes no amount and a tampered browser must not be able to
  -- name its own reward, so anything other than the fixed value is refused.
  if v_amount <> 150 then raise exception 'reward is fixed' using errcode = '22023'; end if;
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

  update px_claims set balance_after = coalesce(v_after, 0)
   where user_id = v_uid and claim_date = v_today;

  -- The bonus must appear on the ledger like every other movement of money,
  -- otherwise a player's history cannot be reconciled against their balance.
  insert into ledger (user_id, kind, delta_px, balance_after, ref, meta)
  values (v_uid, 'adjustment', v_amount, v_after, 'daily-bonus-' || v_today,
          jsonb_build_object('kind', 'daily_bonus', 'currency', 'UGX'));

  -- Return what was actually credited, so the client never has to guess. The
  -- app used to hardcode 15,000 in a toast; it now reports this value.
  return v_amount;
end $$;

revoke all on function claim_daily_px(bigint) from public, anon;
grant execute on function claim_daily_px(bigint) to authenticated;

comment on function claim_daily_px(bigint) is
  'Daily login bonus: 150 whole UGX, once per Africa/Kampala day. The *_px names are PX-era and mean shillings; the grant is in shillings and is fixed server-side.';
comment on column px_claims.amount_px is
  'Daily bonus actually granted, in whole Ugandan Shillings. The column kept its PX-era name.';
