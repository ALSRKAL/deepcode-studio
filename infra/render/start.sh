#!/bin/bash
# Starts migrations, then gateway + web + Caddy; if any process exits, the
# container exits so the platform restarts it (tini reaps children).
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${REDIS_URL:?REDIS_URL is required}"

# Internal wiring: the web portal reaches the gateway inside the container.
export GATEWAY_URL="${GATEWAY_URL:-http://127.0.0.1:8790}"
export GATEWAY_PORT=8790

# Proxy mode (infra/home/README.md):
#   DEEPCODE_ROLE=home   your PC behind Tailscale Funnel; only answers the front server.
#   HOME_ORIGIN=<host>   front (Render): home server first, this container as fallback.
#   neither              serve everything here (default).
# The front/home shared secret is derived from GATEWAY_INTERNAL_TOKEN (already identical on
# both sides), so nothing extra has to be typed into the host; HOME_EDGE_TOKEN overrides it.
if [ -z "${HOME_EDGE_TOKEN:-}" ] && [ -n "${GATEWAY_INTERNAL_TOKEN:-}" ]; then
  HOME_EDGE_TOKEN="$(node -e 'process.stdout.write(require("node:crypto").createHmac("sha256", process.env.GATEWAY_INTERNAL_TOKEN).update("deepcode-home-edge").digest("hex"))')"
  export HOME_EDGE_TOKEN
fi
if [ "${DEEPCODE_ROLE:-}" = "home" ]; then
  : "${HOME_EDGE_TOKEN:?HOME_EDGE_TOKEN is required in home mode}"
  CADDY_CONFIG=/app/caddy/home.caddy
elif [ -n "${HOME_ORIGIN:-}" ] && [ -n "${HOME_EDGE_TOKEN:-}" ]; then
  # A bare host means HTTPS (Tailscale Funnel); an explicit http:// URL is for local tests.
  case "$HOME_ORIGIN" in
    http://*|https://*) export HOME_URL="${HOME_ORIGIN%/}" ;;
    *) export HOME_URL="https://${HOME_ORIGIN%/}" ;;
  esac
  CADDY_CONFIG=/app/caddy/front.caddy
else
  CADDY_CONFIG=/app/caddy/origin.caddy
fi
export DEEPCODE_SERVER_NAME="$([ "${DEEPCODE_ROLE:-}" = home ] && echo home || echo cloud)"
echo "[start] proxy mode: $(basename "$CADDY_CONFIG" .caddy)"

echo "[start] running database migrations"
node /app/gateway/dist/migrate.js

echo "[start] gateway"
NODE_OPTIONS="--max-old-space-size=${GATEWAY_HEAP_MB:-160}" node /app/gateway/dist/server.js &
GATEWAY_PID=$!

echo "[start] web"
(cd /app/web/apps/web && PORT=3000 HOSTNAME=127.0.0.1 NODE_OPTIONS="--max-old-space-size=${WEB_HEAP_MB:-200}" exec node server.js) &
WEB_PID=$!

echo "[start] remote-control relay"
ZCODE_RELAY_HOST=127.0.0.1 ZCODE_RELAY_PORT=8443 ZCODE_RELAY_TRUST_PROXY=1 ZCODE_RELAY_MOBILE_DIR=/app/remote/mobile \
  NODE_OPTIONS="--max-old-space-size=${RELAY_HEAP_MB:-64}" node /app/remote/relay.mjs &
RELAY_PID=$!

echo "[start] proxy on :${PORT:-10000}"
caddy run --config "$CADDY_CONFIG" --adapter caddyfile &
CADDY_PID=$!

trap 'kill -TERM $GATEWAY_PID $WEB_PID $CADDY_PID $RELAY_PID 2>/dev/null || true' TERM INT
set +e
wait -n $GATEWAY_PID $WEB_PID $CADDY_PID $RELAY_PID
status=$?
echo "[start] a process exited (status $status); stopping the container"
kill -TERM $GATEWAY_PID $WEB_PID $CADDY_PID $RELAY_PID 2>/dev/null || true
wait
exit "$status"
