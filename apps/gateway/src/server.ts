import { serve } from "@hono/node-server";
import { createGateway } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const gateway = createGateway(config);
await gateway.start();

const server = serve({ fetch: gateway.app.fetch, port: config.port, hostname: "0.0.0.0" }, (info) => {
  gateway.deps.logger.info("listening", { port: info.port });
});

// Optional private metrics listener (Prometheus). Auth-free by design, so it
// binds to the loopback interface unless GATEWAY_METRICS_HOST says otherwise.
let metricsServer: ReturnType<typeof serve> | undefined;
if (config.metricsPort) {
  metricsServer = serve(
    { fetch: (req) => metricsResponse(gateway, req), port: config.metricsPort, hostname: config.metricsHost },
    (info) => {
      gateway.deps.logger.info("metrics listening", { port: info.port, hostname: config.metricsHost });
    },
  );
  metricsServer.setTimeout?.(0);
}

async function metricsResponse(gateway: Awaited<ReturnType<typeof createGateway>>, req: Request): Promise<Response> {
  if (new URL(req.url).pathname !== "/metrics") {
    return new Response("not found\n", { status: 404 });
  }
  return new Response(await gateway.metricsText(), {
    status: 200,
    headers: { "content-type": "text/plain; version=0.0.4; charset=utf-8" },
  });
}

// Long-lived SSE streams: never let Node time out an open request on its own.
server.setTimeout?.(0);

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  gateway.deps.logger.info("shutting down", { signal, activeStreams: gateway.deps.streams.active });
  server.close();
  metricsServer?.close();
  // Drain open streams for up to 120 s (doc 02 §9), then exit.
  const deadline = Date.now() + 120_000;
  while (gateway.deps.streams.active > 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 500));
  }
  // close() flushes buffered settlements; anything left stays in the Redis stream.
  await gateway.close();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
