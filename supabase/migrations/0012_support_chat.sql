-- 0012_support_chat.sql
-- What in-app chat needs beyond a first version of support.
-- ============================================================================
--
-- 0011 gave the agents a conversation, messages and a phone line. This adds the
-- three things that separate "a chat screen" from "chat you can rely on":
--
--   1. RESUME. A chat you cannot come back to is a chat you have to repeat
--      yourself in. The client sends `resume: true` and gets its live thread
--      back; the function continues an existing thread rather than opening a
--      second one.
--
--   2. A LIMIT. Every player message is a model call, so an unthrottled box is
--      a bill and a denial-of-service against ourselves. Counted in SQL, from
--      the messages themselves, so two taps in the same instant cannot both
--      pass — an application-memory counter would race.
--
--   3. REALTIME. An agent's answer must appear without the player reloading.
--      RLS still applies to the stream, so a player receives only the threads
--      they are allowed to read.
--
-- Nothing here moves money or grants a new capability. It is availability work.
-- ============================================================================

-- ------------------------------------------------------------- rate limit ---

create or replace function support_can_speak(p_user uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  recent int;
begin
  -- 8 player messages per rolling minute, per player.
  --
  -- Counted from support_messages rather than a counter column on purpose: the
  -- messages ARE the record, so there is no window in which a counter and the
  -- truth disagree, and no cleanup job to forget to run.
  select count(*) into recent
    from support_messages m
    join support_conversations c on c.id = m.conversation_id
   where c.user_id = p_user
     and m.author = 'player'
     and m.created_at > now() - interval '1 minute';

  return recent < 8;
end;
$$;

-- Service role only: the limit must be applied by the server that also spends
-- the money, not by a client that could simply skip the check.
revoke all on function support_can_speak(uuid) from public, anon, authenticated;
grant execute on function support_can_speak(uuid) to service_role;

-- ---------------------------------------------------------------- realtime ---

do $$ begin
  alter publication supabase_realtime add table support_messages;
exception when duplicate_object then null; end $$;

-- ------------------------------------------------------------ live threads ---
-- Finding "the player's live thread" is now the most common read in this
-- feature: once on every app open, and once per message. It is a filter on
-- user_id + status + recency, so the index matches that shape rather than
-- leaving it to a sequential scan.
create index if not exists support_conv_live
  on support_conversations (user_id, last_msg_at desc)
  where status <> 'closed';

-- Reading a thread's messages in order is the other one. `id` is the tiebreak
-- because two messages can share a timestamp, and an unstable order makes the
-- transcript look like it was shuffled.
create index if not exists support_msg_thread
  on support_messages (conversation_id, id);
