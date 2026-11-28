# Edge functions: the server side, without Vercel

The app is served from GitHub Pages. Pages is static — it has no `/api` — so every
server route had to move somewhere else. They now run as **Supabase Edge
Functions** in the same project as the database and auth.

This document is the map. `docs/GO-LIVE.md` still describes the original Vercel
setup and is now history, not instructions; where the two disagree, this file
wins.

---

## 1. What moved where

| Old Vercel route | Supabase function | Auth |
|---|---|---|
| `POST /api/collect` | `pay?op=collect` | caller's JWT, checked in-function |
| `POST /api/disburse` | `pay?op=disburse` | caller's JWT |
| `GET /api/status` | `pay?op=status` | caller's JWT |
| `POST /api/topup/claim` | `pay?op=claim` | caller's JWT, via `auth.uid()` |
| `GET /api/admin/{health,cashouts,audit,lookup,players,parked}` | `admin-ops?op=…` | JWT + `profiles.is_admin` |
| `POST /api/admin/{actions,parked}` | `admin-ops?op=…` | JWT + `profiles.is_admin` |
| `POST ?op=checkout` on `pay` | `pay?op=checkout` | caller's JWT |
| `webhooks-zengapay` | `webhooks-zengapay` | `X-ZENGAPAY-SIGNATURE`, HMAC over reference+msisdn+amount |
| `webhooks-zengapay-store` | `webhooks-zengapay-store` | same |
| `GET /api/feed/sports` | `feed-sports` | `CRON_SECRET` bearer, or admin JWT |
| `GET/POST /api/feed/settle` | `feed-settle` | same |
| `GET/POST /api/feed/sync` | `feed-sync` | same |

The browser still speaks in the old `/api/...` names. `src/lib/backend.ts` holds
one mapping table (`apiUrl()`) that turns them into absolute
`https://<project>/functions/v1/...` URLs. Nothing in the money code had to be
rewritten to change hosts, and an unmapped path throws instead of silently
requesting a page.

`api/` is still in the repository. It is no longer deployed — it is kept because
the `smoke/` suites exercise the original money logic, and because deleting the
reference implementation while the port is a week old is how you lose the ability
to tell a port bug from an original bug.

---

## 2. Why one function per area, not one per route

`pay` is collect + disburse + status + claim. `admin-ops` is every admin screen
plus the parked-payment queue. There are two reasons:

1. **The gate goes in one place.** `admin-ops` runs `requireAdmin()` before
   reading the `op` parameter. Every admin operation is behind it by
   construction; there is no per-route chance to forget.
2. **A deploy is one upload.** The Management API takes one file per function.
   Fewer functions means fewer things to deploy and fewer ways to end up with a
   half-deployed surface.

The webhooks are separate deliberately: they are public, they have a completely
different gate (an HMAC), and mixing a public route into a function that also
serves authenticated operations is how a `verify_jwt` setting gets set wrong.

---

## 3. `verify_jwt` is `false` on every function

Not an oversight. Each is rejected for a specific reason:

- **`pay`, `admin-ops`** call `auth.getUser()` themselves. Behind the platform
  gate, a missing token returns an opaque 401 before our code runs — and, more
  importantly, `admin-ops` cannot answer the difference between *401 not signed
  in* and *403 signed in but not an admin*, which the admin screens display
  differently.
- **`webhooks-*`** are called by ZENGAPAY, which has no Supabase JWT. The signature
  signature over the raw body is the only gate that can admit them. It fails
  closed: no secret configured means every webhook is rejected.
- **`feed-*`** accept either `Authorization: Bearer <CRON_SECRET>` or an admin's
  JWT, both checked inside the function.

The settings are written down in `supabase/config.toml` and applied by the deploy
workflow.

---

## 4. Deploying

```
GitHub → Settings → Secrets and variables → Actions → SUPABASE_ACCESS_TOKEN
```

A personal access token from <https://supabase.com/dashboard/account/tokens>.
Then push to `main`, or run **Deploy edge functions** from the Actions tab.

The workflow:

1. runs `scripts/build-edge-functions.mjs`, which inlines each function's
   `../_shared/*` imports in dependency order and **fails** if a requested symbol
   is not exported (`npm run edge:check` runs the same check locally);
2. bundles each result with esbuild;
3. POSTs (or PATCHes, if it already exists) one file per function to the
   Management API.

The shared modules are single-source on purpose:

| Module | Contents |
|---|---|
| `_shared/http.ts` | `CORS`, `json`, `preflight`, `readEnv` |
| `_shared/zengapay.ts` | the ZENGAPAY client, HMAC verification, money guards, checkout sessions |
| `_shared/oddsfeed.ts` | The Odds API client, margin, x100 conversion |

Two copies of `const CORS` in one bundle is a duplicate declaration at best and a
different header set at worst. That is not hypothetical — it happened while this
was being written, and `npm run test:edge` is what caught it.

---

## 5. Required secrets

Set in **Supabase → Project Settings → Edge Functions → Secrets**:

| Secret | Needed for | Without it |
|---|---|---|
| `DGATEWAY_API_KEY` | collect, disburse | `PAYMENT_NOT_CONFIGURED` (503), nothing is charged |
| `DGATEWAY_WEBHOOK_SECRET` | both webhooks | every webhook is rejected; **and** live mode refuses to charge at all |
| `APP_URL` | builds the checkout return URLs | falls back to the function's own origin, which the provider cannot redirect to unless it is the public one |
| `CRON_SECRET` | `feed-*` from a scheduler | only a signed-in admin can trigger a sync |
| `ODDS_API_KEY` | `feed-*` | `ODDS_KEY_MISSING` (503) |
| `DGATEWAY_STORE_SLUG` | store webhook | optional: when set, payments for another store are refused |

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are injected
by the platform; do not set them by hand.

**Live-mode guard:** if `DGATEWAY_API_KEY` starts with `dgw_live` and
`DGATEWAY_WEBHOOK_SECRET` is unset, the function refuses to charge. A payment
taken with no way to verify the webhook is money taken and never credited.

---

## 6. Webhook URL to give ZENGAPAY

```
https://dtroufrfavmjldtlprpn.supabase.co/functions/v1/webhooks-zengapay
```

Set this once in ZENGAPAY's dashboard (Developer Settings → Webhook URL). It is
**not** sent per request any more, so nothing in the code can set it for you. If
the dashboard still points at the old host, payments will be taken and nothing
will credit — so this
is a step to do *before* switching the domain, not after.

---

## 7. Testing

```
npm run test:edge      # the deployed bundles, with Deno and the network stubbed
npm run edge:check     # shared-module imports resolve
```

`test:edge` imports `supabase/.dist/*.ts` — the actual file the workflow uploads
— and exercises the real code paths: HMAC verification, the collect limits, the
10-second status cache, the 401-vs-403 admin gate, mixed-cart rejection, and the
`apiUrl()` mapping against the function directories on disk. It is also a step in
the Pages deploy, so a route pointing at a function nobody deployed fails the
build instead of reaching a player.

---

## 8. Still outstanding

- **DNS.** `floatbet.space` still resolves to Vercel. Until the registrar points
  at GitHub Pages (four A records, see `docs/GO-LIVE.md`), none of this is
  visible on the domain. Doing the port first means the DNS switch cannot break
  payments.
- **ZENGAPAY secrets** are not set in the Supabase project. Payments will deploy
  and return `PAYMENT_NOT_CONFIGURED` until they are.
- **The scheduler.** `feed-sync` and `feed-settle` need something to call them.
  The Vercel cron is gone (`vercel.json` no longer declares one — a cron on a
  project that cannot deploy reads as monitoring while doing nothing). Use
  `pg_cron` + `pg_net`, or any external scheduler, with the `CRON_SECRET` bearer.
- **Twilio.** Phone OTP has a null SID and token, so there is no OTP and
  therefore no crypto cashout. Unchanged by this port.
