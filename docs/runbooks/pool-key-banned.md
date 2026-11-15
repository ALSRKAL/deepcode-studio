# Runbook: pool key banned / auth_failed

**Trigger:** gateway log `pool key authentication failed; removed from rotation`
(`alert: true`), or /admin/pool shows a key in `auth_failed`. The upstream account
was banned, the key was rotated, or the credential is wrong.

## Immediate (≤ 5 min)

1. Confirm scope:
   ```bash
   curl -s -H "Authorization: Bearer $GATEWAY_INTERNAL_TOKEN" http://127.0.0.1:8790/metrics | grep pool_keys
   ```
   `pool_keys{status="auth_failed"}` ≥ 1 and `active` dropping means traffic is
   failing over to the remaining keys — check their cooling state.
2. If ALL keys are `auth_failed` or cooling, requests get `503 upstream_unavailable`.
   Post a status notice; the provider abstraction (ADR-001) exists exactly for this.

## Diagnosis

1. /admin/pool → row detail: last error code (`http_401` vs `http_403`), last error time.
2. Cross-check the provider's dashboard: is the account banned, quota-reset, or key rotated?
3. Never paste a pool key into the provider dashboard or logs — keys are write-only
   (docs/plan/04 §3.1). Rotate by *adding* a new key and deleting the dead one.

## Recovery

1. Obtain a fresh upstream key/credential.
2. /admin/pool → Add key (write-only form; the value is never displayed again).
   The gateway reloads the pool automatically (reloadPool invalidate).
3. Set the dead key to `disabled` (or delete it); optionally keep it for audit.
4. Verify: `/metrics` shows `pool_keys{status="active"}` ≥ 1 and `cooling` drains
   within one cooldown cycle.

## Follow-up

- More than one auth_failed in 7 days on the same provider → open a provider-risk
  review (ADR-001: upstream concentration is the standing risk; consider enabling a
  fallback provider for paid plans).
- All pool-key events are in /admin/audit.
