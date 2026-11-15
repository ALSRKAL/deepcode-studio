# Runbook: webhook failure (billing)

**Trigger:** provider webhook deliveries failing (Stripe dashboard retries), or
mock/test-mode webhook returning 4xx/5xx; billing events not applying.

## Pipeline recap (docs/plan/03 §5.1)

- Raw body → signature verification (adapter; Stripe over the RAW body) →
  insert `billing_events` (unique provider+providerEventId) → apply state change
  in one transaction → gateway cache invalidate.
- Duplicate event = acknowledged, `applied: false`. A failed signature = 400, no
  state change, no leak of why.

## Triage

1. **400 bad_signature**: wrong `STRIPE_WEBHOOK_SECRET` (rotated?) or a proxy
   re-serialised the body. Webhooks MUST be verified against the exact raw bytes.
2. **422 bad_event**: known signature but unhandled type or missing metadata
   (checkout.session.completed without `client_reference_id`/`planId`). Check the
   Stripe CLI payload against `mapStripeEvent`.
3. **Repeated deliveries**: check `billing_events` — if the event row exists with
   `processed_at` set, the apply step failed AFTER the insert; the unique index
   makes retries no-ops forever. Fix the apply cause, then apply manually:
   replay the stored payload through `handleBillingEvent` (idempotent).

## Renewal waves

- A failed renewal wave leaves subscriptions on the old period (expired at period
  end → gateway lock). After the provider recovers, trigger a dunning/replay and
  watch `/dashboard` banners + gateway `subscription_expired` rate.

## Mock/test mode

- Local checkout posts to `/api/webhooks/mock` with an HMAC over the raw body
  (`MOCK_BILLING_WEBHOOK_SECRET`). A 400 there means the secret drifted between
  the web process and the caller.
