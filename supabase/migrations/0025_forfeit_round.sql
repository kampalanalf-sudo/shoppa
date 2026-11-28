-- ============================================================================
-- 0025 — a player can clear their own stuck round
-- ============================================================================
--
-- `0020` added `abandon_stale_rounds`, which closes a round the player walked
-- away from — but only after 30 minutes, and only from inside `start_round`.
-- Thirty minutes is the right window for a rule about *abandoned* rounds, and it
-- is a terrible wait for someone sitting in front of a game that says
-- "finish your last round first" about a round they cannot see.
--
-- So: the same close-and-refund, reachable by the player, for their OWN round,
-- immediately. Called automatically by the app when a spin is refused with that
-- message, then the spin is retried once.
--
-- WHY THIS CANNOT BE ABUSED
--
--   * it takes no argument. The round is found from auth.uid(), so it can only
--     ever close the caller's own round;
--   * it refunds the STAKE, never a payout. There is no multiplier to derive and
--     nothing to win: cancelling is exactly equivalent to forfeiting the round,
--     which is why it can only ever cost the player the chance to win;
--   * a settled or cancelled round is left alone, so a win already paid stays
--     paid.
-- ============================================================================

create or replace function public.forfeit_open_round()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid     uuid := auth.uid();
  v_round   rounds;
  v_refund  bigint := 0;
  v_n       int := 0;
  v_after   bigint;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  -- Only an ABANDONED round is closed here: one the player has genuinely left.
  -- `abandon_stale_rounds` with no window would let a double-tapped button cancel
  -- the round the first tap just opened, so this uses a short grace period —
  -- longer than any round can be started in, far shorter than the 30-minute rule.
  perform public.abandon_stale_rounds(v_uid, '15 seconds');

  -- Anything still open is recent enough that it may be a live round: report it
  -- rather than close it, so the caller knows to try again in a moment.
  select * into v_round from rounds where user_id = v_uid and status = 'open' limit 1;
  if found then
    return jsonb_build_object('cancelled', 0, 'refunded_px', 0, 'still_open', true);
  end if;

  select coalesce(sum(delta_px), 0) into v_refund
    from ledger
   where user_id = v_uid
     and kind = 'adjustment'
     and meta->>'reason' = 'round abandoned — stake returned'
     and created_at > now() - interval '1 minute';
  select balance_px into v_after from wallets where user_id = v_uid;

  return jsonb_build_object('cancelled', v_n, 'refunded_px', v_refund, 'still_open', false,
                            'balance', coalesce(v_after, 0));
end;
$$;

revoke all on function public.forfeit_open_round() from public, anon;
grant execute on function public.forfeit_open_round() to authenticated, service_role;

comment on function public.forfeit_open_round() is
  'Close the caller''s own abandoned round and refund the stake, so a lost / refreshed / failed spin cannot lock the account out of playing.';
