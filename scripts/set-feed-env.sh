#!/usr/bin/env bash
# scripts/set-feed-env.sh
#
# Turns on the live sportsbook feed. Run it once, after `vercel link`.
#
# Why a script: the connected Vercel integration authenticates as
# charlielwanga88-4249 and the `shoppa` project lives in `iuearadio`, so the
# integration cannot set anything there. This uses the Vercel CLI with your own
# login.
#
# What it does that a dashboard cannot:
#   * generates CRON_SECRET (the bearer token Vercel sends to the cron routes)
#   * sets it, plus ODDS_MARGIN_PCT, on Production + Preview
#
# What it deliberately does NOT do:
#   * set ODDS_API_KEY. The CLI cannot mark a variable `sensitive`, and a
#     billable credential should be sensitive. Add it in the dashboard — the
#     script prints the exact path — and paste the key there, not here, so it
#     never lands in your shell history.
#
# Usage:
#   vercel login
#   vercel link --project shoppa        # NOT proxicore-visor
#   ./scripts/set-feed-env.sh
#   vercel --prod                       # env only reaches NEW builds

set -euo pipefail

if ! command -v vercel >/dev/null 2>&1; then
  echo "vercel CLI not found. Install it: npm i -g vercel" >&2
  exit 1
fi

if [ ! -f .vercel/project.json ]; then
  echo "This directory is not linked to a Vercel project. Run: vercel link" >&2
  echo "Link it to the project that serves shoppa-ten.vercel.app, NOT proxicore-visor." >&2
  exit 1
fi

PROJECT_NAME=$(python3 -c "import json;print(json.load(open('.vercel/project.json')).get('projectName',''))" 2>/dev/null || true)
echo "Linked project: ${PROJECT_NAME:-unknown}"
if [ "${PROJECT_NAME:-}" = "proxicore-visor" ]; then
  echo "Refusing to continue: this is linked to proxicore-visor, which is a different app." >&2
  echo "Re-link with: vercel link --project shoppa" >&2
  exit 1
fi

add() {
  local name="$1" value="$2"; shift 2
  for target in "$@"; do
    vercel env rm "$name" "$target" --yes >/dev/null 2>&1 || true
    printf '%s' "$value" | vercel env add "$name" "$target" >/dev/null
  done
  echo "  set $name ($*)"
}

# 32 bytes of hex. This is the only thing standing between the public internet
# and an endpoint that spends your odds credits, so it is generated, not chosen.
CRON_SECRET=$(openssl rand -hex 32)

echo
echo "Setting the scheduler secret and the margin..."
add CRON_SECRET    "$CRON_SECRET" production preview
add ODDS_MARGIN_PCT "4"           production preview

echo
echo "----------------------------------------------------------------------"
echo "TWO THINGS LEFT, and both must be done in the dashboard:"
echo
echo "  Vercel -> project 'shoppa' -> Settings -> Environment Variables"
echo
echo "  1. ODDS_API_KEY              <- your key from the-odds-api.com"
echo "  2. SUPABASE_SERVICE_ROLE_KEY <- Supabase > Project Settings > API"
echo
echo "  Targets: Production + Preview.  Tick SENSITIVE on both."
echo
echo "  Without (2) the sync route returns DB_KEY_MISSING and there is"
echo "  nowhere to write fixtures -- it is the one people forget."
echo
echo "  Do not put either in this script or in .env.example: a billable key"
echo "  in a tracked file is a key that ends up in the bundle one refactor"
echo "  later."
echo "----------------------------------------------------------------------"
echo
echo "Then redeploy, because env only applies to new builds:"
echo "  vercel --prod"
echo
echo "And run the first sync by hand:"
echo "  curl -H \"Authorization: Bearer $CRON_SECRET\" \\"
echo "       https://shoppa-ten.vercel.app/api/feed/sync?dry=1"
echo
echo "dry=1 reports the plan without spending a credit. Drop it to fetch."
