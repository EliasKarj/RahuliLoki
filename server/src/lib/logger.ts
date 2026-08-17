/**
 * Logging, with one job beyond formatting: POESESSID must never reach a log line.
 *
 * Two layers, because secrets leak two different ways:
 *   1. Structured — a header bag or config object gets logged wholesale. Handled by pino's
 *      `redact` paths below.
 *   2. Unstructured — a fetch error message or an upstream response body happens to contain
 *      the cookie we sent. Handled by `scrub`, which every error path runs its text through.
 */

const secrets = new Set<string>();

/** Register a value that must never appear in log output. Short values are ignored: a
 *  two-character "secret" would blank out half of every message. */
export function registerSecret(secret: string | undefined | null): void {
  if (typeof secret !== 'string') return;
  const trimmed = secret.trim();
  if (trimmed.length < 8) return;
  secrets.add(trimmed);
}

/** Test seam. Production never needs to forget a secret. */
export function clearSecrets(): void {
  secrets.clear();
}

/** Replace every registered secret in `text` with a marker. */
export function scrub(text: string): string {
  let out = text;
  for (const secret of secrets) {
    if (out.includes(secret)) out = out.split(secret).join('[redacted]');
  }
  return out;
}

/**
 * Describe a thrown value that is not an Error, without falling back to `String()`.
 *
 * `String({})` is `"[object Object]"`, which is the least useful sentence a diagnostic can
 * produce. Something was thrown and it had fields; print them.
 */
function describeNonError(value: unknown): string {
  if (value === null || value === undefined || typeof value !== 'object') return String(value);

  const record = value as Record<string, unknown>;
  // The fields Node's own network and filesystem errors carry.
  const parts = ['message', 'code', 'errno', 'syscall', 'hostname', 'address', 'port']
    .filter((key) => record[key] !== undefined)
    .map((key) => `${key}=${String(record[key])}`);
  if (parts.length > 0) return parts.join(' ');

  try {
    const json = JSON.stringify(value);
    if (json !== undefined && json !== '{}') return json;
  } catch {
    // Circular, or a getter that throws. Fall through to the last resort.
  }
  return Object.prototype.toString.call(value);
}

/**
 * Follow an error's `cause` chain and append what each link says.
 *
 * This is the difference between a usable log line and a useless one. `fetch` reports every
 * transport failure as a bare `TypeError: fetch failed` and puts the actual reason — DNS lookup
 * failed, connection refused, certificate expired, timed out — in `cause`. Without this, the
 * poller reports a GGG outage, a typo in a hostname, a dead network and an expired CA
 * identically, and the operator has nothing to act on.
 */
function withCauses(error: Error): string {
  const seen = new Set<unknown>([error]);
  const parts = [error.message];

  let current: unknown = (error as { cause?: unknown }).cause;
  // Bounded: a cause chain can be circular, and a malformed one must not hang the logger.
  for (let depth = 0; current !== undefined && current !== null && depth < 5; depth += 1) {
    if (seen.has(current)) break;
    seen.add(current);
    parts.push(current instanceof Error ? current.message : describeNonError(current));
    current = current instanceof Error ? (current as { cause?: unknown }).cause : undefined;
  }

  // Deduplicate: a wrapper that repeats its cause verbatim should not say it twice.
  return [...new Set(parts.filter((part) => part !== ''))].join(': ');
}

/**
 * Turn anything throwable into a log-safe, scrubbed plain object. Error messages from fetch
 * and from GGG are the single most likely place for a credential to slip out.
 */
export function describeError(error: unknown): { message: string; name?: string; stack?: string } {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: scrub(withCauses(error)),
      ...(error.stack ? { stack: scrub(error.stack) } : {}),
    };
  }
  return { message: scrub(describeNonError(error)) };
}

/**
 * pino's error serializer contract: `type`, `message` and `stack` are all required.
 *
 * Log the raw error — `log.warn({ err: error }, …)` — and let this run. Calling `describeError`
 * at the call site instead serialises twice: pino then receives a plain object, which is no
 * longer an Error, so it gets described by its fields and the line reads
 * `"message":"message=GGG returned HTTP 403"` with an empty stack. `describeError` is for
 * places that need the text itself, like an API response.
 */
export function serializeError(error: unknown): { type: string; message: string; stack: string } {
  const described = describeError(error);
  return {
    type: described.name ?? 'Error',
    message: described.message,
    stack: described.stack ?? '',
  };
}

export function loggerOptions(level: string) {
  return {
    level,
    /**
     * Scrub every string that reaches a log method, whatever it was going to say.
     *
     * The other two layers cover the two ways a secret was expected to arrive: a named field,
     * and an Error running through the serializer. Neither covers a message written by hand
     * around an upstream response. Nothing in this codebase writes one — but "nothing does
     * that" is a convention, and the log is now a file on disk that outlives the run rather
     * than a terminal someone closed.
     *
     * A hook makes it structural instead. It costs one pass over the strings of a line that was
     * being serialised anyway, and it cannot be forgotten at a call site.
     */
    hooks: {
      logMethod(this: unknown, args: unknown[], method: (...args: unknown[]) => void): void {
        method.apply(
          this,
          args.map((arg) => (typeof arg === 'string' ? scrub(arg) : arg)),
        );
      },
    },
    redact: {
      paths: [
        'poesessid',
        'config.poesessid',
        'req.headers.cookie',
        'req.headers.authorization',
        'headers.cookie',
        'options.headers.cookie',
        'POESESSID',
      ],
      censor: '[redacted]',
    },
    serializers: {
      err: serializeError,
      error: serializeError,
    },
  };
}

/** The slice of a logger the services actually use. Keeps test doubles to four methods. */
export interface Logger {
  debug(obj: unknown, msg?: string): void;
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

/** A logger that discards everything — the default for services in tests. */
export const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};
