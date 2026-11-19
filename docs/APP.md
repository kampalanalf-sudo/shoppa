# FloatBet as an app: PWA and Android APK

Two deliverables, built from one codebase.

| | PWA | APK |
|---|---|---|
| Install | "Add to home screen" | Sideload / Play Store |
| Updates | instant on deploy | **rebuild and republish** |
| Needs a store | no | Play Store for distribution |
| Built here | yes, verified | **no** — GitHub Actions builds it |
| Offline | shell only | shell only |

---

## 1. PWA — done

### What ships

| File | Purpose |
|---|---|
| `public/manifest.webmanifest` | name, icons, standalone display, shortcuts |
| `public/sw.js` | service worker: cache policy |
| `public/icons/*` | 192/512 any, 192/512 maskable, 180 apple, 512 monochrome |
| `src/lib/pwa.ts` | registration + install prompt plumbing |
| `src/components/InstallPrompt.tsx` | the install / update sheet |
| `scripts/build-icons.mjs` | generates every icon from `public/favicon.svg` |

Icons are generated, not hand-made, so the launcher icon can never drift from
the logo. Re-run with `npm run icons`.

### The caching rule that matters

A service worker sits in front of **every** request. A stale payment response is
worse than a network error, so `public/sw.js` refuses to cache:

- `/api/*` — collect, disburse, status, both webhooks, admin, claim
- anything on `supabase.co` (`/rest/v1/`, `/auth/v1/`, `/realtime/v1/`, storage)
- any request carrying an `Authorization` header
- every non-GET request

`test:pwa` extracts the real `NEVER_CACHE` list from the worker and runs it
against concrete URLs, so the guard cannot rot into a comment. It also asserts
the worker does *not* over-block the shell and hashed assets.

Cache strategy elsewhere:

| Request | Strategy | Why |
|---|---|---|
| `/assets/*` (hashed) | cache-first | content-addressed, a stale hit is impossible |
| HTML shell | network-first, cache fallback | a deploy lands immediately; still opens offline |
| Offline fallback | static page | says outright that payments cannot happen offline |

The worker never auto-reloads. Activating a new version mid-spin or mid-payment
is worse than running one version behind, so the update sheet asks first.

### Verified

`test:pwa` — 28 assertions. Also served the production build and confirmed the
manifest is `application/manifest+json`, all icons return 200, and `sw.js` is
served at the right scope.

### Not verified

No headless browser is available here, so the actual Lighthouse/installability
audit has not been run. The manifest is structurally correct and every file it
references resolves; the "installable" badge in Chrome DevTools is unconfirmed.

---

## 2. APK — built by CI, not here

This sandbox has **no JDK, no Android SDK and no Gradle**, so an APK cannot be
produced locally. `.github/workflows/android.yml` builds it on an Ubuntu runner,
which has all three.

### What the workflow does

1. `npm ci`, `npm run build`
2. `npx cap sync android` — copies `dist/` into the Android project
3. derives `versionCode` from `git rev-list --count HEAD`, so it increases on
   every build and Android accepts the upgrade
4. `./gradlew assembleRelease` (signed, if the keystore secret is present)
5. `./gradlew assembleDebug` (always)
6. **verifies both APKs with `apksigner`** — catches an unsigned or mismatched
   artifact before it reaches a phone
7. uploads them as workflow artifacts

Retrieve them from the run page, or:

```bash
gh run list --workflow="Build Android APK" --limit 1
gh run download <run-id> -n FloatBet-debug-apk
```

The debug APK needs no signing setup and installs on any device. Start there.

### Package facts

| | |
|---|---|
| applicationId | `com.floatbet.gaming` (debug: `.debug`, so it installs alongside) |
| minSdk | 24 |
| targetSdk | 36 |
| JDK | 21 |
| AGP | 8.13.0 |
| Shell | Capacitor 8.6.2 |

### Why the app is not auto-updating

`capacitor.config.ts` bundles the built files into the APK rather than pointing
a WebView at the live site. That gives the app a local `file://` origin, so the
assets load instantly and no service worker is needed.

The cost: **a web deploy does not update installed APKs.** Fixing a bug means
rebuilding and republishing. That is the right trade for something distributed
through a store, and the wrong one if you expect "push to main and phones
update" — for that, remove `webDir` bundling and point `server.url` at the live
site instead.

### Signing a release APK

A release APK is useless unsigned — Android refuses to install it. Create a
keystore **once** and keep it forever: losing it means you can never update the
app on Play, only publish a new listing.

```bash
keytool -genkeypair -v \
  -keystore floatbet-release.keystore \
  -alias floatbet \
  -keyalg RSA -keysize 2048 -validity 10000
```

Then add four repository secrets (`gh secret set NAME` or Settings → Secrets):

| Secret | Value |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | `base64 -w0 floatbet-release.keystore` |
| `ANDROID_KEYSTORE_PASSWORD` | the store password |
| `ANDROID_KEY_ALIAS` | `floatbet` |
| `ANDROID_KEY_PASSWORD` | the key password |

The keystore file itself must **never** be committed — `.gitignore` blocks
`*.keystore`, `*.jks` and `release.keystore`.

Without these secrets the workflow still runs and still produces the debug APK;
the release step is skipped rather than failing.

### Local builds

If you have a JDK 21 + Android SDK locally:

```bash
npm run android:apk     # build + sync + assembleDebug
```

---

## 2b. Reel animation

There are **two** slot boards and both use one motion model in
`src/lib/reels.ts`:

* `src/components/SlotBoard3D.tsx` — the engine slots (`chape`,
  `bluemountain`, `bazaar`, `boda`), driven by `src/games/EngineSlot.tsx`.
* `src/components/Slot3D.tsx` — Bonni & Clyve, driven by
  `src/games/BonniClyve.tsx`.

**What was wrong, in three passes.**

1. The first board transitioned `translateY(${settling ? 0 : 0}px)` while rows
   were positioned by `top`. Both branches were zero, so nothing moved; the
   "spin" was 900 ms of shimmer over a static board.
2. The second pass drove a rAF loop on the engine board — but rebuilt the strip
   for the *outcome* the instant the spin began. The visible symbols were
   replaced before any motion happened, so the board **jumped, then span**. This
   is what the player reported. Bonni & Clyve was never touched at all and still
   hopped 14 times and snapped.
3. This pass. The strip a drum spins now **starts on exactly the symbols the
   drum is already showing**, and ends on the outcome:

   ```
   [ what you see ]  [ 10 faces of filler ]  [ where it lands ]
   ```

   A spin is therefore a continuation of the visible board, not a swap.

**How it works now.**

| Piece | Behaviour |
|---|---|
| Motion driver | one composited CSS `transition: transform` per drum — the compositor runs it off the main thread, so settling the round cannot stall a drum |
| Start | identity transform; the strip's first window *is* the resting board, so t=0 is pixel-identical |
| Anticipation | a 90 ms / 5 px pull-back before the launch, read as the drum engaging |
| Easing | `cubic-bezier(.14,.78,.26,1)` — fast off the mark, long deceleration, still moving at the stop |
| Stagger | 120 ms per drum, travel 1000 ms each: stops at 1090 / 1210 / 1330 / 1450 / 1570 ms |
| Travel | 13 faces (~2.5 drum turns), derived from the strip so it can never fall short |
| Motion blur | `blur(0.7px)` while travelling only, cleared on landing |
| Result commit | the game and the board share `spinPlan()`; the payout lands on the last drum's stop |
| Reduced motion | `prefers-reduced-motion` lands the drums instantly |

**Two invariants worth knowing before touching this code.**

* Transform and transition are written **imperatively** (layout effects), never
  declared in JSX. A re-render would rewrite the style attribute and cancel a
  travel mid-flight. This is the one place where direct DOM writes are correct.
* The board starts a spin on a **`spinKey`** prop bumped in the same React batch
  that publishes the outcome to `grid` — not on the `spinning` flag. A drum must
  never begin travelling before it knows where it is landing.

The old `frameScale()` compressed 3-reel boards to ~850 ms. It is gone: a
three-reel board should feel the same weight as a five-reel one, just with fewer
drums.

### Verified

`test:reels` (32 assertions) covers the model: the strip opens on the previous
symbols and closes on the outcome, the landing window is exactly one window tall
(this caught a real off-by-`rows`-gaps bug that pulled an extra symbol in), the
drum never runs out of symbols mid-travel, stop times ascend and match
`spinPlan`, and a 3-reel board is not sped up.

`test:slotboard` (10 assertions) renders **both** boards through
`renderToString`: five strips each, no transform baked into the markup, sharp at
rest, shimmer only while spinning.

### Not verified

No headless browser here, so **no frame rate has been measured and the motion
has not been watched**. The maths and the rendered DOM are checked; whether it
looks smooth on a real device is not something I can claim.

---

## 3. Things to know before shipping either

**Google Play will reject this app as-is.** Real-money gambling apps need a
licence and Google's gambling-operator authorisation; Uganda is not a permitted
distribution country for that category, and Play requires country-by-country
approval. Sideloading the APK or going through a licensed distributor avoids
that, and both carry the compliance problem in section 4.

**Payments inside the WebView.** The store flow navigates to DGateway's hosted
page. Android WebView handles it, but a mobile-money prompt needs the phone's
browser to reach the telco USSD flow reliably — test this on a real device
before taking money through the APK.

**The PWA and the APK have separate installs.** `com.floatbet.gaming` (APK) and
the installed PWA are different apps to Android with separate storage. A player
who installs both has two independent sessions.

---

## 4. The compliance point, unchanged

Per PR #14, #16 and #18: no NLC licence, no KYC/AML, no age verification beyond
a checkbox. Uganda's Lotteries and Gaming Act requires a licence to operate games
of chance for money. Shipping an installable app of this kind makes that
exposure more concrete, not less — it is now something a regulator can download
and install.

Nothing in this document changes that, and I can't close it in code.
