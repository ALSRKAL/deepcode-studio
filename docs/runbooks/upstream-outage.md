# Runbook: upstream outage

**Trigger:** sustained `upstream_unavailable` 503s, all pool keys cooling, or the
provider status page reports an incident.

## Detect

- Alert: `deepcode_pool_keys{status="cooling"}` at max while `active` is low for
  > 60 s (docs/plan/02 §9).
- Client surface: `503 upstream_unavailable` with `Retry-After`.

## Immediate

1. Check the provider status page (OpenCode Go) for a declared incident.
2. Confirm it is upstream, not us: `curl http://127.0.0.1:8790/readyz` (gateway
   itself healthy) and one direct provider request with a test key from a
   workstation — never from the pool.
3. If the outage is provider-wide: nothing to fix locally; communicate ETA. The
   gateway keeps retrying keys as cooldowns expire (5 s → 5 min backoff).

## Mitigations in order

1. Enable the fallback provider for paid plans (admin → plans → fallbackEnabled;
   the fallback provider row + keys must already exist — ADR-001).
2. If the outage will outlive the billing period, prepare credits-extends for
   affected subscribers (admin → users → adjust credits; reasons are audited).
3. Do NOT weaken error sanitisation or forward upstream bodies to clients (§7).

## Recovery

- Cooldowns self-heal; /metrics `pool_keys{status="cooling"}` drains.
- Disable the fallback again once the primary recovers (fallback traffic share
  is visible in /admin).
- Write a postmortem entry: detection time, provider comms, subscriber impact.
