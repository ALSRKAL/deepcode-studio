# DeepCode Studio — single-container server for free hosting (docs/deploy/README.ar.md).
#
# One container runs the gateway (8790), the web portal (3000) and Caddy on $PORT:
#   /v1/*, /v1beta/*, /healthz, /readyz  → gateway (SSE streamed, no buffering)
#   /remote/*                           → phone remote-control relay (8443)
#   everything else                     → web portal
# /internal/* and /metrics are NOT routed: only the web process reaches the
# gateway's internal API over 127.0.0.1.
#
# Build from the repository root:
#   docker build -f infra/render/Dockerfile -t deepcode-server .

FROM caddy:2.10.0 AS caddy

FROM node:24.22.3-bookworm-slim AS build
RUN npm install -g pnpm@10.33.2
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps/gateway ./apps/gateway
COPY apps/web ./apps/web
RUN pnpm install --frozen-lockfile --filter "@deepcode/gateway..." --filter "@deepcode/web..."
RUN pnpm --filter "@deepcode/gateway..." build
# Placeholders only for the build step: env.ts tolerates missing values while
# NEXT_PHASE is the production build; real values come from the host at runtime.
ENV NEXT_OUTPUT_STANDALONE=1 NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter "@deepcode/web..." build
RUN pnpm --filter @deepcode/gateway deploy --prod --legacy /out/gateway
# Standalone server + its static assets.
RUN mkdir -p /out/web \
 && cp -r apps/web/.next/standalone/. /out/web/ \
 && mkdir -p /out/web/apps/web/.next \
 && cp -r apps/web/.next/static /out/web/apps/web/.next/static \
 && if [ -d apps/web/public ]; then cp -r apps/web/public /out/web/apps/web/public; fi

FROM node:24.22.3-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini ca-certificates \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=caddy /usr/bin/caddy /usr/bin/caddy.cap
# The upstream binary carries a cap_net_bind_service file capability; under Render's
# no-new-privileges exec fails ("Operation not permitted"). A plain cp drops the xattr,
# and :10000 needs no capability.
RUN cp /usr/bin/caddy.cap /usr/bin/caddy && rm /usr/bin/caddy.cap && chmod 755 /usr/bin/caddy
COPY --from=build --chown=node:node /out/gateway ./gateway
COPY --from=build --chown=node:node /out/web ./web
COPY --chown=node:node infra/render/start.sh ./
COPY --chown=node:node infra/render/caddy ./caddy
# Phone remote-control relay + its phone page, built from the desktop repo
# (infra/render/remote/README.md says how to refresh them).
COPY --chown=node:node infra/render/remote ./remote
RUN chmod +x /app/start.sh
USER node
ENV PORT=10000
EXPOSE 10000
HEALTHCHECK --interval=15s --timeout=3s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||10000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["/app/start.sh"]
