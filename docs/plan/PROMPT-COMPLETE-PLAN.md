# Prompt: complete the DeepCode Studio plan (Phases 1-finish → 4) with verification

> Paste everything below the line into a new Claude Code session opened at
> `/home/mohammed/Desktop/DeepCode Studio`. When it finishes, its final report is
> reviewed in a separate session.

---

You are the lead engineer finishing **DeepCode Studio**, a commercial AI coding IDE built on a fork of ZCodium (Apache-2.0). The architecture is already designed and Phases 0 and 1 are built. Your job is to execute the **rest of the plan to completion, with verification at every phase gate**, and leave a clean, reviewable result. Work autonomously; do not stop to ask questions unless a step is truly impossible without the owner (see "Hard limits").

## 1. Read first (source of truth)

Read these completely before writing code. They override anything you assume:

1. `docs/plan/00-MASTER-ARCHITECTURE.md` — architecture, contracts, env matrix, ADRs.
2. `docs/plan/01-ZCODE-REBRAND-AND-IDE-FEATURES.md` — desktop rebrand, provider, RTL, auth, HUD, MCP/Skills sync, packaging, patched-file list.
3. `docs/plan/02-API-GATEWAY-AND-KEY-POOLING.md` — gateway; §10 lists how Phase 1 was actually built (deviations from the original design).
4. `docs/plan/03-SAAS-WEB-PORTAL-AND-DESIGN-SYSTEM.md` — web portal, design tokens, IA, admin.
5. `docs/plan/04-EXECUTION-ROADMAP-AND-VERIFICATION.md` — **the checklist you are executing**: phase items, exit gates, test IDs (G-xx, W-xx, D-xx, E2E 1–8), security checklist §3.

Then read the existing code in `packages/shared`, `packages/db`, `apps/gateway` (including `test/helpers/`) so new code reuses its contracts, helpers and conventions instead of duplicating them.

## 2. Environment (this machine)

- Node 24 is **not** the default. Prefix every shell command with:
  `export PATH=$HOME/.nvm/versions/node/v24.22.3/bin:$PATH`
  (pnpm 10.33.2 lives under it; the pnpm 12 on the default PATH is wrong.)
- Shell is zsh: a `$VAR` holding a command does not word-split. Launch node directly (not via a shell function) when you need its PID; kill by PID.
- Host already uses ports 5432, 6379, 8787. Dev infra: Postgres `127.0.0.1:55432`, Redis `127.0.0.1:56379` (`pnpm infra:up`), gateway on 8790. Pick other free ports for web (e.g. 3100) and check with `ss -ltn` before binding.
- The machine is heavily loaded (load average 20+). Latency numbers here are only valid as before/after comparisons. Run long jobs in the background and wait for them; never poll in a tight loop.
- `.env` holds real local secrets: **never print, cat, echo or log it**. Add new variables to `.env.example` (placeholders) and generate local values into `.env` with a script that does not echo them.
- `apps/desktop` is a separate git repo (ZCodium clone at `e5346dec`, branch `main`, clean), git-ignored by the root repo. It has its own pnpm workspace; run its commands from inside it.

## 3. Owner decisions — use these defaults

The owner has not decided items 2–9 in doc 04 §6. Do not block on them. Use these defaults, build so each is a config/token change later, and list each one in the final report:

| # | Decision | Default to build |
|---|----------|------------------|
| 2 | Billing provider | A `BillingProvider` interface plus a **Stripe test-mode** adapter. If no Stripe test keys exist in `.env`, also ship a `mock` provider used by tests and local checkout, and test the Stripe adapter against signed webhook fixtures. Never use live keys |
| 3 | BYOK | Keep custom providers behind an **Advanced** section in settings |
| 4 | Key reveal | **Shown once**; rotate to get a new one |
| 5 | Plans/prices | Keep `PLACEHOLDER_PLANS` and placeholder prices from `packages/db/src/catalog.ts`; label them visibly as placeholders in admin |
| 6 | Hosting | No deployment. "Staging" = a local `infra/docker-compose.staging.yml` running gateway + web + Postgres + Redis from built images |
| 7 | Domain/brand | Env-driven origins (`APP_URL`, `GATEWAY_URL`), placeholder domain `deepcode.example`. Make a simple placeholder logo/icon set clearly named `placeholder-*` and wire all asset paths so swapping files is enough |
| 8 | English typeface | Follow doc 03 §1.5 (Inter) but make the font a single token so §1.7 (IBM Plex Sans) is a one-line swap |
| 9 | zh-CN | Remove from the shipped desktop app, as planned |

## 4. What to do, in order

Execute doc 04 phase by phase. For each phase: implement every checklist item → write the tests listed for it → run the gate → fix → update doc 04 → commit → next phase.

**Step A — Close Phase 1 leftovers** (doc 04 Phase 1 `[~]` items):
- Postgres role grants: a migration or script creating `gateway_rw` and `web_rw` least-privilege roles, plus the test from §3.3 ("writes by `gateway_rw` to `plans` fail").
- `/metrics` endpoint (Prometheus text) on an internal port or token-protected; include settlement depth, dead-letter depth, pool key states, request counts.
- Half-open probe for pool keys if feasible (G-19), or document why not.
- **Live upstream test:** only if `SEED_POOL_KEYS` is already set in `.env`. Then seed, start the gateway, send one small streaming request per protocol (4 total, tiny prompts, cheapest allowed model), confirm the auth header scheme, error shape and that usage is reported, save sanitized real fixtures (no keys, no account ids) and compare metered credits to the upstream's reported tokens. If no key is present, skip and record "not done — needs key".
- Do **not** re-run the long load test on this machine; leave G-28 for an idle host.

**Step B — Phase 2a** (web: account and money) and **Step C — Phase 2b** (public site and admin):
- Before any UI, load the `frontend-design-deslop` skill and follow doc 03 tokens and positioning exactly (it already did the design discovery; do not redo it, and do not invent a different palette). Arabic `ar` is the default locale and RTL; English `en` LTR. Code, keys and numbers always LTR.
- Every doc 04 Phase 2 item, including `/auth/desktop` + `POST /api/desktop/exchange` (PKCE, single-use 60 s code), `/api/v1/client/configs`, releases manifest, admin pool manager (write-only key form, encryption via `packages/shared`, web **never** imports a decrypt function — enforce with a lint rule), signed Skills/MCP sync manifest and `GET /v1/sync/manifest` in the gateway.
- Legal pages: create the pages with clearly marked placeholder text for the owner to supply. Do not write legal terms as if final.
- Tests W-01 … W-14. Playwright for e2e/visual/a11y (axe) in both locales; Lighthouse CI budgets.

**Step D — Phase 3** (desktop rebrand, HUD, MCP sync) inside `apps/desktop`:
- Create branch `deepcode/rebrand` from `main` in the `apps/desktop` repo. Keep the patched-file list in doc 01 §10 small; prefer additive code in a new `packages/deepcode` over edits to upstream files. Update doc 01 §10 with the real list.
- Every doc 04 Phase 3 item. Remove every upstream service listed in doc 01 §3 (Z.ai OAuth, account providers, Coding Plan rewrite, MCP usage reporter, sharing, Feishu/WeChat bots, CDN defaults, mirrors).
- Arabic locale: generate the `ar` translations for all keys (key parity test must pass). Mark machine-translated files so the owner knows they need human review; prioritise exact, natural wording on top-traffic surfaces (onboarding, chat, settings, HUD, lock modal).
- RTL: logical-class codemod with the diff reviewed, `LtrIsland`/`AutoDir`, the editor/diff/terminal/file tree stay LTR.
- Gate: upstream `pnpm typecheck`, `pnpm lint`, `pnpm architecture:check` pass; tests D-01 … D-15. D-11 (network allowlist): launch the built app with a fresh profile, record every host contacted, assert only DeepCode origins (local gateway/web). Launching is allowed **only after** upstream services are removed and the provider points at your local gateway.

**Step E — Phase 4** (integration and packaging), everything that can run on this Linux machine:
- E2E suite §2.4 scenarios 1–8 against local staging (docker-compose.staging), using the mock upstream unless a real key exists.
- Build Linux x64 `.AppImage` and `.deb` locally; verify install, deep-link registration (`deepcode://`), launch and uninstall in a throwaway environment (container or temp HOME). Configure the CI matrix for Windows/macOS/Linux in `.github/workflows/` but do not expect to run it.
- Auto-update: implement and test N−1 → N against a local update server on Linux.
- Security review: go through doc 04 §3 item by item; implement the bundle-grep leak check (web `.next` + desktop `app.asar`), DB-dump scan, header/CSP scan, `pnpm audit`, gitleaks scan of git history (install gitleaks locally if possible via a release binary checksum-verified; otherwise run it in Docker `zricethezav/gitleaks`). Then run an independent security review subagent on the full diff and fix every critical/high finding.
- Runbooks in `docs/runbooks/` (pool key banned, upstream outage, settlement backlog, webhook failure, key leak).
- A 48 h soak is out of scope here: write the soak script and run it for 10 minutes as a smoke test.

## 5. Verification rules (non-negotiable)

- A phase is done when its **gate passes**, not when code is written. Run the full root checks after each phase: `pnpm build && pnpm typecheck && pnpm lint && pnpm test`, plus the desktop gates for Phase 3+. All must pass twice in a row (flake check).
- Integration tests use real Postgres/Redis via Testcontainers and the existing mock upstream, as Phase 1 does. Do not mock the database.
- After each phase, spawn an **independent review subagent** (`feature-dev:code-reviewer`) over that phase's diff, focused on correctness, security (key leakage, auth bypass, IDOR, injection, SSRF, open redirect) and the plan's requirements. Fix confirmed findings, re-run the gate.
- For UI work, verify in a real browser (Playwright screenshots in `ar` and `en`, desktop and mobile widths) and look at the screenshots yourself; fix layout defects before moving on.
- Never weaken, skip or delete a test to make a gate pass. If a test is wrong, fix the test and say why in the commit message.
- Report honestly. If something fails or cannot be verified here, mark it `[~]` or `[ ]` in doc 04 with an italic note saying exactly what is missing — never `[x]`.

## 6. Git and review hygiene

- Root repo: first commit the current Phase 0+1 state as a baseline on `main` (`chore: phase 0-1 baseline`), after checking `git status` contains no secrets (`.env` must be ignored; run gitleaks or a grep for `sk-` before committing). Then create branch `feat/complete-plan` and commit **one or more commits per phase** with conventional messages (`feat(web): ...`, `test(gateway): ...`).
- Desktop repo: commits on `deepcode/rebrand`, separate commits for mechanical codemods (strings, logical classes) and hand-written changes, so the review can skip the mechanical ones.
- Do **not** push, open PRs, create remotes, publish releases or tag versions.

## 7. Hard limits

- Never print, log or commit secrets. Never put a real key into fixtures, tests or docs.
- Never use live payment keys or make real payments; Stripe test mode or the mock only.
- Never contact Z.ai / ZCode production endpoints. Do not launch the desktop app until its upstream services are removed (Step D).
- Never send email to real addresses; use a local mail catcher (e.g. Mailpit in docker-compose) for verification emails.
- Do not deploy anything, buy anything, create external accounts, or sign anything with real certificates. Code signing and notarisation: configure, leave credentials as CI secrets placeholders, mark "needs owner certificates".
- Things that genuinely need the owner (certificates, real domain, legal text, final prices, Windows/macOS clean-machine tests, 48 h soak, idle-host load test) are recorded as open items, not blockers. Finish everything else.

## 8. Keep going

This is a long job. Do not stop after a phase to ask for permission, do not summarise and wait. If your context is compacted, re-read doc 04 (the checkboxes show where you are) and continue. Stop only when every item is either done and verified, or recorded as needing the owner.

## 9. Final deliverable

Write `docs/plan/05-COMPLETION-REPORT.md` containing:

1. **Gate table per phase** (1–4): each gate item → Met / Not met / Needs owner, with evidence (test counts, command run, screenshot path).
2. **Test inventory**: every test ID from doc 04 §2 (G, W, D, E2E) → file and status. Any ID without a test is listed explicitly.
3. **Security checklist** doc 04 §3 → status per line, with how it was verified.
4. **Deviations from the plan** and why (also update docs 01/02/03 where the design changed).
5. **Defaults used** for the owner decisions (§3 above) and exactly what to change for each real decision.
6. **Open items needing the owner**, as a short actionable list.
7. **How to review**: the git log for both repos (`git log --oneline`), which commits are mechanical, and the exact commands to reproduce every gate locally.
8. **Known weaknesses**: anything you are unsure about, tests you consider thin, code you would refactor.

Doc 04 checkboxes and the report must agree. End your session with a short message pointing to the report.
