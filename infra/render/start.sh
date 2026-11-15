#!/bin/bash
# Starts migrations, then gateway + web + Caddy; if any process exits, the
# container exits so the platform restarts it (tini reaps children).
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${REDIS_URL:?REDIS_URL is required}"

# Internal wiring: the web portal reaches the gateway inside the container.
export GATEWAY_URL="${GATEWAY_URL:-http://127.0.0.1:8790}"
export GATEWAY_PORT=8790

echo "[start] running database migrations"
node /app/gateway/dist/migrate.js

echo "[start] gateway"
NODE_OPTIONS="--max-old-space-size=${GATEWAY_HEAP_MB:-160}" node /app/gateway/dist/server.js &
GATEWAY_PID=$!

echo "[start] web"
(cd /app/web/apps/web && PORT=3000 HOSTNAME=127.0.0.1 NODE_OPTIONS="--max-old-space-size=${WEB_HEAP_MB:-200}" exec node server.js) &
WEB_PID=$!

echo "[start] proxy on :${PORT:-10000}"
caddy run --config /app/Caddyfile --adapter caddyfile &
CADDY_PID=$!

trap 'kill -TERM $GATEWAY_PID $WEB_PID $CADDY_PID 2>/dev/null || true' TERM INT
set +e
wait -n $GATEWAY_PID $WEB_PID $CADDY_PID
status=$?
echo "[start] a process exited (status $status); stopping the container"
kill -TERM $GATEWAY_PID $WEB_PID $CADDY_PID 2>/dev/null || true
wait
exit "$status"
