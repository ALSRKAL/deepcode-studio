#!/bin/bash
# Dump the local Postgres database and keep the last 14 daily copies.
# Installed in the user's crontab by setup; run it by hand any time.
set -euo pipefail
cd "$(dirname "$0")"

DEST="${DEEPCODE_BACKUP_DIR:-$HOME/deepcode-backups}"
mkdir -p "$DEST"
chmod 700 "$DEST"

STAMP="$(date -u +%Y%m%d-%H%M)"
OUT="$DEST/deepcode-$STAMP.dump"

docker compose exec -T postgres pg_dump -U deepcode -d deepcode -Fc > "$OUT"
chmod 600 "$OUT"
find "$DEST" -maxdepth 1 -name 'deepcode-*.dump' -type f -mtime +14 -delete

echo "backup: $OUT ($(du -h "$OUT" | cut -f1))"
