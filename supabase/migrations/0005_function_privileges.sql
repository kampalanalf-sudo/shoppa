-- 0005_function_privileges.sql
-- ============================================================================
-- CRITICAL: closes a privilege hole present in 0001-0004.
--
-- `revoke all on function ... from public` is NOT enough on Supabase. The
-- platform sets default privileges on the public schema that GRANT EXECUTE to
-- `anon` and `authenticated` explicitly at CREATE time. An explicit grant to a
-- named role is not inherited from PUBLIC, so revoking from PUBLIC leaves it
-- in place.
--
-- Verified on a live database before this fix:
--   authenticated could execute admin_release_store_topup  -> true
--   authenticated could execute apply_store_topup          -> true
--   authenticated could execute settle_cashout             -> true
--   anon          could execute place_bet                  -> true
--
-- All of those are SECURITY DEFINER and bypass RLS, so a player holding their
-- own JWT could have called admin_release_store_topup(reference, any_user,
-- any_admin) through PostgREST and credited an arbitrary wallet.
--
-- This migration revokes every public-schema function from anon/authenticated
-- and re-grants only what the app actually needs, then changes the schema
-- default so future functions fail closed instead of open.
-- ============================================================================

-- 1. Take EXECUTE away from the client roles, everywhere in public.
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
  loop
    execute format('revoke all on function %s from public', r.sig);
    execute format('revoke all on function %s from anon', r.sig);
    execute format('revoke all on function %s from authenticated', r.sig);
  end loop;
end $$;

-- 2. Grant back only what the browser is supposed to call.
--    Every one of these derives the acting user from auth.uid(), so a caller
--    can only ever move their own money.
grant execute on function place_bet(text, bigint) to authenticated;
grant execute on function settle_round(text, bigint, numeric, text, bigint, text, text) to authenticated;
grant execute on function send_gift(uuid, bigint, text) to authenticated;
grant execute on function claim_gift(uuid) to authenticated;
grant execute on function refund_gift(uuid) to authenticated;
grant execute on function request_cashout(cashout_kind, bigint, text, text, text, text) to authenticated;

-- The one claim path a player may call. Takes only a reference and uses
-- auth.uid() for the destination.
grant execute on function claim_store_topup(text) to authenticated;

-- 3. Server-only functions: service_role, and nobody else.
grant execute on function settle_cashout(uuid, cashout_status, text) to service_role;
grant execute on function record_collect(uuid, text, text, bigint, text, text, text) to service_role;
grant execute on function record_disburse(uuid, text, text, bigint, text, text, text, uuid) to service_role;
grant execute on function apply_gateway_result(text, payment_status, text, text) to service_role;
grant execute on function apply_store_topup(text, text, bigint, text, int, text, text, text, text, text, text, text, text, text) to service_role;
grant execute on function admin_release_store_topup(text, uuid, uuid) to service_role;
grant execute on function dismiss_store_topup(text, uuid, text) to service_role;

-- The retired 0003 release stays dead for every role.
revoke all on function release_store_topup(text, uuid) from public, anon, authenticated, service_role;

-- 4. Fail closed for anything created later. Without this, the next function a
--    future migration adds is silently world-executable again.
alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon;
alter default privileges in schema public revoke execute on functions from authenticated;
