#!/usr/bin/env bash
# Switches traffic back to the previous colour. This rolls back the APPLICATION only:
# database migrations are not reversed. That is safe as long as every migration was
# backward compatible (expand/contract), which deploy.sh relies on.
set -euo pipefail
cd "$(dirname "$0")"
# shellcheck disable=SC1091
source ./deploy.env
export IMAGE_PREFIX

ACTIVE="$(cat state/active-color)"
if [ "$ACTIVE" = "blue" ]; then PREVIOUS=green; else PREVIOUS=blue; fi
TAG="$(cat "state/$PREVIOUS-tag" 2>/dev/null || true)"
if [ -z "$TAG" ]; then echo "No previous deployment to roll back to." >&2; exit 1; fi
export COLOR="$PREVIOUS" TAG

docker compose -p "rms-$PREVIOUS" -f compose.app.yaml up -d --wait --wait-timeout 120 api web
docker compose -p "rms-$PREVIOUS" -f compose.app.yaml exec -T web wget -q -O /dev/null "http://127.0.0.1:8080/api/ready"
echo "upstream app { server web-$PREVIOUS:8080; }" > nginx/active/upstream.conf
docker compose -p rms-edge -f compose.edge.yaml exec -T edge nginx -t
docker compose -p rms-edge -f compose.edge.yaml exec -T edge nginx -s reload
echo "$PREVIOUS" > state/active-color
echo "Rolled back to $PREVIOUS ($TAG). $ACTIVE is still running; stop it once confirmed."
