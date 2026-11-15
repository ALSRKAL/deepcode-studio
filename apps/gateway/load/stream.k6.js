// G-28: 150 concurrent streaming requests against the gateway.
// Usage: k6 run -e GATEWAY=http://127.0.0.1:8790 -e KEY_FILE=/path/key.json load/stream.k6.js
import http from "k6/http";
import { check } from "k6";
import { Trend, Counter } from "k6/metrics";

const cfg = JSON.parse(open(__ENV.KEY_FILE));
const gateway = __ENV.GATEWAY || "http://127.0.0.1:8790";

const ttfb = new Trend("gateway_ttfb_ms", true);
const unmetered = new Counter("unmetered_streams");

export const options = {
  scenarios: {
    streams: {
      executor: "constant-vus",
      vus: Number(__ENV.VUS || 150),
      duration: __ENV.DURATION || "60s",
    },
  },
  thresholds: {
    http_req_failed: ["rate==0"],
    gateway_ttfb_ms: ["p(50)<15", "p(99)<50"],
    unmetered_streams: ["count==0"],
  },
};

export default function () {
  const res = http.post(
    `${gateway}/v1/chat/completions`,
    JSON.stringify({ model: cfg.model, stream: true, messages: [{ role: "user", content: "hello" }] }),
    { headers: { "content-type": "application/json", authorization: `Bearer ${cfg.key}` }, timeout: "30s" },
  );
  // The mock sends headers immediately, so time-to-first-byte is the gateway's own overhead.
  ttfb.add(res.timings.waiting);
  const ok = check(res, {
    "status 200": (r) => r.status === 200,
    "usage notice present": (r) => typeof r.body === "string" && r.body.includes(": deepcode-usage "),
    "stream completed": (r) => typeof r.body === "string" && r.body.includes("[DONE]"),
  });
  if (res.status === 200 && !(typeof res.body === "string" && res.body.includes('"estimated":false'))) {
    unmetered.add(1);
  }
  if (!ok) console.error(`status ${res.status} ${String(res.body).slice(0, 160)}`);
}
