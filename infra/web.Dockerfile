# DeepCode Studio web portal — production image (Next.js standalone-ish build).
# Build from the repo root: docker build -f infra/web.Dockerfile .
FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
RUN corepack enable && pnpm install --frozen-lockfile --filter @deepcode/web...

FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app /app
COPY . .
RUN corepack enable && pnpm --filter @deepcode/shared --filter @deepcode/db --filter @deepcode/web build

FROM node:24-bookworm-slim AS run
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/apps/web/.next /app/apps/web/.next
COPY --from=build /app/apps/web/node_modules /app/apps/web/node_modules
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/packages /app/packages
COPY --from=build /app/apps/web/package.json /app/apps/web/package.json
WORKDIR /app/apps/web
EXPOSE 3210
CMD ["node", "node_modules/next/dist/bin/next", "start", "--port", "3210"]
