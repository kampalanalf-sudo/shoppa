-- 0019_disable_client_settle.sql
--
-- URGENT: any signed-in player can mint balance.
--
-- Both of these were executable by `authenticated`, meaning any player holding
-- their own session token could call them directly from a browser console:
--
--   place_bet(game, wager)       debits wallets.balance_px
--   settle_round(game, wager,
--                multiplier, …)  CREDITS floor(wager * multiplier)
--
-- settle_round takes the multiplier as an argument and performs no game logic,
-- no validation and no randomness checks. The only ceiling is clamped at
-- 100000, so the trivial sequence
--
--   rpc('place_bet',        { p_wager_px: 100 })
--   rpc('settle_round',     { p_wager_px: 100, p_multiplier: 100000 })
--
-- turns 100 UGX into 10,000,000 UGX, which then withdraws through the normal
-- cashout path. The exposure right now is the whole platform balance, and this
-- is the same class of defect as the wallet printer removed from the client,
-- except here it lives in the database and is reachable by anyone with an
-- account — not just by someone who trusts the UI.
--
-- No legitimate caller exists. The client does not invoke either function
-- (grep for `rpc('place_bet'` / `rpc('settle_round'` finds nothing); every arcade
-- game settles locally in the browser. So revoking closes the hole without
-- removing any working feature.
--
-- This does NOT make the arcade correct — see 0020. It only stops the hole from
-- being a way to steal.
--
-- Reinstating them later requires the payout to be server-derived from the
-- committed seed stream, with the multiplier never accepted from the caller.

revoke all on function public.place_bet(text, bigint) from authenticated;
revoke all on function public.place_bet(text, bigint) from public;
revoke all on function public.place_bet(text, bigint) from anon;

revoke all on function public.settle_round(text, bigint, numeric, text, bigint, text, text) from authenticated;
revoke all on function public.settle_round(text, bigint, numeric, text, bigint, text, text) from public;
revoke all on function public.settle_round(text, bigint, numeric, text, bigint, text, text) from anon;

-- service_role keeps them: an admin repair or a future server-side settlement
-- needs them, and service_role is not reachable from a browser.
grant execute on function public.place_bet(text, bigint) to service_role;
grant execute on function public.settle_round(text, bigint, numeric, text, bigint, text, text) to service_role;
