# ZENGAPAY payments

> **Real money moves.** Read "Live-mode guards" and "IP whitelisting" below
> before deploying.

All payment traffic goes through one shared client,
`supabase/functions/_shared/zengapay.ts`, and runs as Supabase Edge Functions.
The API token lives **only** in function secrets and is never bundled into the
browser.

| Route | Method | Purpose |
|---|---|---|
| `?op=collect` on `pay` | POST | Charge a customer (top-up). Opens the mobile-money prompt. |
| `?op=disburse` on `pay` | POST | Pay a customer out (withdrawal). |
| `?op=checkout` on `pay` | POST | Create a hosted checkout session, return its URL. |
| `?op=status` on `pay` | GET | Status proxy the client polls every 10s. |
| `?op=claim` on `pay` | POST | Recover a hosted top-up by its reference. |
| `webhooks-zengapay` | POST | Receiver: verifies the signature, credits the order. |
| `webhooks-zengapay-store` | POST | Same, kept for the old store URL. |

The browser still calls the friendly paths (`/api/collect`, `/api/status`, …);
`src/lib/backend.ts` maps them onto those functions. One mapping table, one
place to keep honest.

---

## Environment variables

Set these as **Supabase Edge Function secrets** (`supabase secrets set`) — not in
the browser, and never with a `VITE_` prefix.

| Name | Value |
|---|---|
| `ZENGAPAY_API_URL` | `https://api.zengapay.com/v1` (sandbox: `https://api.sandbox.zengapay.com/v1`) |
| `ZENGAPAY_API_TOKEN` | your `ZPYPUBK-…` token from Dashboard → Settings → API Settings |
| `ZENGAPAY_WEBHOOK_SECRET` | the **Secret Hash** from Dashboard → Developer Settings |
| `APP_URL` | `https://floatbet.space` (builds checkout return URLs — must be the domain players use) |
| `SUPABASE_URL` | `https://<ref>.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | service role key — **server only** |

`ZENGAPAY_WEBHOOK_SECRET` is **required in live mode**. See the guards below.

**Sandbox and production keys are separate.** Using one against the other
returns `401` with a `data.env` field, and `isLiveMode()` treats "pointed at
sandbox" as non-live so the strict guards can relax for local work.

## Live-mode guards

In live mode the server refuses to take money unless it can verify the result:

| Guard | Behaviour |
|---|---|
| `assertLiveSafety()` | Live + no `ZENGAPAY_WEBHOOK_SECRET` ⇒ collect / disburse / checkout return **503 `WEBHOOK_SECRET_MISSING`** and **no charge is attempted**. |
| Webhook signature | Always fail-closed. No secret means 401 on every webhook. |
| Top-up ceiling | 5,000,000 UGX max, 500 UGX min per charge. |
| Payout ceiling | 2,000,000 UGX max per payout; larger amounts need manual review. |
| Amount integrity | Webhook re-fetches from ZENGAPAY and rejects on amount/currency mismatch. |

A live token with an unverifiable webhook is the one combination where a player
can be charged and never credited. Rather than let that happen quietly, payments
stop and say why.

## IP whitelisting — required for payouts

**ZENGAPAY requires the source IP to be whitelisted before it will accept a
transfer.** Collections work without it; `POST /transfers` returns `401`/`403`
until the account's "Allowed IPs" list in the dashboard contains the address the
request comes from.

That address is Supabase's egress IP, not the player's and not yours. If
withdrawals fail while top-ups succeed, this is the cause — not the token.

## The webhook

Unlike DGateway, the callback URL is **not sent per request**. Set it once:

1. Dashboard → Account Settings → **Developer Settings**
2. Set **Webhook URL** to
   `https://<project-ref>.supabase.co/functions/v1/webhooks-zengapay`
3. Set a **Secret Hash** — the same value as `ZENGAPAY_WEBHOOK_SECRET`
4. Enable webhooks

Only `https` URLs are accepted. The endpoint must answer `200`/`201`/`202`; any
other status is retried up to 3 times, then dropped.

### Signature

`X-ZENGAPAY-SIGNATURE` is **HMAC-SHA256 over three fields concatenated, in
order, with no separator**:

```
transactionReference + msisdn + amount
```

It is **not** a signature over the raw request body. Signing the raw body — the
obvious guess, and what the old DGateway code did — fails every verification, so
no top-up is ever credited. `verifyWebhookSignature()` in `_shared/zengapay.ts`
builds the signed string from the parsed `data` object, and compares in constant
time. Missing fields, a bad header, or an absent secret all return `false`.

### Payload

```json
{
  "event": "collection.success",
  "data": {
    "transactionReference": "20570a12-…",
    "transactionStatus": "SUCCEEDED",
    "amount": "5000",
    "msisdn": "256392003738",
    "MNOTransactionReferenceId": "13981886537",
    "currencyCode": "UGX-MTNMM"
  }
}
```

Events: `collection.success`, `collection.failed`, `transfer.success`,
`transfer.failed`. The `data` object carries no `direction` field, so the
**event name** decides whether the transaction is re-fetched from `/collections`
or `/transfers` — asking the wrong one 404s.

### Rules the receiver follows, in order

1. Verify the signature over `transactionReference + msisdn + amount` (fail closed).
2. Match `transactionReference` against the order we stored.
3. **Re-fetch** the transaction from ZENGAPAY and trust only that response.
4. Fulfil **only** on `SUCCEEDED`; `FAILED` is final; `INDETERMINATE` stays pending.
5. Be idempotent — a repeated reference must never credit twice.

The webhook body is a claim. The API is the truth. Step 3 is not optional, and a
failure there returns `502` so ZENGAPAY retries rather than us guessing.

## Statuses

| ZENGAPAY | Ours | Meaning |
|---|---|---|
| `SUCCEEDED` | `completed` | Settled. Credit. |
| `FAILED` | `failed` | Final. Never credit. |
| `PENDING` | `pending` | Still processing. |
| `INDETERMINATE` | `pending` | **Unknown** outcome — reconcile, do not guess |

`INDETERMINATE` is deliberately not treated as failed. Refunding a payment that
actually succeeded, or crediting one that failed, are both worse than waiting.

## Hosted checkout

Replaces the old DGateway storefront link. `POST /v1/checkout/sessions` returns a
one-time `checkout.zengapay.com/pay/cs_…` URL; the player pays there and we never
see their PIN.

`return_url` and `cancel_url` **must** contain the literal
`CHECKOUT_SESSION_ID` placeholder — the provider substitutes it. The session id
is stored as the order reference because it exists *before* the payment does, so
the order can be looked up while the player is still paying.

In the app the mobile-money prompt is the primary button and hosted checkout is
offered underneath it, because checkout can fail server-side (no session ⇒
nothing to navigate to) while the prompt is the shorter path for most players.

## Phone numbers

**ZENGAPAY wants digits only, international format, no `+` and no leading `0`:**

| Input | Sent as |
|---|---|
| `0771234567` | `256771234567` |
| `+256771234567` | `256771234567` |
| `256771234567` | `256771234567` |
| `077123456` (short) | rejected |

This is the **opposite** of the old DGateway rule, which required the leading `0`
to be preserved. Uganda only, deliberately: this app pays UGX wallets, and a
plausibly-wrong number is money sent to a stranger. `normalizePhone()` returns
`null` for anything it does not recognise, and the callers refuse the request
rather than sending a guess.

## Idempotency and double-tap protection

`external_reference` **must be unique per request**; ZENGAPAY rejects a repeat.
It is set to our own `order_id` (`TOP-…` / `PAY-…`), and admin payouts append a
timestamp so an admin double-tap cannot pay one cashout twice.

## Migrations

```
supabase/migrations/0002_payment_orders.sql
supabase/migrations/0003_store_topups.sql
```

Without `0003` the store webhook returns 503 on every call.

## Deploying

The functions deploy from `.github/workflows/deploy-functions.yml`, which
bundles each function with its shared modules inlined (`_shared/*` cannot be
uploaded as a relative import). Set the secrets first:

```bash
supabase secrets set \
  ZENGAPAY_API_URL=https://api.zengapay.com/v1 \
  ZENGAPAY_API_TOKEN=ZPYPUBK-... \
  ZENGAPAY_WEBHOOK_SECRET=...
```

Then set the webhook URL and secret hash in the ZENGAPAY dashboard, and whitelist
the egress IPs if you intend to enable withdrawals.
