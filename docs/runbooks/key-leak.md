# Runbook: key leak response (upstream pool key or virtual key)

**Scope:** a pool (upstream) key exposed outside the gateway process, or a
`sk-dc-…` virtual key exposed to the wrong party.

## Upstream pool key exposed

The key lives only as AES-256-GCM ciphertext in `upstream_pool_keys` and as
plaintext inside gateway process memory (docs/plan/04 §3.1). If it leaked anyway
(pasted in a screenshot, committed by accident, dumped from a compromised host):

1. **Revoke at the provider first** — rotate/delete the credential in the
   provider dashboard. Our side cannot un-leak it.
2. Remove the key from the pool: /admin/pool → delete (audit records the actor).
3. Scan history for the value:
   ```bash
   gitleaks detect --source . --log-opts="--all" -c .gitleaks.toml
   ```
   A hit in git history (even unpushed) → treat as leaked; rotate regardless.
4. Re-encrypt if the ciphertext store itself is suspect (rotation drill,
   docs/plan/04 §3.1: re-encrypt with a new `POOL_KEY_ENCRYPTION_KEY` keyVersion
   in staging without downtime, then prod in a maintenance window).
5. Check the provider's usage dashboard for foreign spend since the exposure.

## Virtual key (customer key) exposed

1. Revoke: /admin/users → revoke all keys (or /dashboard/keys → revoke if it is
   the user reporting). Revocation reaches the gateway in < 1 s
   (`/internal/invalidate`; the 30 s snapshot TTL is the backstop).
2. Quantify the damage: `usage_logs` by `key_id` since the first suspicious
   entry; usage the customer disclaims → credit adjustment with a reason
   (audit-trailed).
3. Check concurrency anomalies (many IPs on one key — doc 04 risk register).

## Post-incident (both)

- Root-cause HOW it leaked: log redaction is in place, but check for manual
  `console.log` of key objects during debugging, or a support agent pasting a
  fingerprint-bearing object. PoolKey objects only ever serialise the
  fingerprint — verify no code path constructs a plaintext string.
- Update the leak checklist in docs/plan/04 §3.1 with any gap found.
