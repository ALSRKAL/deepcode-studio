#!/bin/bash
# Prepare this computer as the DeepCode home server (see README.md).
#   ./setup.sh          build + start the server, print what to set on Render
#   ./setup.sh update   rebuild with the latest code and restart
#   ./setup.sh stop     stop it (Render serves everyone)
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -f ../render/render.env ]; then
  echo "infra/render/render.env is missing (the production settings)." >&2; exit 1
fi
if [ ! -f home.env ]; then
  umask 077
  {
    echo "# Generated $(date -u +%F). Keep private; never commit."
    echo "HOME_EDGE_TOKEN=$(openssl rand -hex 32)"
    echo "# This computer has more memory than the free host."
    echo "GATEWAY_HEAP_MB=1024"
    echo "WEB_HEAP_MB=1024"
    echo "RELAY_HEAP_MB=128"
  } > home.env
  echo "Created home.env with a new edge secret."
fi

case "${1:-start}" in
  stop) docker compose down; exit 0 ;;
  update|start) docker compose up -d --build ;;
  *) echo "usage: $0 [start|update|stop]" >&2; exit 2 ;;
esac

echo "Waiting for the server…"
for _ in $(seq 1 60); do
  # Direct local calls carry the secret too (the home server answers nobody else).
  if curl -sf -H "X-DeepCode-Edge: $(grep ^HOME_EDGE_TOKEN= home.env | cut -d= -f2-)" http://127.0.0.1:10000/readyz >/dev/null; then
    echo "Home server is up on 127.0.0.1:10000."
    break
  fi
  sleep 3
done

if command -v tailscale >/dev/null && tailscale status >/dev/null 2>&1; then
  host=$(tailscale status --json | python3 -c 'import json,sys; print(json.load(sys.stdin)["Self"]["DNSName"].rstrip("."))')
  echo
  echo "Tailscale is connected: $host"
  echo "Turn on the public tunnel (once; it survives restarts):"
  echo "    sudo tailscale funnel --bg 10000"
  echo
  echo "Then on Render (service → Environment) set:"
  echo "    HOME_ORIGIN=$host"
  echo "    HOME_EDGE_TOKEN=<the value in infra/home/home.env>"
else
  echo
  echo "Next: install Tailscale and sign in (see README.md), then run ./setup.sh again."
fi
