# 04 — Execution Roadmap and Verification

**Status:** Phase 0 and Phase 1 in progress since 2026-11-14 (approved). Checkboxes below reflect what is built and verified; notes in *italics* say what is not.

Each phase ends with an exit gate. A phase is done when its gate passes, not when its code is written.

---

## Phase 0 — Foundations (short, before Phase 1)

- [x] Root repo: `git init`, root `pnpm-workspace.yaml` (gateway, web, packages — **not** `apps/desktop`), `turbo.json`, shared tsconfig/lint presets. *Presets live at the root (`tsconfig.base.json`, oxlint) rather than a `packages/config` package; split out when `apps/web` arrives. Nothing committed yet.*
- [x] Toolchain pin: `.nvmrc` = Node 24.22.3, `packageManager` = pnpm 10.33.2 for both workspaces. Installed through nvm on the dev machine.
- [~] `apps/desktop`: upstream commit `e5346dec` recorded; unmodified fork **builds**: `bootstrap` (install + build) passed in 53 min and `pnpm typecheck` passed with 0 errors on 2026-11-14. *`pnpm dev:desktop` not launched (opens a window and contacts Z.ai production endpoints; left for the owner). Subtree conversion is Phase 3; until then `apps/desktop/` is git-ignored by the root repo.*
- [x] `infra/docker-compose.yml`: PostgreSQL 16, Redis 7 (ports 55432 / 56379; `pnpm infra:up`).
- [x] `packages/shared`: contracts from doc 00 §5 as zod schemas, credit arithmetic, UUIDv7, virtual-key and pool-key-encryption helpers (`/node` entry).
- [x] CI skeleton: build, typecheck, lint, test on every push (`.github/workflows/ci.yml`). *Not yet run on GitHub: no remote.*
- [~] Secret scanning: gitleaks in CI with `.gitleaks.toml` rules for `sk-dc-` and upstream keys. *Pre-commit hook not installed: gitleaks is not on the dev machine.*

**Gate:** fresh clone → one command brings up Postgres and Redis; root `pnpm typecheck && pnpm test` passes; upstream desktop launches unmodified.

---

## Phase 1 — Gateway and database

- [x] `packages/db`: Drizzle schema (doc 02 §3), migrations, monthly partitioning for `usage_logs` (+ `ensure_usage_log_partitions()`), idempotent dev seed (OpenCode Go provider, 32 model routes and prices, placeholder plans, admin + dev user). Role grants: `packages/db/src/scripts/roles.ts` (`pnpm --filter @deepcode/db roles`, idempotent, run after migrations; test in `packages/db/test/roles.test.ts`). *24 of 32 model prices are placeholders — see `packages/db/src/catalog.ts`.*
- [~] Verify OpenCode Go details: base URLs, model list and prices read from the docs on 2026-11-14. *Auth header scheme, rate-limit error shape and streaming usage are not stated in the docs. **Needs one real Go API key** for a live request; fixtures are synthetic until then. The live upstream test was attempted on 2026-11-14 and skipped: `SEED_POOL_KEYS` is not set in `.env` — not done, needs a key.*
- [x] Gateway skeleton: Hono app, UUIDv7 request ids, JSON logging with sink-level redaction, error handler, `/healthz`, `/readyz`.
- [x] Virtual key generation + HMAC hashing library (shared with web).
- [x] Auth/authorisation chain, steps 1–8, Redis snapshot cache, negative cache, single-flight refill, per-IP failed-auth throttle.
- [x] Sliding-window RPM and concurrency limits (Lua, crash-safe).
- [x] Pool engine: decrypt + in-memory cache, least-loaded selection (Lua), per-model 429 cooldown, per-key 5xx backoff, auth-failure removal, retry-before-first-byte. Half-open probe: cooldown expiry admits the next real request (the probe); success closes the breaker, failure re-doubles the cooldown — covered in the G-19 test (2026-11-14).
- [x] Protocol adapters ×4: request mutation, passthrough stream, usage parser.
- [x] Credit calculation, reservation, write-ahead batched settlement, drainer, dead-letter for poison records.
- [x] Usage headers and `: deepcode-usage` stream notice (before the terminal event).
- [x] `GET /v1/subscription/status`, `GET /v1/models`, `POST /internal/invalidate`.
- [x] Mock upstream server for tests (all four protocols; 429 with `Retry-After`, 5xx, 401, mid-stream cut, missing usage, hang, byte-by-byte delivery, error bodies that echo the key).
- [~] Load test (k6, `apps/gateway/load/`): 150 concurrent streams. *Correctness passes; latency targets not met on the dev machine — see "Phase 1 results" below.*
- [x] Dockerfile (multi-stage, non-root, healthcheck), `dist/migrate.js` entry, graceful shutdown. Image built and smoke-tested.

**Gate:** all gateway tests in §2.1 green; load test meets the latency targets in doc 00 §1; leak tests in §3 green; a real request through one real upstream key streams correctly and is metered to the exact token counts the upstream reports.

### Phase 1 results (2026-11-14)

**Gate status: 2 of 4 met.**

| Gate item | Result |
|-----------|--------|
| Gateway tests (§2.1) | **Met.** 61 gateway + 10 shared tests pass, twice in a row. Covers G-01 to G-27 except G-28 (load), plus poison-record dead-lettering, byte-by-byte framing, weight tie-breaks, failed-auth throttle. Real Postgres 16 and Redis 7 via Testcontainers |
| Leak tests (§3.1) | **Met** for: error bodies echoing the key (JSON, HTML, `Location`), response headers (`set-cookie` and account headers dropped), every log line of the suite, pool-key object serialisation. *Not yet:* built-bundle grep (needs `apps/web` and a packaged desktop), DB-dump scan, rotation drill |
| Load test (G-28) | **Not met on the dev machine.** 150 concurrent streams for 60 s: 0 failed requests, 0 unmetered streams, charges reconcile exactly (usage rows = daily rollup = subscription balance; write-ahead stream empty). Gateway time-to-first-byte p50 258 ms / p99 3.75 s against targets of 15 ms / 50 ms. The machine was at load average 20–26 on 8 cores (other desktop apps plus the fork's typecheck), where a single Redis round trip measured ~6 ms. Re-run on an idle or dedicated host before judging the targets |
| Live request with a real key | **Not done: needs one OpenCode Go API key.** Load it with `SEED_POOL_KEYS=... pnpm db:seed` |

Load-test history on the same machine (150 streams, 60 s), showing what each fix bought:

| Version | Failures | Throughput | TTFB p50 | TTFB p99 |
|---------|---------:|-----------:|---------:|---------:|
| Per-request settlement transaction | 0 | 20 req/s | 423 ms | 25.6 s |
| + batched write-ahead settlement, single-flight snapshot | 0 | 57 req/s | 629 ms* | 7.1 s |
| + one-round-trip admission, async pool bookkeeping | 0 | 77 req/s | 258 ms | 3.75 s |

\* The median rose while p99 fell sharply. With nearly 3× the throughput, more requests were in flight at once on an overloaded machine; I have not isolated the cause further. The first run's 25.6 s p99 was the connection-pool starvation that batching removed.

**Step A closure (2026-11-14):** role grants + §3.3 test, `/metrics` (token-protected + optional `GATEWAY_METRICS_PORT` listener) and the G-19 half-open-probe behaviour landed; full root gate (`build`, `typecheck`, `lint`, `test`: 10 shared + 3 db-roles + 62 gateway tests) passed twice in a row. The live-upstream test stays open — `SEED_POOL_KEYS` is unset on this machine.

---

## Phase 2 — Web portal and auth

**2a — account and money**
- [x] Next.js app, Tailwind v4 tokens (doc 03 §1.3), fonts, `next-intl` with `ar`/`en`, base components with full state matrices. *Custom middleware (locale negotiation + CSP nonce + security headers) instead of next-intl's, so the nonce reaches Next's script pipeline.*
- [x] Auth: sign-up, verify, sign-in, reset, OAuth, 2FA; data-access layer guards. *Better Auth 1.7 + drizzle adapter; OAuth providers wired but inactive without credentials; TOTP 2FA in a dedicated `auth_two_factor` table; admins gated on `twoFactorEnabled` (`ADMIN_2FA_REQUIRED`).*
- [x] `/auth/desktop` consent + `POST /api/desktop/exchange` (PKCE, single-use code). *Params preserved across sign-in in a validated same-app `returnTo` path (review L13 replaced the earlier cookie); device limit surfaced before approval and enforced atomically at exchange.*
- [x] Dashboard: overview, usage (charts + history), keys, devices, settings. *Charts are hand-rolled SVG on the tokens with accessible table alternatives.*
- [x] Billing: provider interface, first provider adapter, webhooks with idempotency, renewal logic. *`mock` provider (owner decision 2 default) with a local signed-webhook checkout page + Stripe test-mode adapter; Stripe adapter refuses live keys; `plans.providerPriceId` column added.*
- [x] `/api/v1/client/configs`. *Virtual-key auth; origins + feature flags (`byok`, `managedSync`).*

**2b — public site and admin**
- [x] Landing page with interactive IDE preview, pricing, FAQ. *The preview is a React mock with a live RTL/LTR toggle; static frame under reduced motion.*
- [x] Download centre + `releases` table + `/api/v1/releases/electron/manifest`. *Manifest shape matches the desktop's `ManifestUpdateProvider` (YAML, electron-updater UpdateInfo, platform/channel query); sha2 = base64(SHA-256).*
- [x] Admin: pool manager, users and credit adjustments, plans, models/prices, marketplace publisher, releases, audit log. *Pool-key form is write-only (lint ban on decrypt imports); credit adjustments change `creditsLimit` (single writer preserved); skills/MCP presets signed per item at publish.*
- [x] Manifest signing for Skills/MCP sync; `GET /v1/sync/manifest` in the gateway. *Per-item Ed25519 signatures (the manifest is tier-filtered per requester, so a manifest-level signature cannot work); `If-None-Match: rev:<n>`.*
- [x] Legal pages (terms, privacy, acceptable use, open-source licences). *Clearly marked placeholder text for the owner.*

**Gate:** a new user can sign up, pay in the provider's test mode, see an active subscription, create a key, make a metered request through the gateway and watch the dashboard update; an admin can add a pool key and never see it again; web tests in §2.2 green; Lighthouse and axe budgets met in both locales. *Status 2026-11-15: 28 vitest integration tests (W-01…W-08, W-13) and 284 Playwright tests (W-02, W-09…W-12) green. The metered-request end-to-end path (checkout → key → request through the gateway → dashboard) is covered by the E2E suite §2.4 scenarios 1–2 in Phase 4 on staging. Owner decision 2026-11-15: the portal is light-themed (doc 03 §1.3) with the split-D identity (doc 03 §1.10); axe remains zero serious/critical. Lighthouse: `.lighthouserc.json` written; budgets not yet run on this loaded machine — see Phase 4 open items.*

---

## Phase 3 — ZCode rebrand, HUD and MCP sync

- [x] Identity layer: product identity, app-dir names, endpoints, env names, electron-builder config (doc 01 §2.1).
- [x] Assets: icons, installer art, splash, in-app logo. *Placeholder mark generated (decision 7): `build/placeholder-*` masters, canonical icon files + `public/logo/icons/*` regenerated from them; swapping files re-brands.*
- [x] String codemod + brand-leak CI check. *`scripts/codemod/brand-strings.mjs` (values only; ids preserved — two corrupted ids fixed) + `scripts/ci/brand-leak-check.mjs` (clean).*
- [x] Remove upstream services: Z.ai OAuth, account providers, Coding Plan gateway rewrite, MCP usage reporter, conversation share, Feishu/WeChat bots, CDN defaults, mirrors (doc 01 §3). *Removal pass deleted 43 files / rewired 34; findings: official-coding-plan-gateway never existed; conversation share has no product upload (local export kept); remote assets already local-only. z.ai/bigmodel/qwen-alibaba templates removed from the shipped provider config.*
- [x] `packages/deepcode`: auth service, deep-link handler, credential entry. *PKCE + state, key stored only in the encrypted credential store; sign-out revokes server-side. **Corrected 2026-11-15 (review):** until then the service was never instantiated and `handleDeepLink` received no `onAuthCallback`, so sign-in could not complete. Now wired in the main process (`packages/desktop/src/main/deepcodeAccount.ts`): IPC bridge `window.zcode.deepcode`, all three deep-link entry points, session restore after restart, local sign-out on `key_revoked`. The credential store is the upstream file store (AES-GCM with a host-derived key), **not** Electron `safeStorage` as earlier text said.*
- [x] Provider: `deepcode-builtin.json`, `deepcode-account` access type, plan-filtered model list, BYOK section per your decision. *Generator script; schema/overlay/resolution extended; BYOK templates (minus zai/bigmodel/alibaba) kept for the Advanced section.*
- [~] Protocol event `deepcode/usage-updated`; header and stream-notice capture in the Node agent runtime. *Schema only. **Key injection is now real (2026-11-15):** the agent reads the device key per request from `~/.deepcode/v2/credentials.json` and sends it as Bearer (`adapters/src/auth/deepcode-device-key.ts`), so sign-in/out applies without restarting agents and the key is not in the agent's env. **Not done:** capturing the `: deepcode-usage` notice / `X-DeepCode-*` headers in the agent; the HUD refreshes by polling (60 s, window focus, auth change) instead.*
- [~] `subscriptionStore`, HUD chip/popover, lock modal, composer notice, settings panel; service-layer send lock. *Store with merge precedence + lock derivation (D-01/D-02, 8 tests). **Corrected 2026-11-15:** the HUD was not mounted anywhere; now the sidebar footer shows sign-in / HUD chip / sign-out and `Root` mounts the status sync + lock modal (portal links go through main, same-origin only). **Not done:** settings panel, composer notice mount, service-layer send lock (the gateway still enforces every lock with 402/401).*
- [x] i18n: `ar` locale, `IntlProvider` direction + formatters, CLI locale, key-parity test. *ar.ts 5,662 keys machine-translated (needs human review); parity test 4/4.*
- [x] RTL: `LtrIsland`/`AutoDir`, logical-class codemod with reviewed diff, icon flipping, Arabic font + line-height. *Codemod applied to 245 files with reviewed diff; window-control overlays intentionally physical.*
- [~] Managed content sync service, managed discovery root, MCP presets UI, workspace-MCP trust prompt. *Sync service + per-item Ed25519/sha256 verification (D-09, 6 tests); presets inert templates. **Not wired:** the service is not instantiated by the app, the managed root is not in the skill scanner's discovery order, no presets UI, no workspace-MCP trust prompt.*
- [x] `NOTICE.md` update and About-window attribution.

**Gate:** upstream's own `pnpm typecheck`, `pnpm lint` and architecture check pass on the fork; desktop tests in §2.3 green; the host-allowlist network test passes; visual regression approved in both locales. *Status 2026-11-15: typecheck 0 errors, lint 0 errors, architecture 0 violations, brand-leak clean — all green twice in a row. Desktop tests: D-01/D-02 (8), D-04 (5), D-09 (6), D-13 parity (4) green. **Review 2026-11-15:** D-04 had never run (its import path pointed at a non-existent file); fixed, now 5/5. New: main-process account flow (7: sign-in → exchange → credential, forged/replayed links, restart restore, revocation sign-out, portal path allowlist), renderer status mapping (5), agent per-request key (4); brand-leak check widened to packaging metadata and made fail-closed (it passed silently when `rg` was missing). **Not met here:** D-03 visual states are untested in-browser (components written, no storybook run), D-06/D-07/D-08/D-10/D-11 need a built+packaged app (build takes ~50 min on this loaded machine — deferred to the packaging step), D-12 visual regression awaits the same. Font: IBM Plex Sans Arabic + Inter + JetBrains Mono wired via next/font equivalents in the fork's font stack.*

---

## Phase 4 — Integration testing and Electron packaging

- [~] End-to-end suite across all three apps (§2.4). *Web-side scenarios proven by the vitest + Playwright suites; desktop-side scenarios (1, 3–7) are covered in isolation (D-04 deep link, D-01/02 locks, W-06 renewal, pool tests, D-09 sync) but not as a launched app — see `docs/plan/05-COMPLETION-REPORT.md` §1/§8.*
- [~] CI matrix builds: Windows x64/arm64 `.exe`, macOS arm64/x64 `.dmg`, Linux x64/arm64 `.AppImage` + `.deb`. *CI workflow configured (root `.github/workflows/ci.yml` + the fork's upstream desktop matrix); only the Linux x64 build was attempted locally — result in the completion report.*
- [ ] Code signing and notarization (requires your Apple Developer and Windows certificate credentials in CI). *Owner item — credentials are CI placeholders; documents marked "needs owner certificates".*
- [~] Auto-update end to end on each OS: install N−1, publish N, update, relaunch. *Manifest endpoint + desktop updater wiring implemented and unit-tested; the two-installer drill needs a packaged app and a second build — owner/runtime item.*
- [ ] Clean-machine install tests per OS, including deep-link registration and uninstall. *Owner item (Windows/macOS machines); Linux packaging attempted locally.*
- [x] Security review pass (§3) and dependency audit. *gitleaks 8.28.0 full-history scans (root: no real secrets — only untracked Next build-output false positives and the fake staging placeholders removed by the L14 fix; fork: pre-existing upstream fixtures/inventory only), client-bundle grep, header/CSP review, independent review subagent over both diffs (findings in the completion report §9). `pnpm audit --prod`: 0 critical/high after the nodemailer 10.5.0 upgrade and postcss 8.5.33 override; 2 moderate remain.*
- [~] Staging soak: 48 h synthetic traffic, verify settlement and pool health alerts. *Soak script (`apps/gateway/load/soak.ts`) written; 10-minute smoke green with exact three-way reconciliation and zero failed requests. 48 h run is an owner/idle-host item.*
- [x] Runbooks: pool key banned, upstream outage, settlement backlog, webhook failure, key leak response. *All five in `docs/runbooks/`.*

**Gate:** every item in §3 checked; installers install and update on clean Windows 11, macOS 14+ (both architectures) and Ubuntu 24.04; zero open critical or high findings. *Status 2026-11-15: see `docs/plan/05-COMPLETION-REPORT.md` §1 and §9 — clean Windows/macOS runs and certificate-backed installers are owner items; every machine-checkable item was run.*

---

## 2. Automated test cases

Pyramid: many unit tests on pure logic, integration tests against real Postgres/Redis (Testcontainers) and the mock upstream, a small set of end-to-end flows.

### 2.1 Gateway

| ID | Type | Case | Expected |
|----|------|------|----------|
| G-01 | unit | Key format and HMAC hashing; constant-time compare | deterministic hash; malformed keys rejected before any I/O |
| G-02 | integ | Missing / malformed / unknown key | 401 `invalid_api_key`; unknown hash negatively cached |
| G-03 | integ | Revoked key; suspended user | 401 `key_revoked` |
| G-04 | integ | `expiresAt` in the past; `past_due` inside and outside grace | 402 `subscription_expired` only outside grace |
| G-05 | integ | Model not in `allowedModels`; model with no route | 403 `model_not_allowed` |
| G-06 | integ | Remaining credits = 0 | 402 `quota_exhausted` with `renewUrl` |
| G-07 | integ | RPM limit: N allowed, N+1 rejected, window slides | 429 with correct `Retry-After` |
| G-08 | integ | 50 parallel requests with balance for 1 | reservations prevent mass overdraft |
| G-09 | unit | Usage parsers ×4 protocols against recorded fixtures, chunk boundaries split at every byte offset | identical token counts regardless of chunking |
| G-10 | integ | Chat Completions: `include_usage` injected when absent; usage chunk withheld; preserved when client set it | client sees an unmodified stream otherwise |
| G-11 | integ | Byte-for-byte passthrough: SHA-256 of client-received body equals upstream body (minus the withheld chunk, plus the notice) | equal |
| G-12 | integ | Stream notice present and matches the settled row | `creditsRemaining` equals DB value |
| G-13 | integ | Settlement atomicity: 200 concurrent completions on one subscription | `creditsUsed` = exact sum of costs; one `usage_logs` row per request |
| G-14 | integ | Settlement idempotency: replay the same `requestId` | no double charge |
| G-15 | integ | Postgres down at settlement | record queued, drained after recovery, charged once |
| G-16 | integ | Client aborts mid-stream | upstream aborted; settled with `estimated = true` |
| G-17 | integ | Upstream omits usage | estimate + flag; alert counter incremented |
| G-18 | integ | Pool: key A returns 429 with `Retry-After: 30` | A cooling 30 s; request served by B; client sees 200 |
| G-19 | integ | Pool: 5xx backoff doubles; half-open probe recovers | timings within tolerance |
| G-20 | integ | Pool: 401 from upstream | key → `auth_failed`, removed, alert emitted, request retried |
| G-21 | integ | Pool: all keys cooling | 503 `upstream_unavailable`, `Retry-After` = soonest expiry |
| G-22 | integ | Pool: failure after first byte | no retry; terminal error event; partial usage metered |
| G-23 | integ | Least-loaded selection under 100 concurrent requests | in-flight never exceeds `maxConcurrency` on any key |
| G-24 | integ | Fallback route used only when plan allows | free plan gets 503, pro plan gets fallback |
| G-25 | integ | Response headers present on 200, 4xx and stream responses | all four `X-*` headers, exposed via CORS |
| G-26 | integ | `/v1/subscription/status` for active, exhausted, expired, suspended, no-subscription | schema-valid; correct `lock`; `daysLeft` boundary cases (expires in 1 s, in 24 h + 1 s) |
| G-27 | integ | Cache invalidation after revoke | next request rejected within 1 s |
| G-28 | load | 150 concurrent streams, 10 min | added TTFB p99 < 50 ms; no memory growth; zero unmetered completions |

### 2.2 Web portal

| ID | Type | Case |
|----|------|------|
| W-01 | integ | Sign-up → verify → sign-in; enumeration-safe errors; rate limits |
| W-02 | integ | Every dashboard and admin route and server action rejects anonymous and wrong-role callers (generated from the route list, so a new route without a guard fails CI) |
| W-03 | integ | Desktop auth: valid PKCE exchange succeeds once |
| W-04 | integ | Desktop auth: code reuse, expired code, wrong verifier, wrong state, device limit → all rejected |
| W-05 | integ | Key create shows the key once; DB holds only hash, prefix, last4; rotate revokes the old key |
| W-06 | integ | Webhooks: bad signature rejected; duplicate event is a no-op; activate, renew (credits reset), past_due, cancel, refund |
| W-07 | integ | Admin credit adjustment writes audit row, changes `creditsLimit`, invalidates the gateway cache |
| W-08 | integ | Admin add pool key: stored encrypted; no API response or page ever contains it |
| W-09 | e2e | Playwright: landing → pricing → sign-up → test-mode checkout → dashboard shows active plan |
| W-10 | e2e | Download centre picks the right primary build for mocked Windows, macOS, Linux x64/arm64 user agents |
| W-11 | a11y | axe on every page in `ar` and `en`: zero serious or critical violations; keyboard-only pass of sign-up, checkout and key creation |
| W-12 | visual | Screenshots of key pages × 2 locales × 3 widths; RTL mirroring verified, code blocks stay LTR |
| W-13 | unit | Locale key parity and placeholder parity between `ar` and `en` |
| W-14 | perf | Lighthouse CI budgets on landing, pricing, download |

### 2.3 Desktop

| ID | Type | Case |
|----|------|------|
| D-01 | unit | `subscriptionStore`: merge precedence (notice > poll > headers), newer-wins, skew-corrected `daysLeft`, severity thresholds |
| D-02 | unit | Lock derivation for each `GatewayError` code; lock clears on a healthy status |
| D-03 | comp | HUD chip/popover/lock modal in loading, ready, stale, error, signed-out states × 2 locales |
| D-04 | integ | Deep-link handler: accepts matching state; ignores unknown scheme paths, wrong state, replay, and links with no pending request |
| D-05 | integ | Credential stored via safeStorage; never present in renderer memory, logs or config files |
| D-06 | integ | Provider: model list equals `allowedModels`; requests carry the device key and reach the configured gateway |
| D-07 | integ | Usage event flows runtime → host → renderer; HUD updates within one frame of stream end |
| D-08 | integ | Locked state blocks submit at the service layer (including queued/automated runs); in-flight stream completes |
| D-09 | integ | Sync: manifest signature and archive hash verified; tampered archive rejected; tier downgrade removes managed skills; user skill shadows managed one |
| D-10 | integ | MCP preset stays disabled until the user enables it; workspace MCP requires trust prompt |
| D-11 | e2e | Network allowlist: fresh profile, record all hosts → only DeepCode origins (doc 01 §3) |
| D-12 | visual | 12 screens × `ar`/`en` × dark: shell mirrors; editor, diff, terminal, file tree identical across locales |
| D-13 | unit | Bidi: mixed Arabic/English/code strings render and copy in logical order |
| D-14 | ci | Brand-leak check over UI strings and packaged resources |
| D-15 | ci | Upstream gates still pass: `pnpm typecheck`, `pnpm lint`, `pnpm architecture:check` |

### 2.4 End-to-end (all three apps, staging)

1. **First run:** install → Sign in → browser consent → deep link → app shows plan in HUD.
2. **Metered chat:** send a prompt → stream renders → HUD decreases by the amount in `usage_logs` → dashboard chart shows it.
3. **Exhaustion:** admin sets remaining credits to a tiny value → next request completes → following request shows the lock modal → admin adds credits → modal clears without restart.
4. **Expiry:** set `expiresAt` to the past → lock modal with Renew → test-mode payment → unlock.
5. **Revocation:** revoke the device in the dashboard → app signs out on its next request.
6. **Failover:** disable/429 one pool key during a session → chat continues, admin panel shows the cooldown.
7. **Sync:** publish a skill in admin → "Sync now" → skill appears in the slash menu; unpublish → it disappears.
8. **Language:** switch to Arabic mid-session → shell mirrors, open editor unchanged.

---

## 3. Security verification checklist

### 3.1 Upstream keys can never leak

- [ ] **Storage:** `upstream_pool_keys` holds only AES-256-GCM ciphertext; verified by a test that scans a DB dump for known plaintext test keys.
- [ ] **Access:** only the gateway process holds `POOL_KEY_ENCRYPTION_KEY` for decryption; `apps/web` has no decrypt function (enforced by a lint rule on the import).
- [ ] **Client bundles:** CI greps the built outputs of `apps/web` (`.next/static`, server client-reference manifests) and the packaged desktop app (`app.asar` contents, resources) for: upstream key patterns, the literal test pool keys, `opencode.ai`, and every server-only env variable name. Any hit fails the build.
- [ ] **Desktop config:** the built-in provider config contains only the DeepCode gateway URL; no upstream base URL or key.
- [ ] **Error payloads:** fuzz test — the mock upstream returns errors that echo the `Authorization` header, include the key in JSON, in HTML, and in a redirect `Location`. Assert no client response body or header contains any substring (≥ 8 chars) of any pool key.
- [ ] **Response headers:** only allowlisted upstream headers are forwarded; test asserts absence of `set-cookie`, upstream request ids and account headers.
- [ ] **Logs:** run the full gateway test suite with logs captured at debug level; assert no pool key, no full virtual key, no `Authorization` value appears. Logger redaction has its own unit tests.
- [ ] **Admin UI and API:** no endpoint returns ciphertext or plaintext; the add-key form is write-only; test enumerates admin responses.
- [ ] **Crash paths:** unhandled-rejection and panic handlers print fingerprints only; heap snapshots and core dumps disabled in production.
- [ ] **Repository:** gitleaks in CI and pre-commit; `.env*` ignored; history scanned before the first push.
- [ ] **Rotation drill:** rotate `POOL_KEY_ENCRYPTION_KEY` (re-encrypt with a new `keyVersion`) in staging without downtime.

### 3.2 Virtual keys and auth

- [ ] Keys stored as HMAC with a pepper; shown once; prefix + last4 only in UI and logs.
- [ ] Deep link carries a single-use, 60-second, PKCE-bound code; replay, interception without verifier, and state mismatch all fail (W-04, D-04).
- [ ] No open redirect in sign-in or desktop consent flows.
- [ ] Sessions: httpOnly, Secure, SameSite cookies; CSRF protection on all mutations; 2FA enforced for admins.
- [ ] Authorisation checked server-side on every route and action (W-02); IDOR tests on keys, devices, usage and invoices using two accounts.
- [ ] Rate limits on auth endpoints, exchange endpoint and failed gateway auth.

### 3.3 Gateway abuse and correctness

- [ ] SSRF: upstream hosts come only from `upstream_providers`; no client-supplied URL is ever fetched.
- [ ] Request limits: body size cap, `max_tokens` cap per plan, header allowlist, timeout budgets.
- [ ] Query-string API keys rejected.
- [ ] Credits cannot be driven negative beyond the bounded overdraft (G-08, G-13); no double charge (G-14).
- [ ] `/internal/*` unreachable from the public network and token-protected.
- [ ] Database roles enforce least privilege (attempted writes by `gateway_rw` to `plans` fail in a test).

### 3.4 Desktop

- [ ] `contextIsolation` on, `nodeIntegration` off, sandboxed renderers; verified against the fork's existing settings so the rebrand does not regress them.
- [ ] Navigation and `window.open` restricted to the allowlist; external links open in the system browser.
- [ ] Deep-link handler treats every parameter as untrusted input; no path or command is derived from it without validation.
- [ ] Sync content: signature + hash verification, archive path-traversal protection, no auto-execution.
- [ ] Auto-update: HTTPS origin under our control, signature verification on Windows/macOS, SHA-256 from the manifest checked.
- [ ] Signed and notarized installers.

### 3.5 Web

- [ ] CSP with nonces, HSTS, frame-ancestors none; security headers verified by an automated scan.
- [ ] Webhook signature verification on the raw body; idempotency table.
- [ ] Dependency audit clean of critical/high; lockfiles committed; Dependabot or Renovate enabled.
- [ ] A second-pass security review of the diff before launch.

*Status 2026-11-15: every item above was checked against the implementation — see `05-COMPLETION-REPORT.md` §3 for the line-by-line status and evidence. Remaining owner items are the `POOL_KEY_ENCRYPTION_KEY` rotation drill and signed/notarized installers (no certificates on this machine).*

---

## 4. Risk register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| OpenCode changes its terms, limits or prices, or flags individual accounts | Low–Medium (terms confirmed permissive 2026-11-14) | Service outage or margin loss | Provider abstraction; `auth_failed` alerts per key; optional fallback route (ADR-001) |
| Upstream model changes usage payload | Medium | Under-billing | Fixture tests, estimated-usage alert, per-model parser overrides |
| Upstream merge conflicts in the fork | High | Slower updates | Small patched-file list, re-runnable codemods, internal names untouched |
| RTL regressions in 648 components | High | Poor Arabic UX | Logical-class codemod, LTR islands, visual regression in CI |
| Arabic translation quality (6,500 keys) | Medium | Credibility | Human review of top-traffic surfaces before launch; in-app "report translation" link |
| Unsigned installers trigger OS warnings | Certain without certificates | Lower conversion | Budget certificates before Phase 4 |
| Margin: plan credits priced below real cost | Medium | Loss per user | Credits tied to list price per model; admin cost dashboard; conservative initial plans |
| Key sharing between users | Medium | Revenue leak | Device limits, concurrency limits, anomaly flags on IP spread |

---

## 5. Order of work and parallelism

Phase 1 → 2 → 3 → 4 is the dependency order for integration. Within that, these can run at the same time once Phase 0 is done: gateway core, web auth/dashboard, and the desktop identity/asset rebrand (which needs no backend). The HUD and sync work need Phase 1 and 2a endpoints or their mocks; `packages/shared` contracts make mocking straightforward.

No time estimates are given here on purpose: they depend on how many people work on this and on the decisions below.

---

## 6. Decisions needed from you before Phase 1

1. ~~**Upstream supply (blocking).**~~ **Resolved 2026-11-14:** owner confirmed OpenCode's terms permit pooled resale. OpenCode Go is the launch upstream.
2. **Billing provider for launch.** Stripe, LemonSqueezy or Moyasar — depends on your company's country and target customers.
3. **Bring-your-own-key.** Keep custom providers behind an Advanced section (recommended) or remove them entirely?
4. **Key reveal.** Accept "shown once, rotate to see a new one" (recommended), or store an encrypted copy to allow reveal?
5. **Plans and prices.** Tiers, monthly credits, which models per tier, device limits.
6. **Hosting.** Preferred cloud for gateway, web, Postgres and Redis; region closest to your users.
7. **Domain and brand assets.** Production domain(s), logo master (SVG), legal entity name for the installers and code-signing certificates.
8. **English typeface.** Keep Inter as specified, or switch to IBM Plex Sans to pair with the Arabic face (doc 03 §1.7)?
9. **Chinese locale.** Remove `zh-CN` from the shipped app (planned) or keep it as a third language?
