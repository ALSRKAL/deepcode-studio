/**
 * Structured JSON logger with redaction at the sink (doc 02 §7, doc 04 §3.1).
 *
 * Every string that reaches the output passes through `redact`, which removes:
 *  - anything shaped like a DeepCode virtual key,
 *  - every registered secret (decrypted pool keys register themselves),
 *  - values of fields whose names look like credentials.
 * Request and response bodies are never passed to the logger.
 */
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
export type LogLevel = keyof typeof LEVELS;

const VIRTUAL_KEY_RE = /sk-dc-[A-Za-z0-9]{4,}/g;
const SENSITIVE_FIELD_RE = /^(authorization|x-api-key|x-goog-api-key|api[-_]?key|password|secret|token|cookie|set-cookie|plaintext)$/i;
const MIN_SECRET_LENGTH = 8;

export class SecretRegistry {
  #secrets = new Set<string>();

  add(secret: string): void {
    if (secret.length >= MIN_SECRET_LENGTH) this.#secrets.add(secret);
  }

  delete(secret: string): void {
    this.#secrets.delete(secret);
  }

  redactString(value: string): string {
    let out = value.replace(VIRTUAL_KEY_RE, "sk-dc-[REDACTED]");
    for (const secret of this.#secrets) {
      if (out.includes(secret)) out = out.split(secret).join("[REDACTED]");
    }
    return out;
  }

  redact(value: unknown, depth = 0): unknown {
    if (typeof value === "string") return this.redactString(value);
    if (value === null || typeof value !== "object" || depth > 6) return value;
    if (value instanceof Error) {
      return { name: value.name, message: this.redactString(value.message) };
    }
    if (Array.isArray(value)) return value.map((v) => this.redact(v, depth + 1));
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SENSITIVE_FIELD_RE.test(k) ? "[REDACTED]" : this.redact(v, depth + 1);
    }
    return out;
  }
}

export type LogSink = (line: string) => void;

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  child(fields: Record<string, unknown>): Logger;
}

export function createLogger(options: {
  level: LogLevel;
  secrets: SecretRegistry;
  sink?: LogSink;
  base?: Record<string, unknown>;
}): Logger {
  const sink = options.sink ?? ((line: string) => process.stdout.write(`${line}\n`));
  const min = LEVELS[options.level];
  const make = (base: Record<string, unknown>): Logger => {
    const emit = (level: LogLevel, msg: string, fields?: Record<string, unknown>) => {
      if (LEVELS[level] < min) return;
      const record = options.secrets.redact({
        time: new Date().toISOString(),
        level,
        msg,
        ...base,
        ...fields,
      });
      sink(JSON.stringify(record));
    };
    return {
      debug: (m, f) => emit("debug", m, f),
      info: (m, f) => emit("info", m, f),
      warn: (m, f) => emit("warn", m, f),
      error: (m, f) => emit("error", m, f),
      child: (fields) => make({ ...base, ...fields }),
    };
  };
  return make(options.base ?? {});
}
