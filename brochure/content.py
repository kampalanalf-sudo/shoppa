#!/usr/bin/env python3
"""Content model — every claim here traces to the product repositories."""

STUDIO = "Great Lakes Technology"
DIRECTOR = "Alfred Idusso"
ADDRESS = ["Plot 14 Martyrs Drive", "Ntinda, Kampala", "Uganda"]
LINKEDIN = "linkedin.com/kampalan"
EDITION = "Investor Edition · 2026"

# ---------------------------------------------------------------------------
# The studio
# ---------------------------------------------------------------------------
MISSION = (
    "Great Lakes Technology builds and operates consumer and business software for East "
    "Africa. Every product in this book is designed, engineered and shipped in-house from "
    "Ntinda, Kampala — full-stack, cloud-native, and built to run on the networks, devices "
    "and payment rails that actually exist here."
)

POSITIONING = [
    ("Software with a local operating model",
     "Mobile-first, low-bandwidth-tolerant interfaces, mobile-money and gateway payments, "
     "and WhatsApp as a first-class channel rather than an afterthought."),
    ("Full-stack ownership",
     "Interface, API, database schema, background workers, webhooks and deployment are "
     "designed as one system — so a feature ships in days, not quarters."),
    ("Honest engineering posture",
     "We publish what is live, what is a prototype and what is a boundary. Security, "
     "consent and data handling are specified before features are marketed."),
    ("One platform, many products",
     "A shared layer of authentication, data, delivery and deployment lets a new vertical "
     "launch on proven rails instead of a blank page."),
]

CAPABILITIES = [
    ("Product & interface design",
     ["Design systems in Tailwind", "Motion & micro-interaction", "Accessibility & keyboard paths",
      "Responsive from 360 px to ultrawide"]),
    ("Web engineering",
     ["React 19 + TypeScript", "Vite build pipelines", "Progressive web apps", "Offline-first state"]),
    ("Backends & automation",
     ["Python & Node services", "Postgres / SQLite schemas", "Background workers & cron",
      "Webhook ingestion with HMAC"]),
    ("Cloud & delivery",
     ["Supabase (Auth, RLS, Realtime, Edge)", "Vercel & GitHub Pages", "CI typecheck + build gates",
      "Domain, TLS & environment hygiene"]),
    ("Payments & messaging",
     ["DGateway & mobile money flows", "WhatsApp Cloud API", "Twilio SMS + SMTP email",
      "Idempotent fulfilment"]),
    ("Trust & safety",
     ["Passkeys / WebAuthn", "PBKDF2 + opaque sessions", "CSRF & header hardening",
      "Row-level security by default"]),
]

METHOD = [
    ("01", "Scope",
     "One page of intent: who it serves, what must be true, what is explicitly out of scope."),
    ("02", "Design",
     "Interface language, data model and API surface agreed together — no drifting screens."),
    ("03", "Build",
     "Typed end-to-end, with tests and a CI gate that runs typecheck and production build."),
    ("04", "Harden",
     "Threat model, RLS policies, rate limits, secret handling and an honest readiness statement."),
    ("05", "Ship & operate",
     "Custom domain, monitoring, background jobs, and a written runbook for the operator."),
]

PLATFORM = [
    ("Interface", "React 19 · TypeScript · Tailwind CSS 4 · Vite · Framer Motion · Leaflet"),
    ("Data", "Supabase Postgres · Row-Level Security · Realtime channels · SQLite for edge cases"),
    ("Server", "Python stdlib services · Node APIs · Supabase Edge Functions · pg_cron workers"),
    ("Delivery", "Vercel · GitHub Pages · GitHub Actions CI · PWA installability"),
    ("Identity", "Supabase Auth · Google OIDC + PKCE · passkeys / WebAuthn · opaque sessions"),
    ("Messaging", "WhatsApp Cloud API · Twilio SMS · SMTP email · Resend"),
    ("Payments", "DGateway store + API · mobile money · capacity-safe ticket issuance"),
]

STANDARDS = [
    ("Security baseline",
     "PBKDF2-SHA256 at 210,000 iterations, 256-bit opaque session tokens stored hashed, "
     "HttpOnly / SameSite cookies, login throttling, CSRF origin checks and a strict CSP."),
    ("Data governance",
     "Row-level security on every exposed table, secret keys kept server-side only, and "
     "no fabricated financial or biometric records in any demo state."),
    ("Quality gate",
     "Every repository runs typecheck, unit tests and a production build in CI before "
     "anything reaches a public URL."),
    ("Honest status",
     "Each product ships with a written statement of what is live, what is simulated and "
     "what remains before commercial launch."),
]

# ---------------------------------------------------------------------------
# Products
# ---------------------------------------------------------------------------
PRODUCTS = [
    dict(
        key="floatbet", art="floatbet", name="FloatBet Gaming",
        kicker="ORIGINAL GAME ENGINE",
        tagline="Eight provably-fair casino games on one audited engine.",
        sector="Interactive entertainment",
        accent="violet", status="Live build · demo economy",
        url="github.com/kampalanalf-sudo/shoppa",
        summary=(
            "A BC.Game-class crypto casino front-end with eight fully playable original games "
            "and a real provably-fair engine. Every paytable is verified to its advertised "
            "return-to-player, and any settled round can be re-derived by hand from the "
            "server seed, client seed and nonce."
        ),
        highlights=[
            ("Eight original titles",
             "Plinko, Crash, Mines, Dice, Limbo, Wheel, Tower and European Roulette — each with "
             "its own mathematics rather than a shared template."),
            ("Verified 99.0% RTP",
             "Payout tables are validated as the sum of probability times payout, and the "
             "computed RTP is displayed live in the interface for the player."),
            ("True provably fair",
             "HMAC-SHA256 commitments published before betting, seed rotation that reveals the "
             "previous seed, and a working in-app verifier."),
            ("A complete product shell",
             "Wallet with six currencies, rewards and VIP hub, win ticker, chat dock, bet "
             "history, statistics drawer and procedural WebAudio sound."),
        ],
        metrics=[("8", "original games"), ("99.0%", "verified RTP"), ("0", "third-party assets")],
        arch=[
            ("Engine", "Deterministic float stream from HMAC-SHA256, four bytes consumed per float."),
            ("Interface", "React 19 + TypeScript, hash routing so any game is shareable and refreshable."),
            ("State", "Typed store with local persistence; balances, deposits and withdrawals simulated."),
            ("Craft", "Procedural audio, reduced-motion support, keyboard play, 360 px to ultrawide."),
        ],
        note="Round 4,000 and the maths still holds — because the maths is the product.",
    ),
    dict(
        key="rebuy", art="rebuy", name="Rebuy",
        kicker="RETAIL RETENTION ENGINE",
        tagline="Remembers what every customer bought — and messages them before it runs out.",
        sector="Retail & commerce",
        accent="emerald", status="Live · rebuy.website",
        url="rebuy.website",
        summary=(
            "Rebuy turns a shop's sales history into repeat revenue. It works out when each "
            "purchased item will run out, or when a service is due again, then messages the "
            "customer on WhatsApp, SMS or email a few days before — automatically, with quiet "
            "hours, caps and opt-outs respected."
        ),
        highlights=[
            ("Automated restock timing",
             "Every line item receives a restock date from sale date and effective cycle; "
             "services use a fixed re-booking interval instead."),
            ("Three real channels",
             "WhatsApp Cloud API, Twilio SMS and SMTP email, resolved per shop then platform "
             "then environment, with a zero-config sandbox for evaluation."),
            ("Conversion attribution",
             "Replies are classified into order, snooze, opt-out, question or negative, and "
             "revenue is attributed for twenty-one days after a reminder."),
            ("Platform admin cockpit",
             "A separate operator application covering fleet KPIs, shops, messaging, revenue, "
             "queue health and provider credentials."),
        ],
        metrics=[("21 days", "attribution window"), ("60+", "API routes"), ("3", "delivery channels")],
        arch=[
            ("Application", "Two SPAs — shop owner and platform admin — served from a Python stdlib API."),
            ("Import", "CSV and Excel ingestion with fuzzy header matching, plus pasted receipt parsing."),
            ("Scheduling", "Worker tick honours due dates, quiet hours, monthly caps and opt-outs."),
            ("Storage", "SQLite in WAL mode by default; one environment variable switches to Postgres."),
        ],
        note="Retention is not a campaign — it is a schedule that never forgets.",
    ),
    dict(
        key="tanktickets", art="tanktickets", name="Tank Tickets",
        kicker="EVENT COMMERCE",
        tagline="Payments, tickets and delivery that survive a real crowd.",
        sector="Events & live experiences",
        accent="cyan", status="Live · tanktickets.site",
        url="tanktickets.site",
        summary=(
            "An end-to-end ticketing platform for Ugandan events: storefront, free and paid "
            "checkout, capacity control, QR ticket issuance and automatic delivery. Paid "
            "checkout runs through DGateway with server-side verification, so a ticket is only "
            "ever issued against a payment that the provider has confirmed."
        ),
        highlights=[
            ("Verified fulfilment",
             "The webhook verifies an HMAC-SHA256 signature over the raw body, re-fetches the "
             "transaction from the provider, then matches product, amount, currency, quantity, "
             "buyer and remaining capacity."),
            ("Fails closed",
             "Unknown products, mixed carts, tips or coupons that change the total, test "
             "payments and capacity failures are recorded as blocked rather than issued."),
            ("Idempotent by reference",
             "Retries cannot double-issue. A failed payment is final; every state change is "
             "written to a delivery record."),
            ("Automatic delivery",
             "A generated PDF ticket with QR code is stored in a private bucket, a seven-day "
             "signed link is emailed through Resend, and a WhatsApp template carries both links."),
        ],
        metrics=[("1", "payment truth"), ("QR", "PDF delivery"), ("0", "double issues")],
        arch=[
            ("Storefront", "React 19 SPA with event pages, checkout, buyer lookup and an admin console."),
            ("Payments", "Hosted DGateway store mode or in-app API mode; the key never reaches the browser."),
            ("Server", "Supabase Edge Functions for webhook receipt, reconcile and ticket delivery."),
            ("Data", "Capacity-aware issuance and mapping tables in Postgres, with admin resend tools."),
        ],
        note="The ticket is the receipt. Both must be provably the same transaction.",
    ),
    dict(
        key="trampo", art="trampo", name="Trampo",
        kicker="MOBILITY PLATFORM",
        tagline="Your city. Your ride. Built for Kampala streets.",
        sector="Mobility & logistics",
        accent="violet", status="Live · trampo.lat",
        url="trampo.lat",
        summary=(
            "An installable ride-hailing PWA for Uganda with a real account-backed backend: "
            "automated matching to approved, online, idle drivers of the selected vehicle type, "
            "a GPS and boarding-PIN start gate, live trip maps and matched-only audio calling "
            "with incoming-call alerts."
        ),
        highlights=[
            ("Role-aware by design",
             "Distinct experiences for passengers, car drivers, motorbike riders and operations "
             "admins, each with its own profile, permissions and review path."),
            ("Real matching",
             "Requests route to eligible drivers after a fresh shift and GPS check, with the "
             "nearest candidate ranked first — no demo accounts in the live build."),
            ("Safety features",
             "Boarding PIN verification, Night Shield tools, GPS-verified trip start and "
             "matched-only calling so a number is never exposed."),
            ("Installable",
             "Standalone PWA with an in-app install flow, honest offline screen and "
             "user-controlled updates; only public build files are cached."),
        ],
        metrics=[("4", "user roles"), ("PWA", "installable"), ("GPS", "verified starts")],
        arch=[
            ("Auth", "Supabase Auth with email and password, plus server-side Google OAuth for passengers."),
            ("Realtime", "Supabase Realtime channels carry call signalling and live trip state."),
            ("Maps", "Leaflet with OpenStreetMap, optional reverse-geocoded pickup via Google Maps."),
            ("Ops", "Driver onboarding, document review, first-admin bootstrap and pg_cron jobs."),
        ],
        note="A ride-hailing product is a trust product. Every gate is server-enforced.",
    ),
    dict(
        key="tankdistro", art="tankdistro", name="Tank Distribution",
        kicker="MUSIC SUPPLY CHAIN",
        tagline="Independent distribution, DDEX delivery and clean royalty splits.",
        sector="Music & creator economy",
        accent="gold", status="Prototype · catalog engine",
        url="Tank Distribution · v2.4",
        summary=(
            "A distribution platform for independent labels and artists: a four-step release "
            "wizard, DDEX ERN 4.3 delivery to more than 150 DSPs, automatic UPC and ISRC "
            "assignment, a royalty split engine that must lock at exactly one hundred percent, "
            "and payout rails across Stripe, Wise, SWIFT and USDC."
        ),
        highlights=[
            ("Four-step release wizard",
             "Metadata and 3000 × 3000 artwork, lossless master upload with real duration "
             "decoding, collaborator splits, then DSP selection and deployment."),
            ("Identifiers handled properly",
             "UPC-A barcodes and ISRC codes are generated per release and per track, with "
             "loudness verified against a −14.0 LUFS target."),
            ("Export-grade compliance",
             "Per-store delivery batches export as valid DDEX ERN 4.3 XML manifests, and "
             "royalty statements export as CSV."),
            ("Royalty telemetry",
             "Streaming and revenue velocity charts across 7-day to 12-month windows, with a "
             "per-release collaborator split tree."),
        ],
        metrics=[("150+", "DSP targets"), ("ERN 4.3", "DDEX manifests"), ("100%", "split lock")],
        arch=[
            ("Interface", "React 19 + TypeScript + Tailwind with a command-console aesthetic."),
            ("Delivery", "ERN 4.3 manifest generation with automated QC validation status per batch."),
            ("Finance", "Split engine enforcing exact 1.00 totals across five collaborator roles."),
            ("Data", "Optional Supabase connection for catalog sync; CI on every push."),
        ],
        note="Royalty software earns trust by being auditable, not by looking clever.",
    ),
    dict(
        key="iuea", art="iuea", name="IUEA Community Radio",
        kicker="MEDIA & COMMUNITY",
        tagline="The voice of Kansanga — live, on demand, and shared by the whole campus.",
        sector="Media & education",
        accent="gold", status="Live prototype · shared cloud",
        url="IUEA · Kansanga, Kampala",
        summary=(
            "A full radio station in a browser for the International University of East Africa: "
            "live player with a truthful spectrum visualiser, five podcast shows with real "
            "spoken episodes, a request line, a weekly schedule in East Africa Time, a campus "
            "social wall and a presenter studio console."
        ),
        highlights=[
            ("Never silent",
             "Three audio paths — a real Icecast / Zeno / Radio.co stream, on-demand episodes, "
             "or a built-in WebAudio studio bed — all routed through one analyser."),
            ("One shared station brain",
             "Twelve Supabase tables with Realtime sync so now-playing, shout wall, requests, "
             "posts, polls and listener presence agree across every device."),
            ("Presenter console",
             "Go live, play episodes and tracks, clear the request queue, publish as Studio and "
             "talk to the shout wall from one surface."),
            ("Brand-complete",
             "Official crest composited over original glossy studio art, with a downloadable "
             "brand and artwork kit in the app."),
        ],
        metrics=[("12", "realtime tables"), ("5", "podcast shows"), ("EAT", "schedule native")],
        arch=[
            ("Audio", "Single AnalyserNode graph so the visualiser can never lie about the signal."),
            ("Sync", "Supabase Realtime postgres_changes for every live surface on campus."),
            ("Content", "Auto-seeds an empty project on first connect; works local-first without cloud."),
            ("Craft", "Playfair, Manrope and IBM Plex Mono over a maroon and gold identity."),
        ],
        note="Campus media works when the station and the students share one brain.",
    ),
    dict(
        key="biopay", art="biopay", name="BioPay",
        kicker="PAYMENTS & IDENTITY",
        tagline="Device-bound approval for payments that deserve better than a password.",
        sector="Fintech & identity",
        accent="cyan", status="Pilot build · security-first",
        url="Vercel + Supabase pilot",
        summary=(
            "A payments and identity console built on passkeys. Approval lives in the device "
            "authenticator — fingerprint, face or PIN — so the web application never receives "
            "raw biometric data. Optional camera-based measurement research is kept in a "
            "separate, explicitly consented lane and is never a payment signal."
        ),
        highlights=[
            ("Passkeys, done correctly",
             "WebAuthn device-bound approval with clear boundaries: no biometric templates "
             "transmitted, no server-side image capture, no silent fallback."),
            ("Honest empty states",
             "No sample accounts, balances, merchants or transactions. A pilot screen must "
             "never imply money that does not exist."),
            ("Device registry",
             "A BLE device registry with explicit, user-initiated scanning and newest-first "
             "ordering — scanning is off unless a person turns it on."),
            ("Hardened delivery",
             "Baseline browser-security headers, no third-party scripts or trackers, and a "
             "zero-dependency static surface for the pilot."),
        ],
        metrics=[("0", "trackers"), ("1", "consent lane"), ("0", "fake records")],
        arch=[
            ("Surface", "Dependency-free responsive console: overview, payments, merchants, devices, security."),
            ("Identity", "WebAuthn passkeys with device-bound keys; camera research fully separate."),
            ("Cloud", "Vercel for delivery, Supabase reserved for managed data after RLS review."),
            ("Posture", "Threat model and backend plan written before a single payment is enabled."),
        ],
        note="We will not demo money that cannot move. That restraint is the feature.",
    ),
    dict(
        key="grgc", art="grgc", name="Gateway Revival Glory",
        kicker="INSTITUTION PLATFORM",
        tagline="A ministry's whole story online — plus a safety tool for its people.",
        sector="Institutions & community",
        accent="rose", status="Live · gatewayrevivalglory.online",
        url="gatewayrevivalglory.online",
        summary=(
            "The official platform for Gateway Revival Glory Church & Ministries in Kampala: "
            "anniversary campaigns, conference galleries, written testimonies, branch directions, "
            "sermon video, prayer requests, a WhatsApp hotline and mobile-money giving — with a "
            "private phone-tracker sub-application for personal device safety."
        ),
        highlights=[
            ("Campaign-grade publishing",
             "A youth conference feature, anniversary retrospectives, a journey timeline and a "
             "zoomable testimony library — all from the church's own archive."),
            ("Giving that fits the country",
             "Mobile money for MTN and Airtel, bank transfer and card, alongside a WhatsApp "
             "prayer line rather than a form nobody completes."),
            ("Built-in reach",
             "Gallery lightboxes, YouTube service embeds, newsletter capture and maps for both "
             "branches, on a custom domain over HTTPS."),
            ("Phone Tracker",
             "A separate anti-theft tool: protect mode reports GPS and battery with an offline "
             "queue, while a find dashboard offers live map, history export and remote ring, "
             "message or PIN-lock."),
        ],
        metrics=[("2", "branches live"), ("100%", "RLS coverage"), ("MoMo", "giving rails")],
        arch=[
            ("Site", "Static, dependency-light build that hosts anywhere and loads fast on mobile data."),
            ("Content", "Archive-derived photography, real testimonies and real handwritten letters."),
            ("Tracker", "Dedicated Supabase project with row-level security on every table."),
            ("Operations", "Custom domain, HTTPS, and a maintenance path the church team can follow."),
        ],
        note="Institutional trust is earned in the details a visitor never notices.",
    ),
]

# ---------------------------------------------------------------------------
# Portfolio summary table for the at-a-glance page
# ---------------------------------------------------------------------------
AT_A_GLANCE = [
    ("FloatBet Gaming", "Interactive", "8 provably-fair originals", "violet"),
    ("Rebuy", "Retail", "Automated WhatsApp retention", "emerald"),
    ("Tank Tickets", "Events", "Verified ticketing + delivery", "cyan"),
    ("Trampo", "Mobility", "Ride-hailing PWA for Kampala", "violet"),
    ("Tank Distribution", "Music", "DDEX delivery & royalties", "gold"),
    ("IUEA Community Radio", "Media", "Live campus radio platform", "gold"),
    ("BioPay", "Fintech", "Passkey payment approval", "cyan"),
    ("Gateway Revival Glory", "Institution", "Church platform + tracker", "rose"),
]

TRACTION = [
    ("8", "products designed, built and shipped"),
    ("4", "live custom domains on paid TLS"),
    ("6", "vertical markets addressed"),
    ("3", "cloud platforms operated on"),
    ("100%", "of products built by the founding team"),
]

ROADMAP = [
    ("Now", "Operate & harden",
     "Run the live products, tighten row-level security and secrets, and convert the strongest "
     "pilots into paying accounts.", "cyan"),
    ("Next", "Commercialise two verticals",
     "Rebuy and Tank Tickets carry the clearest revenue path: subscription retail retention and "
     "transaction-fee event commerce.", "violet"),
    ("Then", "Consolidate the platform",
     "A single identity, billing and messaging core shared across the portfolio, so each new "
     "vertical launches on proven rails.", "gold"),
    ("Later", "Regional expansion",
     "Take the retention and ticketing engines into Kenya, Tanzania and Rwanda with the same "
     "cloud footprint and local payment integrations.", "emerald"),
]

ENGAGEMENT = [
    ("What we are raising for",
     "Engineering capacity, go-to-market for the two commercial verticals, and the compliance "
     "work required to operate payments at scale."),
    ("How capital is used",
     "Sixty percent product and engineering, twenty-five percent sales and merchant "
     "acquisition, fifteen percent security, compliance and infrastructure."),
    ("What a partner gets",
     "A portfolio already built, a documented platform layer, four live domains and a founding "
     "team that ships end to end without outsourcing."),
]
