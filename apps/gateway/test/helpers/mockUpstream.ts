import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { jsonBody, protocolOf, streamEvents } from "./fixtures.js";

/** Scripted behaviour for the next request made with a given upstream key. */
export interface Behavior {
  status?: number;
  headers?: Record<string, string>;
  body?: string;
  omitUsage?: boolean;
  /** Destroy the socket before sending event N (0-based). */
  cutAfter?: number;
  /** Send two events, then keep the connection open until the client goes away. */
  hang?: boolean;
  /** Write the stream one byte at a time (exercises the framer across chunk boundaries). */
  byteByByte?: boolean;
  /** Replace the default stream with these raw SSE events. */
  events?: string[];
  /** Wait this long before sending any response headers (a queued model). */
  delayMs?: number;
  /** Answer 200 with this JSON body (non-model endpoints such as /v2/search). */
  json?: unknown;
}

export interface RecordedRequest {
  secret: string;
  path: string;
  headers: IncomingMessage["headers"];
  body: any;
}

/**
 * HTTP server standing in for OpenCode Go. Behaviour is scripted per upstream key,
 * so tests that use different pool keys never interfere with each other.
 */
export class MockUpstream {
  readonly requests: RecordedRequest[] = [];
  readonly aborted: string[] = [];
  readonly raw = new Map<string, string>();
  #behaviors = new Map<string, Behavior[]>();
  #server: Server | undefined;
  url = "";
  /** Delay between stream events, to keep streams open like a real model (load tests). */
  eventDelayMs = 0;
  /** When false, request bodies and headers are not kept (load tests). */
  record = true;

  script(secret: string, ...behaviors: Behavior[]): void {
    this.#behaviors.set(secret, [...(this.#behaviors.get(secret) ?? []), ...behaviors]);
  }

  requestsFor(secret: string): RecordedRequest[] {
    return this.requests.filter((r) => r.secret === secret);
  }

  async start(port = 0): Promise<void> {
    this.#server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", async () => {
        const text = Buffer.concat(chunks).toString("utf8");
        const body = text ? JSON.parse(text) : {};
        const auth = req.headers.authorization;
        const secret =
          (auth?.startsWith("Bearer ") ? auth.slice(7) : undefined) ??
          (req.headers["x-api-key"] as string | undefined) ??
          (req.headers["x-goog-api-key"] as string | undefined) ??
          "";
        const path = req.url ?? "";
        if (this.record) this.requests.push({ secret, path, headers: req.headers, body });
        const b = this.#behaviors.get(secret)?.shift() ?? {};
        if (b.delayMs) await new Promise((r) => setTimeout(r, b.delayMs));
        if (res.destroyed) return;

        if (b.status && b.status !== 200) {
          res.writeHead(b.status, { "content-type": "application/json", ...b.headers });
          res.end(b.body ?? JSON.stringify({ error: { message: `mock error ${b.status}` } }));
          return;
        }

        if (b.json !== undefined) {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify(b.json));
          return;
        }

        const protocol = protocolOf(path.split("?")[0]!);
        const streaming = path.includes("streamGenerateContent") || body.stream === true;
        const includeUsage =
          !b.omitUsage && (protocol !== "chat" || !streaming || body.stream_options?.include_usage === true);

        if (!streaming) {
          res.writeHead(200, { "content-type": "application/json", "set-cookie": "upstream_session=leak" });
          res.end(JSON.stringify(jsonBody(protocol, { includeUsage })));
          return;
        }

        const events = b.events ?? streamEvents(protocol, { includeUsage });
        if (this.record) this.raw.set(secret, events.join(""));
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "set-cookie": "upstream_session=leak",
          "x-upstream-account": "acct_123",
        });
        res.on("close", () => {
          if (!res.writableEnded) this.aborted.push(secret);
        });

        if (b.hang) {
          res.write(events[0]!);
          res.write(events[1]!);
          return; // left open on purpose
        }
        for (const [i, ev] of events.entries()) {
          if (b.cutAfter !== undefined && i === b.cutAfter) {
            // Let the headers and earlier events reach the client first; destroy()
            // discards anything still buffered.
            await new Promise((r) => setTimeout(r, 50));
            res.destroy();
            return;
          }
          if (b.byteByByte) {
            for (const byte of Buffer.from(ev)) {
              res.write(Buffer.from([byte]));
              await new Promise((r) => setImmediate(r));
            }
          } else {
            res.write(ev);
          }
          if (this.eventDelayMs > 0) await new Promise((r) => setTimeout(r, this.eventDelayMs));
        }
        res.end();
      });
    });
    await new Promise<void>((resolve) => this.#server!.listen(port, "127.0.0.1", resolve));
    this.url = `http://127.0.0.1:${(this.#server!.address() as AddressInfo).port}`;
  }

  async close(): Promise<void> {
    this.#server?.closeAllConnections();
    await new Promise<void>((resolve) => this.#server?.close(() => resolve()) ?? resolve());
  }
}
