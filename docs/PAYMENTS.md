# DGateway payments

> **Current key is LIVE (`dgw_live_...`).** Real money moves. Read
> "Live-mode guards" below before deploying.

Four server routes under `/api`. The API key lives **only** in server env and is
never bundled into the browser — verified by grepping `dist/` for the key.

| Route | Method | Purpose |
|---|---|---|
| `/api/collect` | POST | Charge a customer (top-up). Opens the mobile-money prompt. |
| `/api/disburse` | POST | Pay a customer out (withdrawal) to any MTN/Airtel number. |
| `/api/status?reference=` | GET | Status proxy the client polls every 10s. |
| `/api/webhooks/dgateway` | POST | Receiver: verifies the signature, credits the order. |

---

## Environment variables

Set these in **Vercel → Project → Settings → Environment Variables**. Never
prefix them with `VITE_`.

| Name | Value |
|---|---|
| `DGATEWAY_API_URL` | `https://dgatewayapi.desispay.com` |
| `DGATEWAY_API_KEY` | your `dgw_...` key |
| `DGATEWAY_WEBHOOK_SECRET` | the webhook signing secret from DGateway |
| `APP_URL` | `https://shoppa-ten.vercel.app` (used to build `callback_url`) |
| `SUPABASE_URL` | `https://<ref>.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | service role key — **server only** |

`DGATEWAY_WEBHOOK_SECRET` is **required in live mode**. See the guards below.

## Live-mode guards

`isLiveMode()` is true when `DGATEWAY_API_KEY` starts with `dgw_live_`. In that
state the server refuses to take money unless it can verify the result:

| Guard | Behaviour |
|---|---|
| `assertLiveSafety()` | Live key + no `DGATEWAY_WEBHOOK_SECRET` => `/api/collect` and `/api/disburse` return **503 `WEBHOOK_SECRET_MISSING`** and **no charge is attempted**. |
| Webhook signature | Always fail-closed. No secret means 401 on every webhook. |
| Top-up ceiling | 5,000,000 UGX max, 500 UGX min per charge. |
| Payout ceiling | 2,000,000 UGX max per payout; larger amounts need manual review. |
| Amount integrity | Webhook re-fetches from DGateway and rejects on amount/currency mismatch. |

The reasoning: a live key with an unverifiable webhook is the one combination
where a player can be charged and never credited. Rather than let that happen
quietly, payments stop and say why.

Sandbox keys (`dgw_test_`) skip only the secret requirement, for local dev.

## Registering the webhook

In the DGateway dashboard set the callback URL to:

```
https://shoppa-ten.vercel.app/api/webhooks/dgateway
```

The route also sends this same URL on every collect, so it is registered per
payment too.

## Phone numbers

Accepted: `07XXXXXXXX`, `2567XXXXXXXX`, `+2567XXXXXXXX`, plus KE/TZ/RW
(`254`, `255`, `250`).

**The leading `0` is preserved.** DGateway routes on the prefix, so stripping it
breaks `07...` input. `normalizePhone()` is covered by tests.

## Amounts

Mobile money is whole units (UGX/KES/TZS). Stripe USD is cents. Either way the
value must be a positive integer — `50.5` is rejected with 400 before any
upstream call is made.

## Status polling

The client polls **our** `/api/status`, never DGateway. Two layers keep us inside
the 10-second rule:

1. `usePaymentPoll` waits `POLL_MS = 10_000` between ticks and stops after 5
   minutes.
2. `/api/status` memoises each reference for 10 seconds and collapses concurrent
   polls into one upstream request, so extra browser tabs cannot multiply the
   rate.

While waiting, the UI says **"Check your phone and approve the prompt"** — not a
generic spinner.

## Webhook order of operations

1. Verify `X-DGateway-Signature` = HMAC-SHA256(raw body, secret). Fail closed.
2. Look up `payment_orders.reference`. Unknown → 404, nothing credited.
3. If the order is already terminal → return `{ idempotent: true }`.
4. Re-fetch the transaction from DGateway (never trust the body alone).
5. Compare amount and currency. Mismatch → mark failed, 409, no credit.
6. `pending` → 200 `{status:"pending"}`, DGateway calls again.
7. `completed`/`failed` → call `apply_gateway_result()`, which is atomic and
   idempotent.

## Database

`supabase/migrations/0002_payment_orders.sql` adds:

- `payment_orders` — one row per DGateway reference, RLS: read own only, no
  client write.
- `record_collect()`, `record_disburse()` — called by the server routes.
- `apply_gateway_result()` — the only function that credits a completed deposit
  or finalises/refunds a cashout hold. Granted to `service_role` only.

Deposits convert at the platform peg: **10 PX = 1 UGX**, so a 5,000 UGX top-up
credits 50,000 PX.

---

## Testing

```bash
npm run typecheck:api   # typecheck the server routes
npm run test:live       # live-mode guards: 503 without a secret, ceilings
npm run test:dg         # phone/amount/status normalisation (24 assertions)
npm run test:routes     # auth gating, payload shape, 10s memoisation (28)
npm run test:webhook    # signature, idempotency, mismatch, fulfil (13)
```

All of the above pass. The route tests mock `fetch`, so they run offline and
assert the exact payload sent to DGateway — including that the leading `0`
survives and that decimals are rejected before an upstream call.

## First live call

Take **one small payment** and watch it end-to-end before letting players in:
start a 1,000 UGX top-up, approve the prompt, confirm the webhook returns 200
and the balance increases by exactly 10,000 PX (10 PX = 1 UGX). Then run the
same test for a 1,000 UGX payout. Only then open it up.

Check `/api/status` on a known reference with:

```bash
curl -H "Authorization: Bearer <supabase access token>" \
     "https://shoppa-ten.vercel.app/api/status?reference=YOUR-REF"
```
