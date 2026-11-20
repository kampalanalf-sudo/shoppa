#!/usr/bin/env bash
# scripts/set-vercel-env.sh
#
# Sets the FloatBet environment variables on the Vercel project that serves
# floatbet.space.
#
# Why a script: the connected Vercel integration authenticates as
# charlielwanga88-4249, and that project lives in the `iuearadio` account, so
# the integration cannot reach it. This uses the Vercel CLI with your own login.
#
# Usage:
#   vercel login
#   vercel link            # link this directory to the *shoppa* project
#   ./scripts/set-vercel-env.sh
#
# It prompts for the two secrets instead of taking them as arguments, so they
# never land in your shell history or in `ps` output.

set -euo pipefail

if ! command -v vercel >/dev/null 2>&1; then
  echo "vercel CLI not found. Install it: npm i -g vercel" >&2
  exit 1
fi

if [ ! -f .vercel/project.json ]; then
  echo "This directory is not linked to a Vercel project. Run: vercel link" >&2
  echo "Link it to the project named shoppa:  vercel link --project shoppa" >&2
  exit 1
fi

PROJECT_NAME=$(python3 -c "import json;print(json.load(open('.vercel/project.json')).get('projectName',''))" 2>/dev/null || true)
echo "Linked project: ${PROJECT_NAME:-unknown}"
# The live project was renamed proxicore-visor -> shoppa. Refuse anything else,
# because setting environment variables on the wrong project looks like success
# and changes nothing.
if [ "${PROJECT_NAME:-}" != "shoppa" ]; then
  echo "Refusing to continue: this is linked to '${PROJECT_NAME:-unknown}', not 'shoppa'." >&2
  echo "Re-link with: vercel link --project shoppa" >&2
  exit 1
fi

SUPABASE_URL="https://dtroufrfavmjldtlprpn.supabase.co"
ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR0cm91ZnJmYXZtamxkdGxwcnBuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTUwNDQyMTAsImV4cCI6MjExMDYyMDIxMH0.LIafhBin2Uy_tx4OWDtRu-DZ6fca3atMz9Ht-XUmf2s"
STORE_URL="https://dgatewayadmin.desispay.com/store/shop/floatbet?products"

# add <name> <value> <targets...>
add() {
  local name="$1" value="$2"; shift 2
  for target in "$@"; do
    vercel env rm "$name" "$target" --yes >/dev/null 2>&1 || true
    printf '%s' "$value" | vercel env add "$name" "$target" >/dev/null
  done
  echo "  set $name ($*)"
}

echo "Setting public + non-secret values..."
add APP_URL                 "https://floatbet.space"  production preview
add DGATEWAY_API_URL        "https://dgatewayapi.desispay.com" production preview
add DGATEWAY_STORE_SLUG     "floatbet"                       production preview
add SUPABASE_URL            "$SUPABASE_URL"                  production preview
add VITE_SUPABASE_URL       "$SUPABASE_URL"                  production preview
add VITE_SUPABASE_ANON_KEY  "$ANON_KEY"                      production preview
add VITE_DGATEWAY_STORE_URL "$STORE_URL"                     production preview

echo
echo "Now the secrets. Input is hidden and nothing is echoed back."
read -r -s -p "DGATEWAY_API_KEY (dgw_live_...): " DG_KEY; echo
read -r -s -p "DGATEWAY_WEBHOOK_SECRET: "       DG_WH;  echo

if [ -z "${DG_KEY}" ] || [ -z "${DG_WH}" ]; then
  echo "Both secrets are required. Nothing secret was set; re-run when you have them." >&2
  exit 1
fi

add DGATEWAY_API_KEY        "$DG_KEY" production preview
add DGATEWAY_WEBHOOK_SECRET "$DG_WH"  production preview

echo
echo "Also set these by hand in the Vercel dashboard (sensitive):"
echo "  SUPABASE_SERVICE_ROLE_KEY   <- Supabase > Project Settings > API > service_role"
echo "  (the CLI cannot mark a variable 'sensitive'; the dashboard can)"
echo
echo "Done. Redeploy so the functions pick up the new values:"
echo "  vercel --prod"
