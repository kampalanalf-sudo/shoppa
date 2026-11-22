# FloatBet go-live runbook

Exact steps, in order. Nothing here is optional — each step is a hard dependency
for the next.

> **Current state (updated):** the Supabase project `floatbet`
> (`dtroufrfavmjldtlprpn`, eu-west-1) now exists and migrations 0001–0005 are
> **applied**. The schema, the signup trigger, the money RPCs and the privilege
> lockdown are verified against the live database.
>
> Still outstanding: Vercel env vars (step 4), Google OAuth credentials (step 2),
> your admin flag (step 5). No real DGateway call has ever succeeded, so step 7
> is not optional.

---

## 0. The Supabase project (done)

**Already created:** `floatbet` — ref `dtroufrfavmjldtlprpn`, region `eu-west-1`,
plan free, organization `wvbizaxothlogmkepsia` (ProxiTalk).

| Value | Where |
|---|---|
| Project URL | `https://dtroufrfavmjldtlprpn.supabase.co` |
| Anon / publishable key | `sb_publishable_NMfiDW0hFB9KXtgmurOqZw_18-UcMPX` (or the legacy `anon` JWT) |
| service_role key | Supabase → Project Settings → API → `service_role`. **Server only.** |

**Database password** (generated at creation, store it in a password manager):
`5ZRD8OYFSNEPj6f0yq4Azd7U3mpR`

Migrations **0001 through 0005 are applied**. The steps below are kept for the
record and for rebuilding the project from scratch.

### What was verified on the live database

| Check | Result |
|---|---|
| 10 tables, 15 functions present | pass |
| Signup creates profile + wallet + 10,000 PX `grant` ledger row | pass |
| `place_bet` 1,000 then `settle_round` 2.5× | balance 10,000 → 9,000 → **11,500** |
| A player cannot read another player's wallet/ledger | 0 rows |
| A player cannot write a balance directly | 0 rows updated |
| `request_cashout` blocked without KYC | raises `confirm you are 18 or older` |
| Realtime on `wallets`, `chat_messages`, `gifts` | 3 tables in publication |

### A hole that was found and closed (0005)

`0001`–`0004` used `revoke all on function … from public`, which is **not**
enough on Supabase: the platform explicitly GRANTs EXECUTE to `anon` and
`authenticated` at CREATE time, and an explicit role grant is not inherited from
PUBLIC. Measured before the fix:

```
authenticated could execute admin_release_store_topup  -> true
authenticated could execute apply_store_topup          -> true
authenticated could execute settle_cashout             -> true
anon          could execute place_bet                  -> true
```

All SECURITY DEFINER, all bypassing RLS — a player could have called
`admin_release_store_topup(reference, their_id, any_admin_id)` through PostgREST
and credited themselves. **`0005_function_privileges.sql` fixes it** and sets
`alter default privileges` so future functions fail closed. Re-verified after:
all four are now `false`, while `place_bet` and `claim_store_topup` remain
`true` for `authenticated`.

---

## 0b. If you ever rebuild from scratch

**Do not reuse another app's project.** The organization also holds
`proxicore-outbreak-system` and `proxitalk-mesh-cloud`; the migrations create
`wallets`, `ledger` and `payment_orders`, so pointing FloatBet at either would
put two apps' money in one database.

`PROJECT_REF` throughout this document is `dtroufrfavmjldtlprpn`.

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
supabase/migrations/0005_function_privileges.sql   <-- must run last
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
| Google provider | **Enabled** (verified on the live project — client id `763098030610-...`) |
| Site URL | `https://floatbet.space` |
| Redirect URLs (allow list) | `https://floatbet.space/**`, `https://www.floatbet.space/**` |
| | `https://shoppa-sigma.vercel.app/**` (kept as a fallback) |
| | `http://localhost:5173/**`, `**/auth/callback` |

### Launch state, verified 21 Nov 2026

Checked against the live project and live DNS, not from memory:

| Item | State |
|---|---|
| `floatbet.space` DNS + TLS | ✅ **live**, serving the app |
| `shoppa-sigma.vercel.app` | ✅ live (fallback host) |
| Supabase Site URL | ✅ `https://floatbet.space` |
| Redirect allow list | ✅ floatbet + www + vercel + localhost |
| Google provider | ✅ enabled with a real client id |
| Google OAuth origins | ❌ **`floatbet.space` must be added in Google Cloud** |
| Email provider | ✅ enabled, confirmation required |
| Phone OTP (gates cashouts) | ❌ **no Twilio credentials — always fails** |
| Admin accounts | ✅ one: `kampalanalf` |
| Free-tier email limit | ⚠️ 2 per hour, will block signup testing |

The phone row is the one to read twice. `external_phone_enabled` is `true` and
`startPhoneVerification()` calls `signInWithOtp({ phone })`, but `sms_provider`
is `twilio` with a null SID and auth token, so **every OTP send fails**. Because
`phone_verified` is checked by `request_cashout` before anything else, no player
can currently withdraw — even after the 7-day rule, and even with a balance.
That is not a bug in the app; it is a missing credential.

### Google Sign-In — enablement is done, the consent screen is yours

The provider is already enabled on `dtroufrfavmjldtlprpn` with a real client id,
so the button will open the Google sheet. Two things in Google Cloud still need
a human:

1. **OAuth consent screen** → *Publishing status* must be **In production**, or
   only the test users you listed can sign in.
2. Authorized JavaScript origin `https://floatbet.space` (and `https://www.floatbet.space`) and redirect URI
   `https://dtroufrfavmjldtlprpn.supabase.co/auth/v1/callback` must both be
   present on the client.

If sign-in bounces with `redirect_uri_mismatch`, it is (2). If it works for you
and nobody else, it is (1).

### How the three sign-in paths actually work

| Path | What happens | Where it can break |
|---|---|---|
| Email + password | `signInWithPassword`, session in localStorage | `#auth` shows "Backend is not configured" -> the `VITE_` vars are missing |
| Email sign-up | `signUp` with `emailRedirectTo=...#verified`; confirm mail required | free tier: **2 mails/hour**. Hits the limit fast while testing |
| Google | `signInWithOAuth`, redirect back to the site | popup blocked, provider off, or origin not allowed |
| Password reset | mail -> `#reset-password` -> `exchangeCodeForSession` -> `SetPassword` | a link is single-use and lasts one hour |

The reset path is worth spelling out because it used to be a dead end: GoTrue
appends its token to the redirect *hash*, and a hash-based router never sees
`?code=`. `AuthProvider` now parses the params out of the hash itself, exchanges
them, and strips them from the address bar so the link cannot be replayed.

### Already configured

| Setting | Value |
|---|---|
| Site URL | `https://floatbet.space` |
| Redirect allow list | `https://floatbet.space/**`, `https://www.floatbet.space/**`, `https://shoppa-sigma.vercel.app/**`, `**/auth/callback`, `http://localhost:5173/**` |
| Email provider | enabled |
| Confirm email | enabled (`mailer_autoconfirm: false`) |
| Refresh token rotation | enabled, 10s reuse interval |
| JWT expiry | 3600s |

⚠️ **Free-tier email limit is 2 per hour.** Email confirmation and password
resets will hit this almost immediately in testing. For anything beyond a smoke
test, either raise the limit on a paid plan or add custom SMTP (Resend, Postmark)
under Authentication → Settings → SMTP.

---

## 3. DGateway settings — this is the part you asked about

DGateway → **My Apps → Settings**, and the FloatBet product.

### 3a. App-level settings

| Field | Value |
|---|---|
| **Webhook URL** | `https://shoppa-sigma.vercel.app/api/webhooks/dgateway-store` |
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
| **Success redirect** | `https://shoppa-sigma.vercel.app/#topup-success` |

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

**Which project?** There is exactly one, and it is called `shoppa`.

- **`shoppa-sigma.vercel.app`** is the public production site. It is project
  `shoppa`, team `charlielwanga88-4249` (`team_MBLhGymHWx77okkzTOjnw1pY`), linked
  to `kampalanalf-sudo/shoppa` and building `main`.
- It was previously named **`proxicore-visor`**, which caused a lot of
  confusion: the name suggested a different app, and `shoppa-ten.vercel.app`
  (which older copies of these docs cited) was never ours at all. It belongs to
  another project. Do not put it back.
- **`shoppa-sigma.vercel.app` must stay added as a *custom domain* on the
  project.** Automatic `*.vercel.app` aliases are behind Vercel Deployment
  Protection (SSO), and only custom domains are exempt. Removing it makes
  production private again.

Set these in **Project → Settings → Environment Variables**, for
**Production + Preview**:

| Key | Value | Notes |
|---|---|---|
| `DGATEWAY_API_URL` | `https://dgatewayapi.desispay.com` | |
| `DGATEWAY_API_KEY` | `dgw_live_…` | **sensitive**, server only |
| `DGATEWAY_WEBHOOK_SECRET` | from DGateway | **required in live mode** — without it every collect/disburse returns 503 `WEBHOOK_SECRET_MISSING` and charges nothing |
| `DGATEWAY_STORE_SLUG` | `floatbet` | rejects payments from another shop |
| `APP_URL` | `https://shoppa-sigma.vercel.app` | builds the `callback_url` |
| `SUPABASE_URL` | `https://dtroufrfavmjldtlprpn.supabase.co` | |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role key | **sensitive**, server only |
| `VITE_SUPABASE_URL` | `https://dtroufrfavmjldtlprpn.supabase.co` | public, shipped to browser |
| `VITE_SUPABASE_ANON_KEY` | anon key | public, shipped to browser |
| `VITE_DGATEWAY_STORE_URL` | `https://dgatewayadmin.desispay.com/store/shop/floatbet?products` | public URL only, no key. Set to `off` to use the in-app rail |

**Rules that are not negotiable:**

1. Anything secret gets **no** `VITE_` prefix. A `VITE_` variable is compiled into
   the JavaScript bundle and readable by anyone.
2. `DGATEWAY_API_KEY` and `SUPABASE_SERVICE_ROLE_KEY` go in as **Sensitive**.
3. After adding variables, **redeploy**. Existing deployments keep the old env.

**Automated helper.**

```bash
vercel login
vercel link --project shoppa
./scripts/set-vercel-env.sh
```

The script now refuses to run unless the linked project is exactly `shoppa` —
setting variables on the wrong project looks like success and changes nothing.
It prompts for the two secrets rather than taking them as arguments, and sets
everything except `SUPABASE_SERVICE_ROLE_KEY`, which you must add in the
dashboard so it can be marked *sensitive*.

### 4b. Which site is actually live?

There are **two** deployments of this repo, and this confused the whole picture
for a while:

| Host | Project | Signs in? |
|---|---|---|
| `https://kampalanalf-sudo.github.io/shoppa/` | GitHub Pages, branch `gh-pages`, built by `.github/workflows/deploy-pages.yml` on every push to `main` | **yes** |
| `https://shoppa-sigma.vercel.app` | Vercel project **`shoppa`** (renamed from `proxicore-visor`) | **yes** |

Both sign in now, because `src/lib/backend.ts` carries the public Supabase URL
and publishable key as defaults. Neither host needs a `VITE_` variable to work;
the env vars only exist to point a build at a *different* backend.

The Pages build was publishing with no `VITE_` variables at all, so the bundle it
served contained no Supabase client: sign-up, wallet and cashout simply did not
exist, and nothing on screen said so. That is fixed at the source, not in a
dashboard — `src/lib/backend.ts` now carries the **public** project URL and
publishable key as defaults, with the env vars still overriding them. A pipeline
can no longer publish an unauthenticated app by forgetting a setting.

The deploy workflow also refuses to publish if the built bundle has no backend
in it, so this cannot regress silently again.

Supabase's URL allow-list now includes `https://kampalanalf-sudo.github.io/shoppa/**`,
and auth redirects are sent as **relative** paths, so a player who signs up on
Pages stays on Pages instead of being bounced to the Vercel `site_url`.

### 4c. Vercel, and the trap that took it down

**Vercel deployments are refused outright if `vercel.json` declares a cron more
frequent than the Hobby plan allows.** The message is:

> Hobby accounts are limited to daily cron jobs. This cron expression
> (`0 */4 * * *`) would run more than once per day.

Vercel rejects the **whole deployment** — not just the cron — so a 4-hourly
`crons` entry takes the entire site down. That happened here: every production
deploy failed from PR #25 until it was removed, and each one reported
`buildSkipped: true` with `readyState: ERROR`.

The odds sync does **not** belong on Vercel. It runs on `pg_cron` inside
Supabase (see `docs/SPORTS.md` §9). The only Vercel cron left is a daily settle
sweep, which Hobby permits. `smoke/feed.ts` asserts the rule, so it cannot come
back by accident.

To deploy from here:

then paste this, once, with the real service role key:

```bash
SITE=https://shoppa-sigma.vercel.app
PROJECT_REF=dtroufrfavmjldtlprpn
ANON=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR0cm91ZnJmYXZtamxkdGxwcnBuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTUwNDQyMTAsImV4cCI6MjExMDYyMDIxMH0.LIafhBin2Uy_tx4OWDtRu-DZ6fca3atMz9Ht-XUmf2s

for T in production preview; do
  printf %s "https://$PROJECT_REF.supabase.co" | vercel env add VITE_SUPABASE_URL          $T --force
  printf %s "$ANON"                             | vercel env add VITE_SUPABASE_ANON_KEY      $T --force
  printf %s "https://$PROJECT_REF.supabase.co" | vercel env add SUPABASE_URL                $T --force
  printf %s "$SITE"                             | vercel env add APP_URL                     $T --force
  printf %s "off"                               | vercel env add VITE_DGATEWAY_STORE_URL     $T --force
done

vercel env add SUPABASE_SERVICE_ROLE_KEY production   # paste, mark sensitive
vercel --prod                                          # env only applies to NEW builds
```

**The anon key is public by design** — it ships inside the browser bundle and
every table behind it is guarded by RLS. The `service_role` key must never be
given a `VITE_` prefix.

How you know it worked: open `https://shoppa-sigma.vercel.app/#auth`. The amber
"Backend is not configured" banner must be **gone**, and the Google button must
be clickable. If the banner is still there, `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY` did not reach the build, and no sign-up can succeed
because the browser has nowhere to send it.

---

## 5. Make yourself an admin

After signing up once through the site:

```sql
update profiles set is_admin = true where id = (
  select id from auth.users where lower(email) = lower('YOUR_EMAIL_HERE')
);
```

Then open `https://shoppa-sigma.vercel.app/#admin/parked`.

Verify it took:

```sql
select id, username, is_admin from profiles where is_admin;
```

---

## 6. Sanity checks before any real money

```bash
curl -i https://shoppa-sigma.vercel.app/api/status?reference=TEST
curl -i https://shoppa-sigma.vercel.app/api/admin/parked
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
