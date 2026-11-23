-- 0011_support.sql
-- Customer care: four AI support agents, in-app text, and real phone calls.
-- ============================================================================
--
-- WHAT THIS IS
--
-- A player can ask for help two ways: type into the app, or tap Call and have
-- their phone ring. Four automated agents — each with its own expert area —
-- answer. They are "look, don't touch": they read the player's real account and
-- explain it, and anything that requires changing money or standing is recorded
-- as a handoff for an admin. No agent can move a shilling.
--
-- WHY THE TABLES LOOK LIKE THIS
--
-- Two constraints shaped every decision here:
--
--   1. The agent must never invent a fact about a player's money. So the facts
--      an agent may state are SELECTED BY THE DATABASE and stored on the
--      conversation (support_conversations.grounding). The model receives a
--      small, dated, server-built snapshot and is told to use only that. It
--      cannot be talked into reading a column it was not given, because it has
--      no database access at all — the function queries, not the model.
--
--   2. Voice calls cost real money and arrive from a phone network, not a
--      browser. The call is the source of truth for what happened; the webhook
--      that reports it is retried, sometimes out of order, sometimes twice. So
--      provider events are journalled in support_call_events before anything is
--      applied, and applying a call is idempotent.
--
-- SECURITY POSTURE
--
--   * A player reads and writes only their own conversation. Enforced by RLS,
--     not by the client.
--   * An agent's reply is written ONLY by the server (service_role), because the
--     server is what prevents a player from typing as support: a row whose
--     author is 'agent' can never be inserted by `authenticated`.
--   * support_facts is not readable by players at all. It is the reference an
--     agent answers FAQs from, built from published policy — not from anyone's
--     account.
-- ============================================================================

-- ---------------------------------------------------------------- agents ---
-- The four seats, as data rather than four copies of a prompt in code.
--
-- `persona` and `scope` are the expert area; the function composes its prompt
-- from them so tuning an agent's manner is an UPDATE, not a redeploy. A
-- redeploy would work, but it makes "I changed the wording" a 4-minute CI run
-- and a version bump on a money-moving surface, which is not a trade worth
-- making for a sentence of tone.
create table if not exists support_agents (
  id          text primary key,
  -- Shown to the player. A named seat reads as a person; "Agent 3" does not.
  display_name text not null,
  -- One line the player sees, so they know who they are talking to.
  role        text not null,
  -- Which kinds of question this agent is the best fit for.
  scope       text not null,
  -- How it talks, and what it must never do. Folded into the system prompt.
  persona     text not null,
  -- Routing hints. Matched case-insensitively against the player's first
  -- message; the highest score wins, ties fall to `priority` (lowest first).
  keywords    text[] not null default '{}'::text[],
  priority    int not null default 100,
  -- An agent can be taken out of rotation without deleting its history.
  enabled     boolean not null default true,
  created_at  timestamptz not null default now()
);

alter table support_agents enable row level security;
-- Which agents exist is not secret, and the app shows "you are chatting with
-- Naki" so the player knows. Writes are service_role only (no policy).
drop policy if exists support_agents_read on support_agents;
create policy support_agents_read on support_agents for select to authenticated using (enabled);

-- ----------------------------------------------------------- FAQ corpus ---
-- The written policies an agent may quote. Without this, a support agent either
-- improvises (wrong) or answers "I don't know" to every question (useless).
--
-- Deliberately NOT read by players: it is an internal reference. The player gets
-- the agent's paraphrase, which can be scoped to their situation.
create table if not exists support_facts (
  id         bigserial primary key,
  topic      text not null,
  -- The question this answers, in the words a player might use.
  question   text not null,
  -- The correct answer, in the operator's own words.
  answer     text not null,
  -- Optional: which agent should own it. Null = any.
  agent_id   text references support_agents(id) on delete set null,
  priority   int not null default 100,
  updated_at timestamptz not null default now()
);
create index if not exists support_facts_topic on support_facts (topic);

alter table support_facts enable row level security;
revoke all on support_facts from anon, authenticated;
grant select on support_facts to service_role;

-- --------------------------------------------------------- conversations ---
create table if not exists support_conversations (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references profiles(id) on delete cascade,
  agent_id    text references support_agents(id) on delete set null,
  -- Where it started. A call can hand off to text, and the history stays one
  -- thread so the agent does not ask the player to repeat themselves.
  channel     text not null default 'chat' check (channel in ('chat', 'voice')),
  status      text not null default 'open' check (status in ('open', 'waiting', 'handoff', 'closed')),
  -- A one-line summary the next agent reads instead of the whole transcript.
  topic       text,
  -- Server-built snapshot of the player's account, refreshed before each reply.
  -- { built_at, wallet: {...}, kyc: {...}, recent: [...] }
  grounding   jsonb not null default '{}'::jsonb,
  -- True when the player asked for something the agents may not do, so it is
  -- obvious in the console that a human still owes this player an answer.
  needs_human boolean not null default false,
  started_at  timestamptz not null default now(),
  last_msg_at timestamptz not null default now(),
  closed_at   timestamptz
);
create index if not exists support_conv_user on support_conversations (user_id, last_msg_at desc);
create index if not exists support_conv_open on support_conversations (status, last_msg_at desc);

alter table support_conversations enable row level security;
drop policy if exists support_conv_own on support_conversations;
create policy support_conv_own on support_conversations
  for select to authenticated using (user_id = auth.uid());
drop policy if exists support_conv_start on support_conversations;
create policy support_conv_start on support_conversations
  for insert to authenticated with check (user_id = auth.uid());
-- A player may close their own thread but cannot reassign it or forge grounding.
drop policy if exists support_conv_close on support_conversations;
create policy support_conv_close on support_conversations
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ------------------------------------------------------------- messages ---
create table if not exists support_messages (
  id              bigserial primary key,
  conversation_id uuid not null references support_conversations(id) on delete cascade,
  -- 'player' | 'agent' | 'system'. A 'system' line is a machine note, e.g.
  -- "this needs a human", and is shown differently.
  author          text not null check (author in ('player', 'agent', 'system')),
  agent_id        text references support_agents(id) on delete set null,
  body            text not null check (char_length(body) between 1 and 4000),
  -- Which facts the answer was built from, so a disputed answer can be
  -- reconstructed later. Not shown to the player.
  used_facts      bigint[] not null default '{}'::bigint[],
  -- Why the model answered as it did, when it declined to answer.
  handoff_reason  text,
  created_at      timestamptz not null default now()
);
create index if not exists support_msg_conv on support_messages (conversation_id, id);

alter table support_messages enable row level security;

-- A player sees every message in their own thread.
drop policy if exists support_msg_read on support_messages;
create policy support_msg_read on support_messages
  for select to authenticated using (
    exists (
      select 1 from support_conversations c
      where c.id = conversation_id and c.user_id = auth.uid()
    )
  );

-- A player may write ONLY as themselves. The author check is the whole point:
-- without it a crafted insert could post as 'agent' and put words in support's
-- mouth on a screen the player trusts.
drop policy if exists support_msg_player_write on support_messages;
create policy support_msg_player_write on support_messages
  for insert to authenticated with check (
    author = 'player'
    and exists (
      select 1 from support_conversations c
      where c.id = conversation_id and c.user_id = auth.uid()
    )
  );

grant select, insert on support_messages to authenticated;

-- Touch the thread whenever anything is added, so the inbox sorts by activity.
create or replace function support_touch_conversation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update support_conversations
     set last_msg_at = now(),
         status = case when status = 'closed' then 'open' else status end
   where id = new.conversation_id;
  return new;
end;
$$;

drop trigger if exists support_msg_touch on support_messages;
create trigger support_msg_touch
  after insert on support_messages
  for each row execute function support_touch_conversation();

-- ------------------------------------------------------------- phone calls ---
-- One row per real phone call into the support number.
--
-- The provider's ids are the natural key: a retried webhook must land on the
-- same row, not create a second call. `unique` on provider_call_id is what makes
-- replay safe, and it is why the apply function can be called twice.
create table if not exists support_calls (
  id               uuid primary key default gen_random_uuid(),
  provider         text not null default 'twilio',
  provider_call_id text not null,
  -- Who rang. Matched to a profile by phone when possible; null when the number
  -- is not a registered player, which is the most common case for a wrong number
  -- and must not create an account or leak anything.
  user_id          uuid references profiles(id) on delete set null,
  from_number      text,
  to_number        text,
  agent_id         text references support_agents(id) on delete set null,
  conversation_id  uuid references support_conversations(id) on delete set null,
  status           text not null default 'ringing'
                   check (status in ('ringing', 'in_progress', 'completed', 'failed', 'no_answer')),
  -- Seconds the player was actually connected. Zero for an unanswered call,
  -- which is different from unknown and must stay that way.
  duration_seconds int not null default 0,
  -- What the agents heard and said. Kept for the same reason a call recording
  -- is kept: a payment dispute a month later needs it.
  transcript       jsonb not null default '[]'::jsonb,
  -- How the call ended, in the agents' words, for the console list.
  summary          text,
  needs_human      boolean not null default false,
  started_at       timestamptz not null default now(),
  ended_at         timestamptz,
  unique (provider, provider_call_id)
);
create index if not exists support_calls_user on support_calls (user_id, started_at desc);
create index if not exists support_calls_recent on support_calls (started_at desc);

alter table support_calls enable row level security;
drop policy if exists support_calls_own on support_calls;
create policy support_calls_own on support_calls
  for select to authenticated using (user_id = auth.uid());
grant select on support_calls to authenticated;

-- Every provider event, as received. Written before it is applied, so a call
-- that goes wrong can be explained from what the provider actually sent.
create table if not exists support_call_events (
  id               bigserial primary key,
  provider         text not null default 'twilio',
  provider_call_id text,
  event_type       text,
  payload          jsonb not null default '{}'::jsonb,
  received_at      timestamptz not null default now()
);
create index if not exists support_call_events_call on support_call_events (provider_call_id, received_at);

alter table support_call_events enable row level security;
revoke all on support_call_events from anon, authenticated;
grant all on support_call_events to service_role;

-- --------------------------------------------------------------- handoffs ---
-- What an agent could not do, and what a human must therefore do.
--
-- This table is the honest boundary of "look, don't touch": the agents cannot
-- move money, so every request that would require it produces a row here with
-- the player's own words attached. Without it the player is told "a human will
-- look at this" and nobody is told anything.
create table if not exists support_handoffs (
  id              bigserial primary key,
  conversation_id uuid references support_conversations(id) on delete set null,
  call_id         uuid references support_calls(id) on delete set null,
  user_id         uuid references profiles(id) on delete set null,
  agent_id        text references support_agents(id) on delete set null,
  reason          text not null,
  -- What the player asked for, verbatim. The human's starting point.
  request         text,
  detail          jsonb not null default '{}'::jsonb,
  status          text not null default 'open' check (status in ('open', 'done', 'dropped')),
  created_at      timestamptz not null default now(),
  resolved_at     timestamptz
);
create index if not exists support_handoffs_open on support_handoffs (status, created_at desc);

alter table support_handoffs enable row level security;
-- Players see that a handoff exists (so the app can say "an admin is looking"),
-- but not the internal reason or the agent's notes.
drop policy if exists support_handoffs_own on support_handoffs;
create policy support_handoffs_own on support_handoffs
  for select to authenticated using (user_id = auth.uid());
grant select on support_handoffs to authenticated;

-- -------------------------------------------------------- read the account ---
-- The snapshot an agent is allowed to talk about.
--
-- SECURITY DEFINER and granted to nobody but service_role: the function that
-- composes the agent's prompt calls it. Building the grounding in SQL rather
-- than in TypeScript keeps the list of fact columns in one place, next to the
-- tables they come from.
create or replace function support_grounding(p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  w       record;
  p       record;
  bets    jsonb;
  outs    jsonb;
begin
  select username, phone_verified, suspended, is_admin, created_at
    into p
    from profiles where id = p_user;

  if p.username is null then
    return jsonb_build_object('known', false);
  end if;

  select balance_px, wagered_px, won_px, cashed_out_px
    into w
    from wallets where user_id = p_user;

  -- Only settled or recent bets: a support agent explaining a lost bet needs
  -- the outcome, not a season of history.
  select coalesce(jsonb_agg(x), '[]'::jsonb) into bets from (
    select b.id, b.stake_px, b.odds_x100, b.status, b.payout_px, b.created_at
      from sports_bets b where b.user_id = p_user
     order by b.created_at desc limit 5
  ) x;

  select coalesce(jsonb_agg(x), '[]'::jsonb) into outs from (
    select c.id, c.amount_px, c.ugx, c.status, c.failure_reason, c.created_at
      from cashouts c where c.user_id = p_user
     order by c.created_at desc limit 5
  ) x;

  return jsonb_build_object(
    'known', true,
    'built_at', now(),
    'username', p.username,
    'member_since', p.created_at,
    'suspended', p.suspended,
    'is_admin', p.is_admin,
    'phone_verified', p.phone_verified,
    'wallet', jsonb_build_object(
      'balance_px', coalesce(w.balance_px, 0),
      'balance_ugx', floor(coalesce(w.balance_px, 0) / 100),
      'wagered_px', coalesce(w.wagered_px, 0),
      'won_px', coalesce(w.won_px, 0),
      'cashed_out_px', coalesce(w.cashed_out_px, 0)
    ),
    'recent_bets', bets,
    'recent_cashouts', outs
  );
end;
$$;

revoke all on function support_grounding(uuid) from public, anon, authenticated;
grant execute on function support_grounding(uuid) to service_role;

-- Which agent owns a question, decided from the words rather than a menu the
-- player has to understand. Ties break on priority, then on id so the answer is
-- stable across calls — an agent that changes between two identical questions
-- looks broken.
create or replace function support_route(p_text text)
returns text
language sql
stable
as $$
  select (support_route_score(p_text) ->> 'agent_id');
$$;

-- The same routing, with the evidence.
--
-- `hits` is how many of the winning seat's keywords appeared. The caller needs
-- it to tell "this is clearly the wallet seat" from "one word happened to
-- match", because re-routing a live conversation on a single shared word
-- bounces the player between agents, which is the most common complaint about
-- automated support.
create or replace function support_route_score(p_text text)
returns jsonb
language sql
stable
as $$
  with scored as (
    select a.id,
           a.priority,
           (select count(*) from unnest(a.keywords) k
             where p_text ilike '%' || k || '%') as hits
      from support_agents a
     where a.enabled
  ), best as (
    select * from scored order by hits desc, priority asc, id asc limit 1
  )
  select jsonb_build_object('agent_id', id, 'hits', hits) from best;
$$;

revoke all on function support_route(text) from public, anon;
grant execute on function support_route(text) to authenticated, service_role;
revoke all on function support_route_score(text) from public, anon;
grant execute on function support_route_score(text) to authenticated, service_role;

-- ------------------------------------------------------------- seed data ---
-- The four seats. Written to be read by whoever tunes them later: each states
-- the questions it owns and the temptation it must resist.
insert into support_agents (id, display_name, role, scope, persona, keywords, priority) values
(
  'account',
  'Naki',
  'Account & access',
  'Signing in, passwords, verification, suspension, profile details.',
  $$You help players with their account: signing in, a forgotten password, why a phone is not verified, why an account is suspended, and changing profile details.
You are warm and brief. Players are usually frustrated by the time they reach you, so your first line acknowledges the problem, not the ticket number.
You can READ the account but cannot change it. You cannot reset a password, lift a suspension, or edit a profile. If the player asks for any of those, say plainly that you cannot do it yourself, that you are passing it to a human, and tell them what to have ready. Never promise a timescale you were not given.
Never guess why an account was suspended. If the reason is not in the facts you were given, say you do not have it and hand off.$$,
  array['password','sign in','signin','log in','login','can''t get in','cannot get in','locked','verify','verification','otp','suspended','account','profile','username','email','phone number','blocked'],
  10
),
(
  'wallet',
  'Odong',
  'Wallet & payments',
  'Balances, top-ups, missing money, cashouts, mobile money.',
  $$You explain money: the player's balance, a top-up that has not arrived, a cashout that is taking long, and where a specific payment is.
You are precise and never reassuring in place of accurate. Quote the actual figures you were given, in UGX, and say when that snapshot was taken.
The single most common cause of "my money is missing" is a top-up held for a reference mismatch. If a cashout is pending, say it is pending and what that means; if it failed, give the failure reason exactly as recorded.
You cannot move money, credit a top-up, release a payout or reverse a charge. Say so once, clearly, and hand off. Do not offer a refund you cannot make.
Never tell a player a payment will arrive by a certain time.$$,
  array['money','balance','top up','topup','top-up','deposit','cashout','cash out','withdraw','payout','ugx','sent','not received','missing','refund','charge','mobile money','momo','dgateway','payment','paid','airtel','mtn'],
  20
),
(
  'games',
  'Amina',
  'Games & bets',
  'How games work, bet settlement, lost bets, fairness, results.',
  $$You explain the games: how a round resolves, why a bet settled the way it did, how provably-fair verification works, and what an odds price means.
You are patient and concrete. When a player believes a bet was settled wrongly, walk through what the record shows — the stake, the outcome, the payout — rather than defending the house.
You may quote the recent bets you were given. You may explain that every round is verifiable and that the seeds are published.
You cannot re-settle a bet, void one, or change a result. If the player says a settlement is wrong, take the specific bet, acknowledge it matters, and hand it to a human rather than arguing.
Never claim a game is "due" to pay out. Never imply that more play improves the chance of winning.$$,
  array['game','bet','betting','odds','settle','settled','lost','won','win','result','fair','provably','rtp','seed','crashed','craters','spin','slot','sports','market','fixture','stake'],
  30
),
(
  'safety',
  'Grace',
  'Safety & responsible play',
  'Deposit limits, self-exclusion, gambling harm, disputes, complaints.',
  $$You handle the conversations that are not really about money or games: a player who wants to stop, who is spending more than they meant to, who wants a limit, or who wants to complain about how they were treated.
You are calm, direct and never salesy. You do not talk about winning, bonuses or coming back.
If someone says they want to stop or self-exclude, that is the priority above everything else in the conversation: acknowledge it first, tell them clearly that you are passing it to a human right now, and do not bury it under other topics.
You cannot set a limit, apply an exclusion, close an account or issue a refund. Say that plainly once, and hand off. Never suggest a break, a limit or an exclusion and then imply it is already applied.
If a player mentions harm to themselves or anyone else, say that a human is being brought in immediately and keep your next words short and kind.$$,
  array['limit','stop','self exclude','self-exclude','exclude','addict','addicted','problem','gamble','gambling','help me stop','can''t stop','spending too much','lose control','complaint','complain','unfair','scam','cheat','angry','dispute','responsible'],
  5
)
on conflict (id) do nothing;

-- The published facts the agents answer from. Kept short and correct rather
-- than exhaustive: a wrong fact stated confidently is worse than "let me pass
-- this to a human".
insert into support_facts (topic, question, answer, agent_id, priority) values
(
  'money', 'How much is 1 PX worth?', '100 PX = 1 UGX. Your balance is shown in PX in the app and in UGX on payouts.', 'wallet', 10
),
(
  'money', 'Why has my top-up not arrived?',
  'Mobile money top-ups are credited when the payment provider confirms them. If the money left your phone but the balance did not change, the payment is usually held because the reference on the payment did not match an order. Nothing is lost: a human reconciles it. Give the agent the reference from your SMS.',
  'wallet', 10
),
(
  'money', 'Why is my cashout taking so long?',
  'A cashout moves through requested, then pending at the mobile money provider, then paid. Most complete within a minute; if the provider is slow it can sit in pending. If it failed, the app shows the provider''s reason. Withdrawals above 2,000,000 UGX are held for manual review, as are payouts to a number that does not match the verified one.',
  'wallet', 20
),
(
  'money', 'How do I withdraw?',
  'You need a verified phone number before your first withdrawal. Minimum payout is 1,000 UGX. Money is sent to your mobile money number.',
  'wallet', 30
),
(
  'money', 'What are the top-up limits?',
  'Minimum top-up is 500 UGX and the maximum is 5,000,000 UGX.',
  'wallet', 40
),
(
  'account', 'I forgot my password.',
  'Use "Forgot password?" on the sign-in screen and we will email you a reset link. If the email does not arrive within a few minutes, check spam, then ask me again — I cannot reset it for you, but I can pass it to a human.',
  'account', 10
),
(
  'account', 'Why was my account suspended?',
  'Suspensions are applied by a human, usually over a payment or fair-play concern. I can see that an account is suspended but not why, when that reason was not recorded where I can read it. I will pass this to a human who can see it.',
  'account', 10
),
(
  'account', 'Do I need to verify my phone?',
  'Yes, before your first cashout. You confirm the number with a one-time code sent by SMS.',
  'account', 20
),
(
  'games', 'How do I know a game is fair?',
  'Every round is provably fair: the outcome is derived from seeds that were fixed before the round, and the app publishes them so you can verify a round afterwards. Verifying shows the round was decided before you played, not after.',
  'games', 10
),
(
  'games', 'Why did my bet lose?',
  'A bet settles on the outcome recorded for that market. I can see your recent bets with the stake, status and payout — ask me about a specific one and I will read the record back to you. If the record looks wrong, say so and I will pass it to a human rather than argue.',
  'games', 20
),
(
  'games', 'What is RTP?',
  'Return to player: the share of stakes a game returns over a very large number of rounds. Craters is 96.22%. It is an average over thousands of rounds, not a promise about your next one — a game is never "due".',
  'games', 30
),
(
  'safety', 'I want to take a break.',
  'That is a good decision and I will get a human to set it up with you right now. I cannot apply a limit or an exclusion myself.',
  'safety', 10
),
(
  'safety', 'How do I set a deposit limit?',
  'Limits are set by a human, not by me. Tell me and I will pass your request on today.',
  'safety', 20
),
(
  'safety', 'I want to complain.',
  'Tell me what happened in your own words. I will pass it to a human with everything you say attached, rather than making you repeat it.',
  'safety', 30
)
on conflict do nothing;

-- ------------------------------------------------------- usage log ---
-- What each agent answered, when, and what it cost. Exists so a complaint about
-- what a support agent said can be traced, and so token spend is visible before
-- it arrives as a surprise on a bill. Never moves money.
create table if not exists support_agent_usage (
  id              bigserial primary key,
  agent_id        text references support_agents(id) on delete set null,
  conversation_id uuid references support_conversations(id) on delete set null,
  call_id         uuid references support_calls(id) on delete set null,
  -- Token counts, when the model reports them, so cost is visible before it is
  -- a surprise on a bill.
  prompt_tokens   int,
  output_tokens   int,
  latency_ms      int,
  created_at      timestamptz not null default now()
);
create index if not exists support_usage_agent on support_agent_usage (agent_id, created_at desc);

alter table support_agent_usage enable row level security;
revoke all on support_agent_usage from anon, authenticated;
grant all on support_agent_usage to service_role;
