#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/openfda}"
WEB_DIR="${WEB_DIR:-/var/www/neuromancer-page/openfda}"
BRANCH="${BRANCH:-feature/openfda-public-explorer}"
EXPECTED_TEXT="${EXPECTED_TEXT:-brought to you by Neuromancer}"
LOCAL_URL="${LOCAL_URL:-http://localhost/openfda/}"

cd "$APP_DIR"

echo "==> Updating repository"
git fetch origin "$BRANCH"
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"

echo "==> Installing dependencies"
npm ci

echo "==> Building for /openfda"
npm run build:case
npm run check

echo "==> Publishing build to $WEB_DIR"
sudo mkdir -p "$WEB_DIR"
sudo rsync -av --delete dist/ "$WEB_DIR"/

echo "==> Reloading Caddy"
sudo systemctl reload caddy

echo "==> Verifying local HTTP response"
curl -fsS "$LOCAL_URL" -o /tmp/openfda-case-index.html
grep -q '<div id="app"></div>' /tmp/openfda-case-index.html
asset_path="$(grep -o '/openfda/assets/[^" ]*\.js' /tmp/openfda-case-index.html | head -1)"
if [[ -z "$asset_path" ]]; then
  echo "Could not find built JS asset path in served HTML" >&2
  exit 1
fi
curl -fsS "http://localhost${asset_path}" -o /tmp/openfda-case-app.js
grep -q "$EXPECTED_TEXT" /tmp/openfda-case-app.js

echo "Deploy verified: $EXPECTED_TEXT"
