#!/usr/bin/env bash
#
# Deploys Lifecycle Hub to Azure App Service.
#
# The large synthetic files are not in the repo -- they are deterministic from
# the seed, so they are regenerated here rather than carried around. The
# ground-truth file is stripped from the package explicitly: Next's file
# tracing pulls the whole data directory in, and shipping the simulator's
# answer key to production would undermine the one property the evaluation
# rests on.
#
# Usage: ./scripts/deploy-azure.sh
set -euo pipefail

APP=lifecycle-hub
RG=clustral-rg

cd "$(dirname "$0")/.."

echo "==> regenerating dataset from seed"
npm run generate >/dev/null
npm run precompute >/dev/null

echo "==> building"
npx next build

echo "==> assembling package"
rm -rf .deploy deploy.zip
mkdir -p .deploy
cp -R .next/standalone/. .deploy/
mkdir -p .deploy/.next
cp -R .next/static .deploy/.next/static
cp -R public .deploy/public
mkdir -p .deploy/data/synthetic
for f in network.json telemetry.json map.json documents.json zone-series.json \
         backtest.json nutrient-findings.json nutrient-report.json; do
  [ -f "data/synthetic/$f" ] && cp "data/synthetic/$f" .deploy/data/synthetic/
done
# Cached third-party evidence travels with the build so a demo is deterministic
# and costs no quota. Entries carry a 7-day TTL and refresh themselves.
[ -d .cache ] && cp -R .cache .deploy/.cache

# Non-negotiable: the answer key must never reach production.
find .deploy -name "_ground-truth.json" -delete
if find .deploy -name "_ground-truth.json" | grep -q .; then
  echo "FATAL: ground truth present in deployment package" >&2
  exit 1
fi

echo "==> zipping"
(cd .deploy && zip -qr ../deploy.zip . -x "*.DS_Store")
du -h deploy.zip | awk '{print "    " $1}'

echo "==> deploying to $APP"
az webapp deploy -n "$APP" -g "$RG" --src-path deploy.zip --type zip --only-show-errors >/dev/null

echo "==> waiting for health"
for _ in $(seq 1 40); do
  if curl -sf --max-time 10 "https://$APP.azurewebsites.net/api/health" >/dev/null 2>&1; then
    echo "    healthy"
    break
  fi
  sleep 8
done

curl -s --max-time 20 "https://lifecyclehub.clustralai.com/api/health" && echo
echo "==> https://lifecyclehub.clustralai.com"
