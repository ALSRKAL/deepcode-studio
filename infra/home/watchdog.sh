#!/usr/bin/env bash
# Restarts the DeepCode container when it is alive but stuck (2026-11-21).
#
# Docker's "restart: unless-stopped" only acts when the process exits; a hung app
# (health check failing) stays down. Run every 2 minutes from cron:
#   */2 * * * * cd ".../infra/home" && ./watchdog.sh >> "$HOME/deepcode-backups/watchdog.log" 2>&1
# Two consecutive failed checks (about 4 minutes) trigger one restart, so a slow
# moment or a deploy in progress never causes a restart loop.
set -u
cd "$(dirname "$0")"

state_file="${XDG_STATE_HOME:-$HOME/.local/state}/deepcode-watchdog.failures"
mkdir -p "$(dirname "$state_file")"
failures=$(cat "$state_file" 2>/dev/null || echo 0)

now() { date '+%Y-%m-%d %H:%M:%S'; }

# A deploy (docker compose up --build) is running: do not interfere.
if pgrep -f "docker compose up" >/dev/null 2>&1 || pgrep -f "docker-compose up" >/dev/null 2>&1; then
  exit 0
fi

if curl -fsS --max-time 10 http://127.0.0.1:10000/readyz >/dev/null 2>&1; then
  [ "$failures" != 0 ] && echo "$(now) recovered after $failures failed check(s)"
  echo 0 >"$state_file"
  exit 0
fi

failures=$((failures + 1))
echo "$failures" >"$state_file"
echo "$(now) readiness check failed ($failures)"

if [ "$failures" -ge 2 ]; then
  echo "$(now) restarting the deepcode stack"
  docker compose up -d >/dev/null 2>&1 || true
  docker compose restart deepcode >/dev/null 2>&1 || true
  echo 0 >"$state_file"
fi
