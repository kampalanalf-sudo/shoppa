# FloatBet go-live runbook

Exact steps, in order. Nothing here is optional — each step is a hard dependency
for the next.

> **Current state:** none of the SQL below has ever been applied, and no real
> DGateway call has ever succeeded from this project. The first live payment will
> be the first time this code meets the real API. Step 9 is not optional.

---

## 0. Pick your Supabase project first

You have **no Supabase project for FloatBet** yet. These two projects exist in
the connected account (`zioruvnvcefrdlxmvhes`, eu-west-1):

| Project | Ref |
|---|---|
| proxicore-outbreak-system | `sshnsototbqlznadyysk` |
| proxitalk-mesh-cloud | `hsgcsyhyzsftinisksty` |

**Do not reuse either.** They belong to other apps, and the migration creates
`wallets`, `ledger`, `payment_orders` and `store_topups` — pointing FloatBet at
one would put two apps' money in one database.

Create a **new** project (free plan allows it), region `eu-west-1`, then use its
ref everywhere `PROJECT_REF` appears below.

Once it exists, note from **Project Settings → API**:

- `SUPABASE_URL` = `https://PROJECT_REF.supabase.co`
- `anon public` key → goes in the browser as `VITE_SUPABASE_ANON_KEY`
- `service_role` key → **server only**, `SUPABASE_SERVICE_ROLE_KEY`

⚠️ The `service_role` key bypasses every RLS policy. It must never appear in the
frontend, in a commit, or in a `VITE_` variable.

---

## 1. Apply the migrations (in order, in the Supabase SQL editor)

Run each file's **entire contents**, one after another. Order matters: 0002
depends on the enums from 0001, and 0004 alters what 0003 created.

```
supabase/migrations/0001_core.sql
supabase/migrations/0002_payment_orders.sql
supabase/migrations/0003_store_topups.sql
supabase/migrations/0004_store_topup_admin.sql
```

Verify afterwards — this must return 4 rows:

```sql
select table_name from information_schema.tables
where table_schema = 'public'
  and table_name in ('wallets','payment_orders','store_topups','store_topup_actions')
order by 1;
```

And this must return 7 (the credit/claim/admin paths):

```sql
select proname from pg_proc
where proname in (
  'record_collect','record_disburse','apply_gateway_result',
  'apply_store_topup','claim_store_topup','admin_release_store_topup','dismiss_store_topup'
)
order by 1;
```

---

## 2. Auth settings (Supabase → Authentication → Providers / URL Configuration)

| Setting | Value |
|---|---|
| Email provider | **Enabled** |
| Confirm email | **Enabled** (you asked for verification) |
| Google provider | **Enabled** — paste Client ID + Secret from Google Cloud |
| Site URL | `https://shoppa-ten.vercel.app` |
| Redirect URLs (allow list) | `https://shoppa-ten.vercel.app/**` |
| | `http://localhost:5173/**` |

Google Cloud side: create an OAuth 2.0 Client (Web application) with authorized
redirect URI `https://PROJECT_REF.supabase.co/auth/v1/callback`.

---

## 3. DGateway settings — this is the part you asked about

DGateway → **My Apps → Settings**, and the FloatBet product.

### 3a. App-level settings

| Field | Value |
|---|---|
| **Webhook URL** | `https://shoppa-ten.vercel.app/api/webhooks/dgateway-store` |
| **API key** | the `dgw_live_…` key — copy it once, it goes into Vercel in step 4 |

⚠️ Note `/dgateway-store`, **not** `/dgateway`. The plain `/dgateway` path expects
the flat API payload (`{reference, status}`) and will return **404** on a hosted
store cart, which means **no credit and no error the buyer can see**.

If DGateway only offers one webhook field per app rather than per product, set it
to `/api/webhooks/dgateway-store`. The floatbet product is the only one using
this store.

### 3b. Success / return URL

| Field | Value |
|---|---|
| **Success redirect** | `https://shoppa-ten.vercel.app/#topup-success` |

This is **cosmetic**. It is not a security boundary and nothing credits on it.
If DGateway has no such field, skip it — the webhook still credits and the player
can reach `#topup-success` any time.

### 3c. The FloatBet deposit product

| Field | Value |
|---|---|
| Store slug | `floatbet` |
| Product slug | any, e.g. `floatbet-topup` — it is recorded, not matched |
| Price | **UGX**, whole numbers only (mobile money has no sub-unit) |
| Currency | `UGX` |
| Quantity | limit to 1–10 (the webhook rejects anything else) |

**Critical:** at checkout the buyer must enter **the same email they registered
with**. That email is the only thing tying the payment to an account. If they
type a different one, the payment is *parked*, not credited — recoverable from
the admin queue, but only by a human.

### 3d. Two webhooks, if DGateway requires one per product

If you keep the in-app `/api/collect` rail alive as a fallback, those payments go
to `/api/webhooks/dgateway` and the store ones to `/api/webhooks/dgateway-store`.
Both can be registered; they do not conflict.

---

## 4. Vercel environment variables

**Which project?** This matters and is easy to get wrong.

- `shoppa-ten.vercel.app` is project **`shoppa`** in account `iuearadio`. **This
  is the live one**, but the connected Vercel integration cannot reach that
  account, so these must be set by hand.
- `proxicore-visor` (team `team_MBLhGymHWx77okkzTOjnw1pY`) **is linked to this
  repo** and builds `main`. Its *name* looks unrelated — do not assume it is
  unused, and do not put production payment keys in it by accident.

Set these in **Project → Settings → Environment Variables**, for
**Production + Preview**:

| Key | Value | Notes |
|---|---|---|
| `DGATEWAY_API_URL` | `https://dgatewayapi.desispay.com` | |
| `DGATEWAY_API_KEY` | `dgw_live_…` | **sensitive**, server only |
| `DGATEWAY_WEBHOOK_SECRET` | from DGateway | **required in live mode** — without it every collect/disburse returns 503 `WEBHOOK_SECRET_MISSING` and charges nothing |
| `DGATEWAY_STORE_SLUG` | `floatbet` | rejects payments from another shop |
| `APP_URL` | `https://shoppa-ten.vercel.app` | builds the `callback_url` |
| `SUPABASE_URL` | `https://PROJECT_REF.supabase.co` | |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role key | **sensitive**, server only |
| `VITE_SUPABASE_URL` | `https://PROJECT_REF.supabase.co` | public, shipped to browser |
| `VITE_SUPABASE_ANON_KEY` | anon key | public, shipped to browser |
| `VITE_DGATEWAY_STORE_URL` | `https://dgatewayadmin.desispay.com/store/shop/floatbet?products` | public URL only, no key. Set to `off` to use the in-app rail |

**Rules that are not negotiable:**

1. Anything secret gets **no** `VITE_` prefix. A `VITE_` variable is compiled into
   the JavaScript bundle and readable by anyone.
2. `DGATEWAY_API_KEY` and `SUPABASE_SERVICE_ROLE_KEY` go in as **Sensitive**.
3. After adding variables, **redeploy**. Existing deployments keep the old env.

---

## 5. Make yourself an admin

After signing up once through the site:

```sql
update profiles set is_admin = true where id = (
  select id from auth.users where lower(email) = lower('YOUR_EMAIL_HERE')
);
```

Then open `https://shoppa-ten.vercel.app/#admin/parked`.

Verify it took:

```sql
select id, username, is_admin from profiles where is_admin;
```

---

## 6. Sanity checks before any real money

```bash
curl -i https://shoppa-ten.vercel.app/api/status?reference=TEST
curl -i https://shoppa-ten.vercel.app/api/admin/parked
```

- `/api/status` → **400 or 404 with JSON**, not `500 FUNCTION_INVOCATION_FAILED`.
  A 500 means the env vars are missing, not that the code is broken.
- `/api/admin/parked` → **401** (JSON). Anything else means the admin gate is
  misconfigured.

---

## 7. First live payment — do this yourself, small

1. Sign in, open **Top up**, choose **500 UGX** (the minimum).
2. Approve the mobile-money prompt.
3. Watch the success page: it should move from "Waiting" to "Deposit confirmed".
4. Confirm in Supabase:

```sql
select reference, status, amount, currency, quantity, buyer_email,
       matched_by, user_id, parked_reason
from store_topups
order by created_at desc
limit 5;
```

Expected: `status = completed`, `matched_by = auto`, `user_id` set.

5. Check the balance and the ledger:

```sql
select balance_px from wallets where user_id = 'YOUR_USER_ID';
select delta_px, balance_after, meta from ledger
where ref = 'THE_REFERENCE' order by id desc limit 1;
```

For 500 UGX you should see **5,000 PX** (10 PX = 1 UGX).

6. Check the webhook actually fired. If `store_topups` has no row at all, the
   webhook URL is wrong or the signature secret does not match — the money was
   taken and nothing recorded it. That is the single worst failure mode here, so
   test with 500 UGX, not 50,000.

---

## 8. What "parked" means, and what to do

A payment lands in `#admin/parked` when DGateway confirmed the money but the
checkout email matched zero or several accounts.

| `parked_reason` | Meaning | Action |
|---|---|---|
| `no_checkout_email` | Store did not send one | Find the payer from phone + amount, release |
| `email_not_registered` | Buyer used a different email | Search their username, release |
| `email_ambiguous` | Two accounts share the email | Ask them which they paid with, release |

Releasing writes an attributed `ledger` row and a `store_topup_actions` row. There
is no way to credit without a named admin.

---

## 9. Before taking real money, know this

- **No KYC/AML, no NLC licence, no age verification enforcement beyond a
  checkbox.** Uganda's Lotteries and Gaming Act requires a licence to operate
  games of chance for money. This is not a technical gap I can close in code.
- **The DGateway key has been pasted in a chat transcript.** Rotate it, then put
  the new one in Vercel only.
- **Nothing in the payment path has run against real infrastructure.** Steps 1
  and 7 are the only things standing between this and "took money, credited
  nothing".
