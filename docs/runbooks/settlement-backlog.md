# Runbook: settlement backlog

**Trigger:** `deepcode_settlement_pending_depth` > 100 (alert, docs/plan/02 §9)
or the /admin health panel shows a growing pending depth. Charges sit in the
Redis write-ahead stream `settle:pending` until committed.

## Understand the pipeline

- submit() → Redis `settle:pending` (write-ahead) → batch commit every 100 ms →
  entry deleted. A drainer retries entries older than 30 s every 5 s.
- Poison records (SQLSTATE 22/23/42) go to `settle:dead` with an alert; they are
  never retried and never block other records.

## Immediate

1. `redis-cli XLEN settle:pending` — the backlog size.
2. `redis-cli XLEN settle:dead` — if this grows, records are being REJECTED by
   Postgres (schema drift or data bug), not delayed. Go to "Dead-letter triage".
3. Check Postgres health: connections (`SELECT count(*) FROM pg_stat_activity`),
   lock waits on `subscriptions` (the hottest row lock), disk.

## If transient (Postgres slow/restarted)

- The drainer catches up automatically; watch the depth fall. No manual action.
- If an instance crashed with buffered records, every entry is already in the
  Redis stream — the drainer (or another instance) settles them idempotently
  on `request_id`.

## Dead-letter triage

1. Inspect one entry:
   ```bash
   redis-cli XRANGE settle:dead - + COUNT 1
   ```
   The `error` field holds the Postgres message (truncated).
2. Fix the schema/data cause, then re-enqueue:
   ```bash
   redis-cli XADD settle:pending '*' rec <rec-json>
   redis-cli DEL settle:dead   # after re-enqueueing ALL entries (XLEN first!)
   ```
   The record is idempotent on `request_id` — replays cannot double-charge.

## Never

- Never delete `settle:pending` entries without re-enqueueing — that is lost revenue.
- Never widen the poison classification to swallow transient errors.
