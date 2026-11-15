/**
 * Incremental SSE framing. Events are forwarded as the exact raw text received
 * (including their delimiter), so passthrough is byte-identical for valid UTF-8.
 * Parsing is lazy: only `event:` and `data:` fields are extracted, and JSON is
 * parsed by adapters only when the event can carry usage.
 */
export interface SseEvent {
  /** Raw text including the trailing blank-line delimiter. */
  raw: string;
  event: string | null;
  data: string;
}

const DELIMITER = /\r\n\r\n|\n\n/;

export function parseEvent(raw: string): SseEvent {
  let event: string | null = null;
  const data: string[] = [];
  for (const line of raw.split(/\r\n|\n|\r/)) {
    if (line === "" || line.startsWith(":")) continue;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") event = value;
    else if (field === "data") data.push(value);
  }
  return { raw, event, data: data.join("\n") };
}

export class SseFramer {
  #decoder = new TextDecoder("utf-8");
  #buffer = "";

  /** Feed bytes; returns complete events. */
  push(chunk: Uint8Array): SseEvent[] {
    this.#buffer += this.#decoder.decode(chunk, { stream: true });
    const events: SseEvent[] = [];
    for (;;) {
      const match = DELIMITER.exec(this.#buffer);
      if (!match) break;
      const end = match.index + match[0].length;
      events.push(parseEvent(this.#buffer.slice(0, end)));
      this.#buffer = this.#buffer.slice(end);
    }
    return events;
  }

  /** Remaining text after the stream ends (an unterminated final event, if any). */
  flush(): SseEvent | null {
    this.#buffer += this.#decoder.decode();
    const rest = this.#buffer;
    this.#buffer = "";
    return rest.length > 0 ? parseEvent(rest) : null;
  }
}

/** Parse JSON only when it might contain one of the given markers (cheap pre-check). */
export function parseIfContains(data: string, markers: string[]): any {
  if (!markers.some((m) => data.includes(m))) return undefined;
  try {
    return JSON.parse(data);
  } catch {
    return undefined;
  }
}
