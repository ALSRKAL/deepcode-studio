# Build from the repository root:
#   docker build -f apps/gateway/Dockerfile -t deepcode-gateway .
# Run migrations, then the server:
#   docker run --env-file .env deepcode-gateway node dist/migrate.js
#   docker run --env-file .env -p 8790:8790 deepcode-gateway

FROM node:24.22.3-bookworm-slim AS build
RUN npm install -g pnpm@10.33.2
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps/gateway ./apps/gateway
RUN pnpm install --frozen-lockfile --filter "@deepcode/gateway..."
RUN pnpm --filter "@deepcode/gateway..." build
RUN pnpm --filter @deepcode/gateway deploy --prod --legacy /out

FROM node:24.22.3-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 8790
HEALTHCHECK --interval=10s --timeout=3s CMD node -e "fetch('http://127.0.0.1:'+(process.env.GATEWAY_PORT||8790)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.js"]
