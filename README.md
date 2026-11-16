<div align="center">
  <h1>DeepCode Studio — Server</h1>
  <p><strong>Gateway, website, billing and admin for the DeepCode Studio AI coding IDE.</strong></p>
  <p>English · <a href="README.ar.md">العربية</a></p>
  <p>
    <a href="https://deepcode-2sfl.onrender.com">Website</a> ·
    <a href="https://github.com/ALSRKAL/deepcode-desktop">Desktop app</a> ·
    <a href="docs/deploy/README.ar.md">Deploy guide (Arabic)</a>
  </p>
  <p><a href="https://github.com/ALSRKAL/deepcode-studio/actions/workflows/ci.yml"><img alt="ci" src="https://github.com/ALSRKAL/deepcode-studio/actions/workflows/ci.yml/badge.svg" /></a></p>
</div>

This repository runs everything behind the [DeepCode Studio desktop app](https://github.com/ALSRKAL/deepcode-desktop):

- **Gateway** (`apps/gateway`): one OpenAI/Anthropic-compatible API (`/v1`) in front of the
  model provider (Synthetic.new). Per-plan model access, exact per-token metering in
  credits, rate and concurrency limits, streaming, web search, and an upstream key pool.
- **Website and dashboard** (`apps/web`, Next.js, Arabic and English): pricing, sign-up with
  a 24-hour free trial, account dashboard (usage, API keys, devices, billing, settings),
  desktop sign-in, downloads and the update feed.
- **Admin**: users (credits, plans, key revocation, account deletion), payments, model
  catalog, upstream pool, releases, marketplace and audit log.
- **Billing**: UPI QR payments approved from the owner's phone app.
- **Phone remote control relay** (`infra/render/remote`): lets the desktop app be driven
  from a phone on any network.

## Architecture

```
desktop app ──► /v1/*        gateway (Node)  ──► model provider
browser     ──► /*           website (Next.js) ──► Postgres, Redis
phone       ──► /remote/*    relay (WebSocket) ◄── desktop app
```

All three run in one container behind Caddy (`infra/render/Dockerfile`), with Postgres and
Redis as managed services.

| Path | What |
| --- | --- |
| `apps/gateway` | Model gateway, metering, quotas |
| `apps/web` | Website, dashboard, admin, desktop APIs, release feed |
| `packages/db` | Drizzle schema, migrations, plans and model catalog |
| `packages/shared` | Shared types and helpers |
| `infra/render` | Production image: Caddy, start script, relay |
| `docs` | Deploy guide, model and verification notes, runbooks |

## Develop

Requirements: Node 24, pnpm 10, Docker.

```bash
pnpm install
cp .env.example .env          # fill in the values
pnpm infra:up                 # local Postgres and Redis
pnpm db:migrate && pnpm db:seed
pnpm dev:gateway              # gateway on :8790
pnpm --filter @deepcode/web dev
```

Checks (the same as CI):

```bash
pnpm typecheck && pnpm lint && pnpm test
pnpm --filter @deepcode/web exec playwright test   # needs the web server on :3210
```

## Deploy

One Docker image (`infra/render/Dockerfile`), deployed on Render; see the step-by-step
[deploy guide](docs/deploy/README.ar.md). Secrets live only in the host's environment,
never in this repository.

## License

Copyright © 2026 DeepCode Studio. All rights reserved. This server code is published for
transparency; no license to use, copy or redistribute it is granted. The desktop app is
open source under Apache-2.0 in [deepcode-desktop](https://github.com/ALSRKAL/deepcode-desktop).
