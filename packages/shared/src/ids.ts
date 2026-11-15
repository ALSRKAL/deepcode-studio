/**
 * RFC 9562 UUID version 7: 48-bit Unix millisecond timestamp + random bits.
 * Time-ordered, so request ids sort by creation and index well.
 * Uses globalThis.crypto, which exists in Node 19+, browsers and Electron.
 */
export function uuidv7(nowMs: number = Date.now()): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  let ts = BigInt(nowMs);
  for (let i = 5; i >= 0; i -= 1) {
    bytes[i] = Number(ts & 0xffn);
    ts >>= 8n;
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
