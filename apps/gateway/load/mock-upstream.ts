/**
 * Standalone mock upstream for load tests: answers like OpenCode Go, sends headers
 * immediately and spaces stream events by EVENT_DELAY_MS so streams stay open.
 * Usage: node --conditions=@deepcode/source --import tsx load/mock-upstream.ts
 */
import { MockUpstream } from "../test/helpers/mockUpstream.js";

const port = Number(process.env.MOCK_PORT ?? 8799);
const mock = new MockUpstream();
mock.eventDelayMs = Number(process.env.EVENT_DELAY_MS ?? 200);
mock.record = false;
await mock.start(port);
console.log(`mock upstream listening on ${mock.url} (event delay ${mock.eventDelayMs} ms)`);
