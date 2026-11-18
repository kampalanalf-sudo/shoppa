# Production setup

This is the runbook for taking Shopper from a static demo to a live money
product. **Nothing here is optional** — without it, sign-in, chat, gifting and
cashing out are inert and the app falls back to local-only play.

---

## 1. Supabase project

The account tied to this conversation is at its **2 free-project limit**, so a
project could not be created automatically. Either pause one of the existing
projects (`proxicore-outbreak-system`, `proxitalk-mesh-cloud`) in the Supabase
dashboard, or upgrade the org, then create a project and copy its URL + anon key
into `.env.local`:

```
VITE_SUPABASE_URL=https://<ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key>
```

## 2. Apply the schema

`supabase/migrations/0001_core.sql` is idempotent and safe to re-run. Apply it
with either:

```bash
supabase link --project-ref <ref>
supabase db push
```

or paste the file into **SQL Editor → Run**.

It creates `profiles`, `wallets`, `ledger`, `chat_messages`, `gifts`, `cashouts`
and `rounds`, plus RLS and the money functions. New auth users are seeded with a
profile and a **10,000 PX** welcome grant by the `handle_new_user()` trigger.

## 3. Auth providers

**Email**: on by default. Set the site URL and redirect allow-list under
*Authentication → URL Configuration*:

```
Site URL:            https://shoppa-ten.vercel.app
Redirect URLs:       https://shoppa-ten.vercel.app/**
                     http://localhost:5173/**
```

**Google**: *Authentication → Providers → Google*. Create an OAuth client in
Google Cloud Console, add
`https://<ref>.supabase.co/auth/v1/callback` as an authorised redirect URI, then
paste the client ID and secret into Supabase.

**Phone OTP** (required before a first cashout): *Authentication → Providers →
Phone*. Supabase needs an SMS provider — Twilio, MessageBird, Vonage or Textlocal.
Ugandan numbers work; expect roughly UGX 100–200 per OTP.

## 4. DGateway secrets

These are server-side only. Set them as **edge function secrets**, never in
`.env`:

```bash
supabase secrets set \
  DGATEWAY_API_KEY=... \
  DGATEWAY_WEBHOOK_SECRET=... \
  DGATEWAY_API_URL=https://dgatewayapi.desispay.com \
  DGATEWAY_ALLOW_TEST_PAYMENTS=false \
  APP_URL=https://shoppa-ten.vercel.app
```

You said these are the same credentials Tank Tickets uses. They are not in any
repository — only in that project's Vercel env and Supabase secrets — so paste
them in yourself. **Do not paste them into chat.**

## 5. Deploy the functions

```bash
supabase functions deploy cashout
supabase functions deploy cashout-webhook
supabase functions deploy cashout-status
```

`cashout` and `cashout-status` verify the caller's JWT. `cashout-webhook` is
public by necessity, so it authenticates by HMAC signature and then re-fetches
the transaction from DGateway before releasing money. It **fails closed** if
`DGATEWAY_WEBHOOK_SECRET` is unset.

Register the webhook URL in the DGateway dashboard:

```
https://<ref>.supabase.co/functions/v1/cashout-webhook
```

## 6. Money model

| Concept | Value |
|---|---|
| Peg | **10 PX = 1 UGX** |
| Welcome grant | 10,000 PX = 1,000 UGX |
| Minimum cashout | 10,000 PX = 1,000 UGX |
| Payout fee | 1% (ProxiCash rail fee) |

Every balance change writes a `ledger` row with `delta_px` and `balance_after`.
The browser never writes a balance column: all mutations go through
`place_bet`, `settle_round`, `send_gift`, `claim_gift`, `refund_gift`,
`request_cashout` and `settle_cashout`, all `SECURITY DEFINER` and all row-locked
so concurrent spins cannot double-spend.

`settle_cashout` is deliberately **not** granted to `authenticated` — only the
service role (the webhook) can finalise a payout.

---

## ⚠️ Before you take real money

This system pays real UGX to mobile money wallets. In Uganda that is regulated
gambling under the **Lotteries and Gaming Act**: you need an NLC operator
licence, player KYC/AML, responsible-gambling controls and a data-protection
posture. The code implements 18+ gating, phone verification, cashout holds,
idempotent webhooks, an immutable ledger and an audit trail — that is good
engineering, but **it is not a licence and not a compliance programme**.

Get legal advice before flipping `DGATEWAY_ALLOW_TEST_PAYMENTS` to false and
putting real cash through the rails.
