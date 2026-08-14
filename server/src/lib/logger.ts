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
 * Turn anything throwable into a log-safe, scrubbed plain object. Error messages from fetch
 * and from GGG are the single most likely place for a credential to slip out.
 */
export function describeError(error: unknown): { message: string; name?: string; stack?: string } {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: scrub(error.message),
      ...(error.stack ? { stack: scrub(error.stack) } : {}),
    };
  }
  return { message: scrub(String(error)) };
}

/** pino's error serializer contract: `type`, `message` and `stack` are all required. */
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
