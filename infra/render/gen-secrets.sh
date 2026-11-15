#!/usr/bin/env bash
# Generates the server secrets for a hosted deploy into a private file (never
# printed to the terminal). Paste each value into the Render dashboard and keep
# the file somewhere safe: losing POOL_KEY_ENCRYPTION_KEY makes stored upstream
# keys unreadable; losing KEY_HASH_PEPPER invalidates every issued API key.
#
#   infra/render/gen-secrets.sh            → writes infra/render/secrets.env (chmod 600)
set -euo pipefail
out="$(dirname "$0")/secrets.env"
if [[ -e "$out" ]]; then
  echo "refusing to overwrite $out (move it away first)" >&2
  exit 1
fi
umask 077
rand() { openssl rand -base64 32 | tr -d '\n'; }
signing_key="$(openssl genpkey -algorithm ed25519 -outform DER | base64 | tr -d '\n')"
{
  echo "POOL_KEY_ENCRYPTION_KEY=$(rand)"
  echo "KEY_HASH_PEPPER=$(rand)"
  echo "AUTH_SECRET=$(openssl rand -base64 48 | tr -d '\n')"
  echo "GATEWAY_INTERNAL_TOKEN=$(openssl rand -hex 32)"
  echo "MANIFEST_SIGNING_KEY=$signing_key"
} > "$out"
chmod 600 "$out"
echo "wrote $out (values not shown). Copy them into Render → Environment."
