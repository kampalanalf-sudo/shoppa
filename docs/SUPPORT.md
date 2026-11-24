# Customer care: four agents, text and phone

Four automated support agents answer players in-app and on a real phone number.
They can **read** an account and explain it. They can **change nothing** — no
money moves, no password resets, no suspensions lifted. Anything that needs a
change becomes a handoff row for a human.

| Seat | Name | Owns |
| --- | --- | --- |
| `safety` | Grace | Deposit limits, self-exclusion, harm, complaints. Routed first. |
| `account` | Naki | Sign-in, passwords, verification, suspension questions. |
| `wallet` | Odong | Balances, top-ups, missing money, cashouts. |
| `games` | Amina | Game rules, bet settlement, fairness, RTP. |

The seats live in `support_agents` (migration `0011_support.sql`), not in code.
Editing what an agent says is an `UPDATE`, not a deploy.

---

## The rule that makes this safe

An agent may never invent a fact about a player's money.

It is enforced structurally, not by instruction alone:

1. The **database** builds the snapshot: `support_grounding(user_id)` returns the
   wallet totals, five recent bets, five recent cashouts, and the verification
   and suspension flags. It is granted to `service_role` only.
2. The function passes that snapshot to the model as the **only** truth about the
   player, and tells it so in as many words.
3. The model is called with **no tools**. It cannot query, look up, or fetch
   anything. If a figure is not in the snapshot, it does not have the figure and
   must hand off.
4. The published FAQ it may quote comes from `support_facts`, filtered to its own
   area. It cites entries by `[id]`, and the ids it used are stored on the
   message, so a disputed answer can be reconstructed later.

`smoke/edge.ts` asserts each of those rules against the real generated bundle, so
a future edit that quietly drops one fails the build.

### Why a refusal is the system working

`support.ts` asks the model to end a declined answer with a `HANDOFF:` line. The
function strips that line (the player never sees it, and a phone never says the
word "handoff"), stores the reason, flags the conversation `needs_human`, writes
a `support_handoffs` row with the player's own words, and posts a visible
"Passed to a human" line into the thread.

If the model is down, unconfigured, or too slow, the player still gets a reply —
an honest one saying a human has it — and the handoff row still exists. A 502 in
a support chat is the one place an error is least forgivable.

---

## In-app chat

A player reaches the agents from the floating **Help** button on every screen, from
the footer (Help Centre, Live Chat, Responsible Gaming, Self Exclusion, Contact
Us) or at `#support`. The button carries a badge when an agent has answered while
the player was elsewhere — that badge is what makes a reply discoverable mid-game.

Three things make it a conversation rather than a form:

| | |
| --- | --- |
| **Resumable** | Opening support sends `resume: true` and gets the live thread back. Reloading, closing the app or navigating away does not lose what you said. A thread is live for **12 hours**; after that a new message starts a fresh one, so an agent is never asked to recall a fortnight-old mood. |
| **Live** | `support_messages` is in the realtime publication and the client subscribes filtered to its own conversation. An agent's reply appears without a refresh. RLS applies to the stream, so a player cannot subscribe into someone else's thread. |
| **Throttled** | 8 player messages per rolling minute, enforced in SQL (`support_can_speak`) by counting the messages themselves. Checked **before** the model is called, because a limit that runs after the spend is not a limit. Two taps in the same instant cannot both pass. A throttled message is `429 RATE_LIMITED` with the server's own sentence, shown verbatim. |

"New" closes the thread on the server as well as the screen. Clearing only the
screen would look like a new conversation and then `resume` would drag the old one
back the next time the screen opened.

The transcript is a `role="log"` live region, so an agent's reply is announced
rather than only appearing.

### What a player can and cannot write

The RLS policy on `support_messages` allows a player to insert **only** rows with
`author = 'player'`, and only into a conversation they own. Agent replies are
written by the server. That is what stops a crafted insert from putting words in
support's mouth on a screen the player trusts.

## Turning the phone line on

The voice side is a Twilio webhook. Until these are set, `support-voice` answers
`503 VOICE_NOT_CONFIGURED` and refuses every call — it fails closed.

### 1. Secrets

| Secret | What it is |
| --- | --- |
| `GROQ_API_KEY` | Required for **both** text and voice. Free at <https://console.groq.com/keys>; starts with `gsk_`. Without it, replies fall back to "a human has it". |
| `GROQ_MODEL` | Optional. Default `llama-3.1-8b-instant`. See "Cost" below before changing it. |
| `TWILIO_ACCOUNT_SID` | Required for voice. |
| `TWILIO_AUTH_TOKEN` | Required for voice. Also **the HMAC key** that signs every call, so without it no call is accepted. |
| `SUPPORT_PUBLIC_URL` | Optional but recommended. Set to `https://<project-ref>.supabase.co/functions/v1/support-voice` if Twilio was configured with that exact base. The signature covers the URL Twilio called, so a mismatch rejects every call. |

Set them in the Supabase dashboard (Edge Functions → Secrets), or with
`create_secrets` from the Supabase connector.

### 2. The number

1. Buy a Ugandan (or any) voice number in the Twilio console.
2. Set its **A call comes in** webhook to:

   ```
   https://<project-ref>.supabase.co/functions/v1/support-voice?op=answer
   ```

   method **POST**.
3. Set **Call status changes** to the same URL with `?op=status`.

That is all. `answer` greets and listens, `turn` is re-posted automatically by
the `<Gather>` each time the caller speaks, and `status` records duration and
outcome.

### 3. Speech

The reply is spoken with `Polly.Joanna`. Twilio bills per character, so replies
are capped at 400 tokens and a call is capped at 8 spoken turns — after which the
caller is told a human will follow up and the call ends. A silent caller is
prompted once, then hung up on rather than billed for listening.

### Webhook safety

Every request is verified against Twilio's signature over the **raw form body**
and the exact URL. The body is journalled into `support_call_events` *before* it
is applied, and the call row is keyed on `(provider, provider_call_id)`, so a
retried or out-of-order webhook is a no-op rather than a duplicate call.

A caller from a number that is not a registered player is still answered — it is
usually a wrong number — but never gets an account snapshot, because the phone
match simply finds no profile.

---

## What a human still has to do

The agents cannot act, so somebody must work the queue:

```sql
-- what players are waiting on
select h.created_at, h.reason, h.request, p.username, h.agent_id
  from support_handoffs h
  left join profiles p on p.id = h.user_id
 where h.status = 'open'
 order by h.created_at;

-- mark one done once handled
update support_handoffs set status = 'done', resolved_at = now() where id = <id>;
```

There is deliberately **no UI** for this yet. The admin console's existing
screens cover money and players; a handoff inbox is the natural next screen, and
building it before a human has used the queue for a week would guess at what they
need. `support_handoffs` is the data that screen will read.

---

## Cost: why Groq, and which model

The agents run on **Groq's free tier**. It is free at the margin, fast enough that
a phone caller is not left in silence, and the API is OpenAI-compatible — so
changing provider again means editing one function, not a rewrite.

Model choice here is about the **daily cap**, not raw quality:

| Model | Requests/day | Tokens/day | Use |
| --- | --- | --- | --- |
| `llama-3.1-8b-instant` *(default)* | 14,400 | 500K | Short, factual answers from a small snapshot |
| `llama-3.3-70b-versatile` | 1,000 | 100K | Better prose; runs out of tokens in one busy afternoon |

A support agent answers "what is my balance" and "why did this bet settle this
way" from a snapshot of a few hundred tokens. That is the 8B model's home turf,
and it has 14x the daily allowance. Switch with `GROQ_MODEL` if the answers read
too terse — but do the arithmetic first: 100K tokens/day across four agents is a
few hundred conversations, not a few thousand.

### When the free tier runs out

Groq returns `429` when the allowance is spent. That is treated as a **quota**
condition, not an outage: the player is told a human has it, the handoff row is
written, and the failure is logged as `SUPPORT_QUOTA` so it is distinguishable
from a broken key or a network fault. Nothing is silently dropped.

If support volume outgrows the free tier, the options in order of cheapness are:
raise `GROQ_MODEL` to a model with a bigger daily token budget, add a second key
and rotate on 429, or move to a paid tier. The throttle below keeps the ceiling
predictable either way.

## Cost and blast radius

- Text: one model call per player message. History capped at 10 turns, FAQ at 20
  entries, grounding at 5 bets + 5 cashouts.
- Voice: one model call per spoken turn, capped at 8 turns per call.
- `support_agent_usage` records token counts per agent, so spend is visible
  before it arrives as a surprise on a bill.

`support_agent_usage` and `support_call_events` are `service_role` only. Players
read their own conversation, their own messages and their own calls — enforced by
RLS — and can write messages **only** as `author = 'player'`. An agent reply can
only be inserted by the server, which is what stops a player from typing as
support on a screen they trust.

---

## Tests

```bash
npm run test:edge    # bundles boot, gates refuse, prompt rules intact
npm run test:api     # client error handling, including BOOT_ERROR
npm run test:live    # live-mode payment guards
```

`test:edge` loads the exact file the deploy workflow uploads, so a failure there
is a failure in production.
