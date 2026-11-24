#!/bin/bash
# DeepCode Studio on this computer, served to the internet through Tailscale Funnel.
#   ./setup.sh          build + start the server (Postgres and Redis start with it)
#   ./setup.sh update   rebuild with the latest code and restart
#   ./setup.sh stop     stop the whole stack (the public site goes down)
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -f ../render/render.env ]; then
  echo "infra/render/render.env is missing (the production secrets)." >&2; exit 1
fi

if [ ! -f .env ]; then
  umask 077
  {
    echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)"
    echo "REDIS_PASSWORD=$(openssl rand -hex 24)"
  } > .env
  echo "Created .env with database and cache passwords."
fi

if [ ! -f home.env ]; then
  umask 077
  {
    echo "# Generated $(date -u +%F). Keep private; never commit."
    echo "# The edge secret is derived from GATEWAY_INTERNAL_TOKEN (see infra/render/start.sh)."
    echo "# This computer has more memory than the free host."
    echo "GATEWAY_HEAP_MB=1024"
    echo "WEB_HEAP_MB=1024"
    echo "RELAY_HEAP_MB=128"
    echo ""
    echo "# Public address: replace with your Tailscale Funnel host if it differs."
    echo "APP_URL=https://alsrkal.tail31ef3c.ts.net"
    echo "NEXT_PUBLIC_GATEWAY_URL=https://alsrkal.tail31ef3c.ts.net"
    echo "GATEWAY_PUBLIC_WEB_ORIGIN=https://alsrkal.tail31ef3c.ts.net"
  } > home.env
  echo "Created home.env."
fi

if [ ! -d storage ]; then
  mkdir -p storage
  chown 1000:1000 storage 2>/dev/null || true
  chmod 700 storage
fi

case "${1:-start}" in
  stop) docker compose down; exit 0 ;;
  update|start) docker compose up -d --build ;;
  *) echo "usage: $0 [start|update|stop]" >&2; exit 2 ;;
esac

echo "Waiting for the server…"
for _ in $(seq 1 120); do
  if curl -sf http://127.0.0.1:10000/readyz >/dev/null; then
    echo "Home server is up on 127.0.0.1:10000."
    break
  fi
  sleep 3
done

if command -v tailscale >/dev/null && tailscale status >/dev/null 2>&1; then
  host=$(tailscale status --json | python3 -c 'import json,sys; print(json.load(sys.stdin)["Self"]["DNSName"].rstrip("."))')
  echo
  echo "Tailscale is connected: $host"
  if tailscale funnel status 2>/dev/null | grep -q "Funnel on"; then
    code=$(curl -s -m 20 -o /dev/null -w '%{http_code}' "https://$host/readyz" || true)
    if [ "$code" = "200" ]; then
      echo "Public site: https://$host — served by this computer."
    else
      echo "Public site did not answer (HTTP $code). Check: sudo tailscale funnel status"
    fi
  else
    echo "Turn on the public tunnel (once; it survives restarts):"
    echo "    sudo tailscale funnel --bg 10000"
  fi
  echo
  echo "Backups: ./backup.sh  (a daily copy is installed in the user's crontab)"
  echo "Desktop app: set the endpoint to https://$host, or build with"
  echo "    DEEPCODE_GATEWAY_URL=https://$host DEEPCODE_WEB_ORIGIN=https://$host"
else
  echo
  echo "Next: install Tailscale and sign in (see README.md), then run ./setup.sh again."
fi
