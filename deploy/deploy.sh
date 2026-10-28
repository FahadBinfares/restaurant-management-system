#!/usr/bin/env bash
# Blue/green deployment of an already-built image tag.
#
#   ./deploy.sh <tag>
#
# 1. Pull the tag into the inactive colour.
# 2. Apply database migrations (must be backward compatible: expand, never contract,
#    because the active colour keeps serving traffic on the old code).
# 3. Start the inactive colour and wait for health checks.
# 4. Verify readiness through the new web container.
# 5. Switch the edge proxy and reload it (no dropped connections).
# 6. Stop the previous colour after a grace period; it stays available for rollback.
set -euo pipefail

TAG="${1:?usage: deploy.sh <image-tag>}"
[[ "$TAG" =~ ^[0-9a-f]{40}$ ]] || { echo "Tag must be a full commit SHA" >&2; exit 1; }
cd "$(dirname "$0")"
# shellcheck disable=SC1091
source ./deploy.env   # IMAGE_PREFIX, SERVER_NAME
export IMAGE_PREFIX TAG

mkdir -p state nginx/active
ACTIVE="$(cat state/active-color 2>/dev/null || echo none)"
if [ "$ACTIVE" = "blue" ]; then NEXT=green; else NEXT=blue; fi
export COLOR="$NEXT"
app() { docker compose -p "rms-$NEXT" -f compose.app.yaml "$@"; }

echo "Deploying $TAG to $NEXT (active: $ACTIVE)"
docker network inspect rms >/dev/null 2>&1 || docker network create rms >/dev/null

app --profile migrate pull
app --profile migrate run --rm migrate
app up -d --wait --wait-timeout 120 api web

echo "Checking readiness through web-$NEXT"
app exec -T web wget -q -O /dev/null "http://127.0.0.1:8080/api/ready"

echo "upstream app { server web-$NEXT:8080; }" > nginx/active/upstream.conf.new
mv nginx/active/upstream.conf.new nginx/active/upstream.conf
if [ -z "$(docker compose -p rms-edge -f compose.edge.yaml ps -q edge)" ]; then
  docker compose -p rms-edge -f compose.edge.yaml up -d
fi
docker compose -p rms-edge -f compose.edge.yaml exec -T edge nginx -t
docker compose -p rms-edge -f compose.edge.yaml exec -T edge nginx -s reload
echo "$NEXT" > state/active-color
echo "$TAG" > "state/$NEXT-tag"
echo "Traffic now on $NEXT ($TAG)"

if [ "$ACTIVE" != "none" ]; then
  sleep "${DRAIN_SECONDS:-30}"
  COLOR="$ACTIVE" TAG="$(cat "state/$ACTIVE-tag")" \
    docker compose -p "rms-$ACTIVE" -f compose.app.yaml stop
  echo "Stopped $ACTIVE; run ./rollback.sh to switch back."
fi
