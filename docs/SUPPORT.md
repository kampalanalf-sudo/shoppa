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

## Turning the phone line on

The voice side is a Twilio webhook. Until these are set, `support-voice` answers
`503 VOICE_NOT_CONFIGURED` and refuses every call — it fails closed.

### 1. Secrets

| Secret | What it is |
| --- | --- |
| `ANTHROPIC_API_KEY` | Required for **both** text and voice. Without it, text replies fall back to "a human has it". |
| `SUPPORT_MODEL` | Optional. Default `claude-3-5-haiku-latest`. |
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
