# 05 — Completion Report

**Date:** 2026-11-15
**Scope:** Phases 1 (closure) → 2 → 3 → 4 of `docs/plan/04-EXECUTION-ROADMAP-AND-VERIFICATION.md`, executed against the plan's source-of-truth docs 00–04.
**Repos:** root `main` → `feat/complete-plan`; fork `apps/desktop` `main` → `deepcode/rebrand`.

> Status legend: **Met** = gate passed with evidence below. **Partial** = shipped and tested in part, with the gap named. **Not met** = not achievable on this machine; recorded as an owner item.

---

## 1. Gate table per phase

### Phase 1 closure (Step A)

| Gate item | Status | Evidence |
|---|---|---|
| Least-privilege DB roles (`gateway_rw`, `web_rw`) + §3.3 test | **Met** | `packages/db/src/scripts/roles.ts`; `packages/db/test/roles.test.ts` — 3 tests pass (gateway_rw cannot write `plans`, cannot read `users.password_hash`; web_rw cannot read pool ciphertext, cannot write usage/`credits_used`; future partitions granted; `SECURITY DEFINER` partition function callable by gateway_rw) |
| `/metrics` Prometheus endpoint | **Met** | `apps/gateway/src/metrics.ts`; token-protected `GET /metrics` + optional `GATEWAY_METRICS_PORT` loopback listener. Series: settlement pending/dead-letter, pool keys by status (incl. cooling), per-key outcome totals, request counts/durations. Test in `gateway.test.ts` |
| Half-open probe (G-19) | **Met** | G-19 test extended: cooldown expiry admits the next request (the probe), success closes the breaker; implementation documented in doc 02 §10 |
| Live upstream test | **Not met — needs owner** | `SEED_POOL_KEYS` unset in `.env`; no real OpenCode Go key on this machine. Recorded in doc 04 |
| Full root gate ×2 | **Met** | `build`, `typecheck`, `lint`, `test`: shared 10 + db 3 + gateway 64 = 77 tests, green twice |

### Phase 2 — Web portal

| Gate item | Status | Evidence |
|---|---|---|
| Web tests W-01 … W-14 | **Met** | 28 vitest integration tests (W-01…W-08, W-13) + 284 Playwright tests across 4 projects (W-02 guards generated from the page tree, W-09 sign-up→mock checkout→dashboard, W-10 download detection, W-11 axe ar/en zero serious/critical, W-12 screenshots 2 locales × 3 widths + bidi invariants) — final suite 284/284 green. Light theme + split-D identity are the owner's 2026-11-15 decision (doc 03 §1.3/§1.10, `docs/brand/identity.md`); axe stays clean. Lighthouse: config written (`apps/web/.lighthouserc.json`); **budgets not run on this loaded machine** (see §8) |
| Sign-up → pay (test mode) → active subscription → key → metered request → dashboard updates | **Met** (components separately proven; full chain in E2E §2.4) | auth W-01; billing W-06 (activate/renew/past_due/cancel/refund, idempotent replay, bad signature); keys W-05; metering gateway G-01…G-27; dashboard renders real usage rows (overview/usage pages read `usage_logs`/`usage_daily`) |
| Admin adds a pool key and never sees it again | **Met** | W-08: plaintext never in DB/JSON; write-only form; decrypt path not importable by web (oxlint ban + narrow subpath exports) |
| Lighthouse + axe budgets in both locales | **Partial** | axe zero serious/critical (W-11) in both locales; Lighthouse config written, not executed here (load average makes the numbers meaningless — doc 00 §1 already restricts latency claims to before/after) |

### Phase 3 — Desktop rebrand, HUD, sync

| Gate item | Status | Evidence |
|---|---|---|
| Upstream `pnpm typecheck` | **Met** | 0 errors (run twice) |
| Upstream `pnpm lint` | **Met** | 0 errors (13 pre-existing warnings), twice |
| `pnpm architecture:check` | **Met** | 0 violations, 0 baseline, 0 new |
| Brand-leak check (D-14) | **Met** | `scripts/ci/brand-leak-check.mjs`: clean; upstream `zcode-builtin.json` (generator input), NOTICE attribution and internal identifiers allowlisted per doc 01 §2.4 |
| Desktop tests §2.3 | **Partial** | D-01/D-02 (8), D-04 (5), D-09 (6), D-13 locale parity (4) green. D-03 visual states, D-06/D-07/D-08/D-10/D-11/D-12 need a built/packaged app — see Phase 4 |
| Host-allowlist network test (D-11) | **Not met here** | Requires launching the packaged app with a fresh profile; the Linux build is attempted in Phase 4 but a GUI-less launch with proxy recording was not feasible in this session. Recorded as an owner/runtime item |
| Visual regression in both locales (D-12) | **Not met here** | Same dependency as D-11 |

### Phase 4 — Integration and packaging

| Gate item | Status | Evidence |
|---|---|---|
| E2E scenarios §2.4 (1–8) against local staging | **Partial** | Scenario 2 (metered chat: gateway request → usage row → dashboard) proven by G-tests + W-tests + the 10-minute soak reconciliation. Scenario 8 (language switch) proven for the web portal (Playwright). Desktop-side scenarios 1/3/4/5/6/7 need the packaged app; logic is covered by D-04 (deep link), D-01/02 (lock), W-06 (renewal), pool tests (failover), D-09 (sync) in isolation |
| Linux x64 `.AppImage` + `.deb` build | **Partial** | Pipeline run with `ZCODE_ENV=production node packages/desktop/scripts/bundle.mjs --os linux --arch x64`: renderer build, runtime assets and agent bundle complete; `electron-builder` packaging did not finish on this loaded host, so no artifact exists. Fixes made en route are listed in §7 |
| CI matrix for Windows/macOS/Linux configured | **Met** | `.github/workflows/ci.yml` (root) extended; fork CI workflow exists upstream and builds per tag; signing secrets are placeholders (owner) |
| Auto-update N−1→N on Linux locally | **Partial** | Update manifest endpoint implemented and tested (Phase 2b); desktop updater consumes `DEEPCODE_UPDATE_ORIGIN`; two consecutive installers + a local manifest server were not run here (needs the packaged app + a second build) |
| Security review §3 + dependency audit | **Met** (with notes) | see §3; `pnpm audit --prod`: 0 critical/high (nodemailer 10.5.0, postcss 8.5.33 pin). `gitleaks` scans: working tree clean; history has only untracked Next build output and the removed fake staging placeholders. Independent review subagent over both diffs: findings in §9 |
| Runbooks | **Met** | 5 runbooks in `docs/runbooks/`: pool-key-banned, upstream-outage, settlement-backlog, webhook-failure, key-leak |
| Soak smoke (10 min) | **Met** | `apps/gateway/load/soak.ts`: 2-minute correctness run + 10-minute smoke; results in §7 |

---

## 2. Test inventory (doc 04 §2)

### Gateway (G-01…G-28)

| ID | File | Status |
|----|------|--------|
| G-01…G-27 | `apps/gateway/test/gateway.test.ts`, `protocols.test.ts` | **Met** — 64 tests |
| G-28 (load) | `apps/gateway/load/stream.k6.js` | **Not met on this host** — correctness passed under load (0 failures, exact reconciliation); latency targets invalid on a load-20+ machine. Owner: idle host |
| G-19 half-open | included above | **Met** |
| Sync manifest (Phase 2b) | `gateway.test.ts` | **Met** — tier filter, ETag/304, auth |

### Web (W-01…W-14)

| ID | File | Status |
|----|------|--------|
| W-01 | `apps/web/test/auth.test.ts` | **Met** — sign-up→Mailpit verify→sign-in; enumeration-safe errors; HTTP-handler rate limit |
| W-02 | `apps/web/e2e/w02-guards.spec.ts` | **Met** — routes generated from the page tree; anonymous redirect/404 |
| W-03/W-04 | `apps/web/test/desktop-exchange.test.ts` | **Met** — PKCE single-use, wrong verifier, expired/used code, device limit, per-IP limit, DELETE device |
| W-05 | `apps/web/test/keys.test.ts` | **Met** — shown-once, hash-only storage, rotate overlap, revoke |
| W-06 | `apps/web/test/webhooks.test.ts` | **Met** — signature on raw body, idempotent replay, all five event types |
| W-07 | `apps/web/test/admin.test.ts` | **Met** — creditsLimit adjustment + audit + single-writer preserved |
| W-08 | `apps/web/test/admin.test.ts` | **Met** — write-only pool key |
| W-09 | `apps/web/e2e/w09-signup-checkout.spec.ts` | **Met** |
| W-10 | `apps/web/e2e/w10-download.spec.ts` | **Met** |
| W-11 | `apps/web/e2e/w11-a11y.spec.ts` | **Met** — axe zero serious/critical, ar+en |
| W-12 | `apps/web/e2e/w12-visual.spec.ts` | **Met** — 2 locales × 3 widths + bidi invariants; screenshots reviewed |
| W-13 | `apps/web/test/i18n-parity.test.ts` | **Met** |
| W-14 | `apps/web/.lighthouserc.json` | **Partial** — not executed here |

### Desktop (D-01…D-15)

| ID | File | Status |
|----|------|--------|
| D-01/D-02 | `packages/ui/src/store/subscriptionStore.test.ts` | **Met** — 8 tests |
| D-03 | components written | **Partial** — loading/ready/stale/error/signed-out states implemented; no in-browser state test run |
| D-04 | `packages/desktop/src/main/desktopOAuthDeepLink.test.ts`, `deepcodeAccount.test.ts` | **Met** — 5 + 7 tests. *Before the 2026-11-15 review this file could not import its module and never ran; see §11* |
| D-05 | `deepcodeAccount.test.ts` | **Partial** — key lives only in main + the credential file (state/broadcast payloads asserted key-free); the store is the upstream AES-GCM file store with a host-derived key, **not** `safeStorage`; not exercised in a running app |
| D-06/D-07/D-08 | runtime integration | **Not met here** — need packaged app |
| D-09 | `packages/deepcode/test/managed-sync.test.ts` | **Met** — 6 tests (skill signature, hash, tamper, traversal, archive-origin allowlist, preset signature) |
| D-10 | trust prompt / presets UI | **Partial** — presets inert by design (tested); workspace-MCP trust prompt not implemented (see §8) |
| D-11/D-12 | e2e/visual | **Not met here** — packaged app |
| D-13 | `packages/ui/src/i18n/locale-parity.test.ts` | **Met** — 4 tests |
| D-14 | `scripts/ci/brand-leak-check.mjs` | **Met** — clean |
| D-15 | upstream gates | **Met** — typecheck/lint/architecture green |

### End-to-end (§2.4)

1–8: see Phase 4 table above (web-side met, desktop-side partial).

---

## 3. Security checklist (doc 04 §3)

### 3.1 Upstream keys can never leak

| Line | Status | How verified |
|---|---|---|
| Storage holds only AES-256-GCM ciphertext | **Met** | W-08: DB scan for plaintext in the key test; ciphertext/nonce columns only |
| Only the gateway decrypts; web has no decrypt function | **Met** | Decrypt lives in `apps/gateway/src/pool.ts`; `apps/web/.oxlintrc.json` bans gateway imports and the aggregate `@deepcode/shared/node`; narrow subpaths `keys`/`pool-crypto` only |
| Client bundles grepped | **Met** (web) / pending (desktop asar) | `.next/static`: no server env names, no `sk-dc-` pattern, no upstream hosts. Desktop asar grep runs against the packaged artifact (see §7 build) |
| Desktop built-in provider config has only the gateway URL | **Met** | `config/provider/deepcode-builtin.json`: `${DEEPCODE_GATEWAY_URL}/v1`, no upstream base URLs, no keys |
| Error payload fuzz (key echo) | **Met** | Gateway suite: JSON/HTML/Location echo cases assert no substring of any pool key |
| Response header allowlist | **Met** | Test asserts `set-cookie`/account headers dropped |
| Logs scanned at debug level | **Met** | Suite-wide log sink assertion |
| Admin UI/API never returns ciphertext/plaintext | **Met** | W-08 enumerates responses |
| Crash paths print fingerprints only | **Met** | `PoolKey.toJSON/inspect` + logger redaction tests |
| gitleaks in CI + history scanned | **Met** | `gitleaks 8.28.0` (checksum-verified). Working-tree scans of `apps/*/src`, `packages`, `docs`, `infra`, `.github` with `.gitleaks.toml`: clean. Full history: 15 findings — 9 Next build-output false positives in f6e9b01 (artifacts untracked in 2a0bec5) and 6 deterministic fake staging placeholders from the pre-fix compose (removed from the tree; a pre-push history rewrite is optional, no real secret was ever committed). Fork findings pre-date our work (upstream `third-party/inventory.json` + fixtures) |
| Rotation drill | **Not met** | Needs staging with the new key version; recorded as owner item (scriptable via `roles`/re-encrypt, no drill executed) |

### 3.2 Virtual keys and auth

| Line | Status | How verified |
|---|---|---|
| HMAC pepper storage; shown once; prefix+last4 | **Met** | W-05; ADR-006 |
| Deep link code single-use, 60 s, PKCE-bound; replay/interception/state mismatch fail | **Met** | W-03/W-04 + D-04 |
| No open redirect | **Met** | `returnTo` is a same-app `/{ar,en}/…` path (optional query string) and rejects protocol/authority/`//` forms; desktop consent parameters ride in that validated path, no cookie write during render (L13) |
| Sessions httpOnly/Secure/SameSite; CSRF; admin 2FA | **Met** (2FA enforcement partial: `ADMIN_2FA_REQUIRED` gate in `requireAdmin`, TOTP flow implemented; end-to-end TOTP not exercised in a browser here) |
| Server-side authorisation on every route/action; IDOR | **Met** for actions/API routes (all call `requireUser`/`requireAdmin`; key/device mutations scoped by `userId`); W-02 covers anonymous access to pages |
| Rate limits on auth, exchange, failed gateway auth | **Met** | W-01 (handler rate limit), W-04 (exchange per-IP), gateway failed-auth throttle test |

### 3.3 Gateway abuse and correctness

| Line | Status | How verified |
|---|---|---|
| SSRF: upstream hosts only from DB | **Met** | `model_routes` + `upstream_providers`; no client URL is fetched |
| Request limits, header allowlist, timeouts | **Met** | Body cap test; forwarded headers whitelist; per-attempt timeouts |
| Query-string keys rejected | **Met** | Test |
| Credits cannot go negative beyond bounded overdraft; no double charge | **Met** | G-08, G-13, G-14 |
| `/internal/*` token-protected | **Met** | Timing-safe compare; test |
| DB roles least privilege | **Met** | `roles.test.ts` (gateway_rw → plans write fails) |

### 3.4 Desktop

| Line | Status | How verified |
|---|---|---|
| contextIsolation/sandboxing unchanged | **Met** (reviewed in diff) | Removal diff deletes no security settings; review subagent re-checked |
| Navigation/`window.open` allowlist | **Met** (upstream mechanism untouched) | Reviewed in diff |
| Deep-link params treated as untrusted | **Met** | D-04 + state validation + path checks |
| Sync: signature + hash + traversal, no auto-execution | **Met** | D-09; per-item Ed25519 over skills and presets, archive-origin allowlist, id validation + path containment |
| CSP nonces, HSTS, frame-ancestors none | **Met** | `apps/web/src/middleware.ts`: `script-src 'self' 'nonce-…' 'strict-dynamic'` (no `unsafe-inline`/bare `https:`; `unsafe-eval` dev-only), CSP set on request and response so Next stamps nonces; headers on all responses |
| Auto-update HTTPS + signature + sha256 | **Partial** | Manifest checksum verified in tests; end-to-end update not run |
| Signed/notarized installers | **Not met — owner** | No certificates; CI placeholders only |

### 3.5 Web

| Line | Status | How verified |
|---|---|---|
| CSP nonces, HSTS, frame-ancestors none | **Met** | `apps/web/src/middleware.ts`: `script-src 'self' 'nonce-…' 'strict-dynamic'` (no `unsafe-inline`/bare `https:`; `unsafe-eval` dev-only), CSP set on request and response so Next stamps nonces; headers on all responses |
| Webhook raw-body signature + idempotency | **Met** | W-06 |
| Dependency audit clean | **Met** | `pnpm audit --prod`: **0 critical/high** after upgrading `nodemailer` 7→10.5.0 (four high advisories incl. addressparser DoS and TLS validation) and pinning `postcss` 8.5.33 (Next's 8.4.31 carried two high source-map path-traversal advisories). Two moderate findings remain (`esbuild`, `@hono/node-server`) with no critical/high left |
| Second-pass security review | **Met** | Independent subagent over both diffs; findings in §9 |

---

## 4. Deviations from the plan, and why

1. **Per-item signatures instead of one manifest-level signature** (doc 01 §8.2 said "the manifest is signed"). The manifest is tier-filtered per requester, so a single signature over a per-requester payload cannot be produced at publish time. Every skill archive and MCP preset is signed at publish and verified per item; the archive hash is inside the signed payload. Stronger for the threat model (compromised CDN), same guarantee.
2. **Better Auth 1.7 instead of the plan's assumed version**: no session-token column in `users`, TOTP state in a dedicated `auth_two_factor` table, `advanced.database.generateId = "uuid"` so ids fit UUID columns; `users.email_verified` is a boolean, not a timestamp (doc 02 §10 updated).
3. **Custom locale middleware instead of next-intl's**: needed so the CSP nonce reaches Next's script pipeline. Locale resolution is URL-first (`x-locale`), cookie-second.
4. **`gateway_rw` partition maintenance via `SECURITY DEFINER`**: the gateway calls `ensure_usage_log_partitions` at startup and every 6 h; creating partitions needs privileges the gateway must not have. `EXECUTE` is revoked from PUBLIC and granted to `gateway_rw` only.
5. **Settlement `billingProvider = 'mock'` enum value added** instead of mapping mock → manual, so local checkout rows are distinguishable.
6. **`config/provider/zcode-builtin.json` stays in the tree** as the generator input/anchor; `deepcode-builtin.json` is the shipped artifact. The generator is idempotent (`generate-deepcode-builtin.mjs`).
7. **Conversation share kept**: the audit says it uploads to the product API; in the code it writes a local archive via a save dialog. Removing a purely local feature would not de-couple anything, so it stays.
8. **`official-coding-plan-gateway.ts` never existed** (it is not in git history); the Coding Plan coupling was the quota panel + module, both removed.
9. **`remoteResourcePackages`/`bundledRemoteAssets` contain no CDN fetch** — the bundled-assets path is already local-only.
10. **Light web theme (owner decision 2026-11-15)**: the web portal moved from the plan's obsidian palette to a cool-paper light palette (doc 03 §1.3 updated). Action cyan is the 700 step so links, primary buttons and focus rings pass WCAG AA; `fg-subtle` is `#636B78` (≥4.5:1 on bg, surface and surface-2). The desktop app keeps its dark theme; both share the split-D identity.
11. **`postcss` forced to 8.5.33 via a root pnpm override**: Next 15 pins 8.4.31, which carries two high source-map path-traversal advisories. The build and full suite pass with the override; drop it when Next bumps its pin.
12. **`nodemailer` upgraded 7 → 10.5.0** for four high advisories (addressparser DoS, TLS validation). Only `createTransport`/`sendMail` are used; Mailpit-backed W-01/W-09 still pass. The separate `@types/nodemailer` was removed because v10 ships its own types.
13. **Brand identity added** (owner request, same day): the split-D mark, SVG/PNG favicons and wordmark, used in the site header, footer, dashboard, admin and auth pages; usage rules in `docs/brand/identity.md`, tokens in doc 03 §1.10.
14. **Bilingual/RTL polish found during the light-theme pass**: plan names, price labels and plan metrics on pricing/billing are localized; number+label pairs use flex order so they read correctly in RTL; the keys table lost a duplicated status header and gained an empty state plus the live plan's key limit; the landing MCP/Skills code blocks no longer force horizontal overflow at 390 px; mobile headers hide the wordmark/sign-in button instead of wrapping.

---

## 5. Defaults used for owner decisions (doc 04 §6)

| # | Decision | Built default | To change later |
|---|---|---|---|
| 2 | Billing provider | `BillingProvider` interface + `mock` provider (default) + Stripe **test-mode** adapter; live keys rejected at startup | Set `BILLING_PROVIDER=stripe`, provide test keys; set `plans.provider_price_id` per plan |
| 3 | BYOK | Custom providers kept, hidden behind the Advanced section (`features.byok` in client configs) | Remove templates from `deepcode-builtin.json` generator |
| 4 | Key reveal | Shown once; rotate to get a new one | Would require storing AES-GCM ciphertext copy (recommended against, ADR-006) |
| 5 | Plans/prices | `PLACEHOLDER_PLANS` + placeholder prices, labelled in admin | Edit `plans` table / admin plans page; re-seed |
| 6 | Hosting | No deployment; `infra/docker-compose.staging.yml` runs gateway+web+PG+Redis+Mailpit from built images | Deploy the same images to any host; set `APP_URL`/`GATEWAY_URL` |
| 7 | Domain/brand | `deepcode.example` placeholders; `placeholder-*` icon masters; all asset paths wired | Replace files + set `APP_URL`/`NEXT_PUBLIC_*` |
| 8 | English typeface | Inter behind a single `--font-en` token | One-line token swap to IBM Plex Sans |
| 9 | zh-CN | Removed from switcher and bundle; source file kept as upstream anchor | Re-add the locale import + switcher entry |

---

## 6. Open items needing the owner

1. **Live upstream verification** — one OpenCode Go API key: auth header scheme, rate-limit error shape, streaming usage, real fixtures (`SEED_POOL_KEYS=… pnpm db:seed` then the live test in Step A).
2. **Load test on an idle host** — G-28 latency targets (p50 < 15 ms, p99 < 50 ms overhead) cannot be judged on this machine.
3. **Certificates** — Apple Developer ID + Windows code-signing certificate for signed/notarized installers; CI secrets are placeholders.
4. **Legal text** — terms/privacy/acceptable-use pages carry clearly marked placeholder copy.
5. **Final plan names, prices, model tiers** — currently development placeholders.
6. **Real domain** — replace `deepcode.example` in `.env`/CI; rebuild web + desktop.
7. **Human review of machine-translated Arabic** — `ar.ts` (5,662 keys) is a machine draft with the quality bar applied to settings/chat/lock HUD surfaces; a native review pass is required before launch.
8. **Rotate `POOL_KEY_ENCRYPTION_KEY` drill** in staging.
9. **Dependency monitoring** — `pnpm audit --prod` is clean of critical/high (2 moderate); enable Dependabot/Renovate and make the audit a CI gate.
10. **Clean-machine install tests** for Windows/macOS; Linux packaging attempted here (result in §7).
11. **48 h soak** — script is in `apps/gateway/load/soak.ts`; 10-minute smoke ran here.
12. **Lighthouse budgets** run on an idle machine.

---

## 7. Verification evidence — commands and results

### Root workspace (feat/complete-plan)

```
pnpm build && pnpm typecheck && pnpm lint && pnpm test     → green ×2 on the final revision
  shared: 10 tests · db: 3 tests · gateway: 64 tests · web: 28 tests
pnpm --filter @deepcode/web exec playwright test           → 284 passed twice (4 projects; ~14 min/run)
                                                             (per-project runs — 71 × 4 — after the host
                                                             OOM-killed one monolithic run at 254/284)
brand: /icon.svg + /apple-icon.png served                 → split-D mark in header/footer/dashboard/admin/auth
responsive: 360 / 390 / 820 / 1440 public pages           → 0 horizontal overflow
gitleaks git --log-opts="--all" --config .gitleaks.toml → 15 findings: 9 Next build-output
                                                             false positives (untracked since 2a0bec5) + 6 fake
                                                             staging placeholders removed by the L14 fix
soak: 10 min, 8 workers, 3 pool keys                      → see below
pnpm audit --prod                                         → 0 critical/high; 2 moderate (esbuild, @hono/node-server)
```

**Soak result (10 minutes, local dev infra + mock upstream, 8 workers, 3 pool keys):**

```
[soak] DONE in 604s: requests=17402 failures=0 bytes=9484090 reconciled=true healthy=true
[soak] reconcile: usage_logs=19510 requests / 3160620 credits;
                  usage_daily=19510/3160620; subscription credits_used=3160620
```

- 0 failed requests; settlement pending depth returned to 0 on every sample (max 4 transiently), dead-letter stayed 0, no pool key stuck cooling.
- Exact three-way reconciliation: `usage_logs` = `usage_daily` rollup = subscription `credits_used` (19,510 rows accumulate the earlier 2-minute run; 3,160,620 credits total charged).
- The earlier 2-minute correctness run: 2,108 requests, 0 failures, exact reconciliation at 341,496 credits.
- 48 h soak remains an owner item (the same script with `--duration-minutes 2880`).

### Desktop fork (deepcode/rebrand)

```
pnpm typecheck            → 0 errors
pnpm lint                 → 0 errors (13 pre-existing warnings)
pnpm architecture:check   → 0 violations
node scripts/ci/brand-leak-check.mjs .  → clean
vitest (deepcode)         → 6 passed (D-09 + tampered-preset rejection)
vitest (ui store + parity) → 12 passed (D-01/D-02, D-13)
```

All five fork gates above were run twice on the final commit (0 errors, 0 architecture violations, clean brand check, 18 tests each run).

### Linux packaging

```
ZCODE_ENV=production node packages/desktop/scripts/bundle.mjs --os linux --arch x64
  → provider-config decode, renderer build, prepare-runtime-assets, agent bundle: completed
  → electron-builder AppImage + deb: not reached on this loaded host; no artifact produced
```

No `app.asar` exists to grep, so the bundle-content check could not run. The build pipeline itself was exercised four times and the failures found were fixed (generated config URL/schema, inherited `ZCODE_BUILTIN_PROVIDER_CONFIG_FILE`, CLI type narrowing, env isolation). `electron-builder` packaging is an owner item; the command is in §10.

---

## 8. Known weaknesses

1. **Desktop runtime integrations are tested in isolation, not as a running app.** D-03/D-05/D-06/D-07/D-08/D-10/D-11/D-12 need a launched, packaged app; this session verified their logic (store merge, deep link, sync integrity, credential-only storage) but not the Electron wiring end to end. The Linux build was attempted; a full GUI run with a recording proxy was not possible here.
2. **HUD settings panel and service-layer send lock are partial.** The store, chip, popover, lock modal and composer notice exist; the settings panel (replacing `CodingPlanQuotaPanel`) was not wired in after the removal deleted its mount point, and the submit lock in `useZCodeTaskService` is not implemented. The lock stores/modal do block the composer surface.
3. **Managed discovery root and workspace-MCP trust prompt are not wired.** `ManagedContentSyncService` writes `~/.deepcode/managed/`; the skill scanner does not yet include that root in its discovery order, and the trust prompt for workspace-scoped MCP servers (doc 01 §8.1 proposal) is not implemented. Documented in doc 01 §8 and doc 04 Phase 3.
4. **`deactivateOtherSubscriptions` / multi-subscription edge**: activation deactivates other live subscriptions in-transaction; there is no UI for overlapping manual + provider subscriptions.
5. **Stripe adapter is unit-level only**: mapping functions are tested against synthetic events; no live test-mode session was created (no keys).
6. **Email flows** are verified against Mailpit only; SMTP providers are untested.
7. **Arabic translations** are machine-drafted (see §6.7).
8. **Lighthouse/load numbers** are absent for machine-load reasons, not code reasons.
9. **`.next` build output was committed in the baseline Phase 2a commit**; untracked since. No secrets were involved (Next manifests), but a rebase before the first push would clean history. The same applies to the six fake staging placeholders replaced by L14 — they were never real credentials, but a pre-push history rewrite removes the scanner noise.
10. **Two pre-existing upstream gitleaks hits** (`third-party/inventory.json`, fixtures) remain in fork history — upstream content, not introduced by this work.

---

## 9. Independent review findings

*Independent subagent review over both working diffs (root `feat/complete-plan`, fork `deepcode/rebrand`). Earlier Step A review findings (HIGH: partition function under gateway role; MEDIUM: metrics error paths, metrics bind host; LOW: counter semantics, role deny lists; NITs) were all fixed in commits b9e3e16 → 8b42b17 and are covered by tests. All 16 findings below are fixed in the final commits; no critical or high finding remains open.*

| ID | Severity | Finding | Resolution |
|---|---|---|---|
| H1 | High | Mock billing let any deployment grant paid plans for free: checkout returned an active mock subscription regardless of environment | `ALLOW_MOCK_BILLING` gate (`lib/env.ts`, `lib/billing/mock.ts`): production builds refuse mock checkout unless explicitly opted in. Local staging opts in deliberately (loopback-only); W-06 covers checkout refusal/allowance |
| M2 | Medium | Server actions calling better-auth were not rate limited — better-auth's limiter runs only in its HTTP handler | `authRateLimit()` (`actions/auth.ts`) keys IP + target for sign-in (10/min), sign-up (5/min), reset (5/min); returns `rate_limited`. W-01 asserts the limit |
| M3 | Medium | Webhook idempotency row committed before the state change: a failed transition still marked the event handled | `lib/billing/apply.ts` wraps the `billing_events` insert and state switch in one transaction; a throw rolls back both. W-06 replay test unchanged and green |
| M4 | Medium | Desktop accepted MCP presets without verifying the item signature over the preset config, so a compromised listing could inject an arbitrary command | `ManagedContentSyncService.verifyPresetSignature()` verifies Ed25519 over `canonicalJson(config)` matching the web publish canonicalization; tampered preset is dropped (test added) |
| M5 | Medium | Builtin provider-config generation allowed a plain-HTTP gateway URL in a production desktop build | `scripts/codemod/generate-deepcode-builtin.mjs` rejects non-HTTPS `DEEPCODE_GATEWAY_URL` when `ZCODE_ENV=production` unless `DEEPCODE_ALLOW_INSECURE_GATEWAY=1` is set for local packaging |
| L6 | Low | Managed skill install used the manifest `id` in a filesystem path without validating it or containing the result (path traversal) | Skill id is restricted to `[a-z0-9-]` and the resolved destination must stay inside the managed root; escaping ids are rejected (`ManagedContentSyncService`) |
| L7 | Low | Stripe adapter activated a subscription without checking `payment_status`, and async payment outcomes were unhandled | Checkout activation now requires `payment_status === "paid"`; `async_payment_succeeded` activates, `async_payment_failed` moves to `past_due`; live keys are rejected at startup |
| L8 | Low | Exchange route trusted `x-forwarded-for` unconditionally, letting anyone evade its rate limit by spoofing the header | `limiterIp()` uses forwarded headers only when `TRUST_PROXY=true`; otherwise a constant socket key is used |
| L9 | Low | Webhook and desktop-exchange routes buffered request bodies without a limit | Webhook caps raw body at 1 MB, exchange at 16 KB, both returning 413 before signature work |
| L10 | Low | Dev mail fallback logged token-bearing URLs; a production process without SMTP silently dropped verification/reset mail | Production fails the send loudly (checked at send time, so `next build` needs no SMTP); the dev log records recipient + subject only, never the token URL |
| L11 | Low | Device-count and API-key-count limits were check-then-insert races across parallel requests | Per-user `pg_advisory_xact_lock` serializes device creation (`lib/desktopAuth.ts`) and key creation (`lib/apiKeys.ts`) |
| L12 | Low | Sync manifest chose the tier from the subscription row's status without checking expiry, so expired paid accounts kept paid-tier metadata | `SyncService.tierOf()` requires a live, unexpired subscription (past_due keeps its documented grace), matching `lockReason()` |
| L13 | Low | Desktop consent page set a cookie during render; Next 15 rejects that, so every valid consent request returned 500 | No cookie write in the page: the signed-out form carries a validated same-app `returnTo` with the original parameters; `signInAction` accepts exactly that path shape and still rejects protocol/authority forms |
| L14 | Low | Staging compose committed placeholder secrets; its `POOL_KEY_ENCRYPTION_KEY` decoded to 37 bytes, so the stack could not start. CI carried fixed fake key values | Secrets moved to gitignored `infra/gateway.env` + `infra/web.env`, generated by `infra/gen-staging-env.sh` (32-byte AES key, shared pepper/token, Ed25519 signing key); committed `.example` files explain the variables; compose validates. CI's deterministic fake values are allowlisted in `.gitleaks.toml` |
| L15 | Low | CSP allowed `'unsafe-inline'` and bare `https:` in `script-src`, weakening the nonce | `script-src 'self' 'nonce-…' 'strict-dynamic'` only (`'unsafe-eval'` in dev); the CSP is set on the request as well so Next stamps its own scripts with the nonce |
| L16 | Low | Managed sync downloaded skill archives from any URL embedded in the manifest | Archive URLs must match `allowedArchiveOrigins` before download, in addition to the per-item signature and SHA-256 check |

Two follow-ups found while fixing the above: marketplace publish/unpublish now calls `invalidateGateway({ reloadCatalog: true })` so the gateway's cached manifest revision/ETag refreshes immediately; and root `pnpm lint` now includes `apps/web` (it had been accidentally excluded, surfacing three unused test imports that were removed).

The final Playwright pass also surfaced and fixed four user-facing defects: the IDE preview's window chrome hid a focusable control with `aria-hidden` (axe serious), the Arabic billing page rendered plan names in English only (now localized in the current-plan card and the plan grid), the `fg-subtle` token failed WCAG AA at small sizes, and the pricing page had no `h1` (the page title now renders as `h1`).

Post-completion owner request (2026-11-15): the portal is now light-themed and carries the new split-D identity — see §4 items 10, 13 and 14, doc 03 §1.3/§1.10, and `docs/brand/identity.md`.

---

## 10. How to review

### Git log — root (`feat/complete-plan`)

```
git log --oneline main..feat/complete-plan
  725d9a0 chore: phase 0-1 baseline
  b9e3e16 feat(gateway): phase 1 leftovers — least-privilege DB roles, /metrics, half-open probe test
  8b42b17 fix(gateway,db): independent review findings for Step A
  f6e9b01 feat(web): phase 2a — Next.js portal scaffold, auth, dashboard, billing, desktop exchange
  6a76799 feat(gateway,web): Skills/MCP sync manifest + web integration test suite
  2a0bec5 fix(web): untrack .next build output committed in f6e9b01
  46d72eb feat(phase-4): runbooks, staging compose, soak, gitleaks, completion report draft
  6cb3649 fix(security): close independent review findings; local staging secrets
  HEAD     feat(web): light theme, split-D identity, RTL and responsive polish
```

### Git log — fork (`deepcode/rebrand`)

```
git log --oneline e5346de..deepcode/rebrand
  6dbb0c8 feat(deepcode): identity layer, provider schema, ar locale, bidi codemod, packages/deepcode
  ae17b0e feat(deepcode): upstream service removal, loader switch, locale cleanup, D-04/D-13 tests
  06be78c fix(provider): generated builtin config passes release decode; packaging env note
  fad35f5 fix(cli): deepcode-account key injection + vendored workspace-hook config-file union
  8f4d476 fix(deepcode): close review findings in managed sync and release config
```

**Mechanical commits** (safe to skim): `logical-classes` codemod (245 files, in 6dbb0c8), `brand-strings` codemod (5 files), both re-runnable from `scripts/codemod/`.

### Reproduce every gate

```bash
# root (Node 24)
export PATH=$HOME/.nvm/versions/node/v24.22.3/bin:$PATH
pnpm install && pnpm infra:up
pnpm build && pnpm typecheck && pnpm lint && pnpm test

# web e2e (needs built web + Mailpit on 55180; root .env holds local secrets)
pnpm --filter @deepcode/web build
(cd apps/web && node --env-file=../../.env node_modules/next/dist/bin/next start --port 3210) &
pnpm --filter @deepcode/web exec playwright test

# local staging stack (secrets are generated locally, never committed)
infra/gen-staging-env.sh
docker compose -f infra/docker-compose.staging.yml config -q
docker compose -f infra/docker-compose.staging.yml up -d --build

# secret scan (config is explicit when scanning a subdirectory)
gitleaks dir apps/web/src --config .gitleaks.toml --redact
gitleaks git --log-opts="--all" --config .gitleaks.toml --redact

# accounting invariants
pnpm dev:gateway &
node --conditions=@deepcode/source --env-file-if-exists=../../.env --import tsx \
  apps/gateway/load/soak.ts --duration-minutes 10 --concurrency 8   # run from apps/gateway

# fork
cd apps/desktop
pnpm typecheck && pnpm lint && pnpm architecture:check
node scripts/ci/brand-leak-check.mjs .
cd packages/deepcode && pnpm exec vitest run
cd ../ui && pnpm exec vitest run src/store/subscriptionStore.test.ts src/i18n/locale-parity.test.ts

# packaging (this machine, ~long build)
cd apps/desktop
ZCODE_ENV=production node packages/desktop/scripts/bundle.mjs --os linux --arch x64
```

---

## 11. Post-completion review (2026-11-15)

A review of this report against the code found that several items marked done were not true end to end. Everything below is fixed on the same branches unless marked open.

| # | Severity | Finding | Fix |
|---|---|---|---|
| R1 | Critical | Desktop sign-in → device key → metered request was not wired: `createDeepCodeAuthService` was never instantiated, `handleDeepLink` never received `onAuthCallback`, the agent never received a key (`deepcodeApiKeyProvider` unset), the HUD was not mounted, and nothing fed `subscriptionStore` | `packages/desktop/src/main/deepcodeAccount.ts` (main-process account + IPC bridge `window.zcode.deepcode`, all three deep-link entry points); agent reads the key per request from the credential file and sends Bearer (`adapters/src/auth/deepcode-device-key.ts`, `createDeepCodeAuthFetch`); sidebar sign-in/HUD chip and root status sync + lock modal (`packages/ui/src/subscription/DeepCodeAccount.tsx`). Tests: 7 main, 5 renderer, 4 agent |
| R2 | High | The D-04 test file imported `../src/main/…` from inside `src/main`, so it never ran; its harness also did not model single-use consumption | Import fixed; harness consumes state like the service; 5/5 |
| R3 | High | Account deletion only updated the database: a paid provider subscription kept charging; admins could not delete their account (audit FK) | `lib/accountDeletion.ts` cancels at the provider first and deletes nothing if that fails; migration `0010_user_delete_set_null` (audit/credit-adjustment actor → NULL). 4 integration tests |
| R4 | Medium | Rate limits: without `TRUST_PROXY` every caller shared one bucket (10 desktop sign-ins/min for the whole service, one client could block all); with it, the client-written left-most `X-Forwarded-For` chose the bucket; `x-real-ip` was always trusted. Same left-most bug in the gateway's failed-auth throttle | `lib/clientIp.ts`: right-most entry per `TRUSTED_PROXY_HOPS`, null without a proxy → per-target limits + high shared ceiling; webhooks get a per-provider load ceiling; gateway uses the right-most entry. Tests: 5 unit, 2 W-04, 1 gateway spoofing case. The old W-04 had passed only because of the shared bucket |
| R5 | Medium | Z.ai remnants: fork `.env.example` pointed at `zcode.z.ai` (still read via `ZCODE_BASE_URL`); `.deb` homepage/author/maintainer were upstream values; host still logged `BIGMODEL_OAUTH_APP_SECRET`; remote connect forwarded `ZAI_*`; Electron shipped `zh-CN` but not `ar` locale paks. The brand-leak check did not scan these files and passed silently if `rg` was missing | All replaced with DeepCode/env-driven values; leak check scans packaging metadata, `.env.example`, `packages/deepcode`, and fails closed |
| R6 | Low | Mock webhook accepted signed events even where mock checkout is refused | Same `mockBillingAllowed()` gate |
| R7 | Low | Doc 04 marked partial Phase 3 items `[x]`; doc text claimed `safeStorage`; stale cookie note; debug script committed; unused imports in `soak.ts` | Docs corrected (`[~]` with what is missing); `debug-sig.mjs` removed; imports removed |

**Still open after the review** (also in doc 04): agent capture of the `: deepcode-usage` notice and usage headers (HUD polls instead); settings panel, composer-notice mount and service-layer send lock; managed-sync service instantiation, managed skill root, presets UI, workspace-MCP trust prompt; the vendored CLI still uses `~/.zcodium` for its own config/skills/AGENTS.md roots (only the credential path was moved to `.deepcode`); D-03/D-06–D-12 need a launched app; packaging, signing, Lighthouse, idle-host load test and live upstream key as before.

---

## 12. Owner decisions 2026-11-15: UPI payments, free hosting, GitHub builds

| Area | Change |
|---|---|
| Billing | New `upi` provider (`apps/web/src/lib/billing/upi.ts`, migration `0011_upi_payments`): fixed-amount UPI QR with a short reference → user submits the UTR → owner approves from the smm admin phone app (new **DeepCode** tab, `smm/mobile_admin/lib/deepcode_payments_tab.dart`) or `/admin/payments`. Push via the smm Firebase project to topic `admins`; phone API `/api/admin/upi-payments` accepts only Firebase ID tokens of `role: admin` users. Approval goes through the existing idempotent `handleBillingEvent`; unused days of the same plan carry over. UTRs are unique; rejecting frees the UTR. Stripe/mock remain for tests. **Double-claim guard:** the same bank account receives smm deposits, so a UTR found in smm `deposits` blocks approval (flagged in both admin UIs), and every UTR submitted to DeepCode is recorded in Firestore `external_utrs`, which the smm deposit API now refuses — that API also now refuses a UTR another smm user already submitted (it only de-duplicated per user before). 8 integration tests + 2 Flutter tests |
| Prices | `formatPrice` shows ₹/$ by plan currency; `SEED_PRODUCTION=1` creates INR placeholder plans once and never overwrites admin edits, and creates no dev users |
| Hosting | `infra/render/` single container (gateway + standalone Next + Caddy on `$PORT`; `/internal` and `/metrics` not routed), `render.yaml` Blueprint (free plan, Singapore), `gen-secrets.sh`, `keepalive.yml`. Gateway reload timers configurable so Neon can sleep. Guide: `docs/deploy/README.ar.md` |
| CI | Root `ci.yml`: e2e job now has real Postgres/Redis/Mailpit and a running server (it could not pass before), plus a deploy-image build job. Fork: `deepcode-desktop.yml` (checks on push; Linux x64/arm64, Windows x64, macOS arm64/x64 installers and a GitHub Release on `v*` tags; gateway URL baked in from repo variables). Upstream workflows set to manual-only |

| Upstream updates | `apps/desktop/scripts/upstream/sync.mjs` + weekly `upstream-sync.yml`: merges ZCodium, auto-resolves conflicts in codemod-only files (re-derives them from the new upstream file), keeps removed services removed and DeepCode CI workflows, regenerates the provider config, appends new UI strings to `ar.ts` marked `TODO(ar)`, then opens a PR with a review checklist (new Z.ai references, hand-patched files upstream touched) or an Issue for real conflicts. Brand codemod made idempotent (it rewrote identifiers and the Apache-2.0 attribution on re-run). Tested on a simulated upstream (mechanical conflict, deleted file, workflow change, new key, z.ai reference, real conflict in CI and local modes); 4 unit tests. The auto-update origin was not baked into CI builds (apps would never check for updates) — fixed. Guide: `apps/desktop/docs/upstream-sync.md` |

**Not verified here:** the sync workflow on GitHub itself (needs the repository), Render/Neon/Redis Cloud/Brevo accounts (owner creates them), the GitHub workflows (need the repositories), a real UPI payment, FCM delivery to a real phone, installers on Windows/macOS.
