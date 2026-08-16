/**
 * GGG's rate limiter, respected properly.
 *
 * Every response carries the policy in force and our current position in it:
 *
 *   X-Rate-Limit-Account:       45:60:120,180:3600:3600
 *   X-Rate-Limit-Account-State:  2:60:0,  17:3600:0
 *
 * Each triple is `hits:period:restrictTime`. In the limit header it is the allowance; in the
 * state header it is what we have already spent, and a non-zero `restrictTime` means we are
 * being timed out right now. There can be several policies at once — the tightest wins.
 *
 * Rules this class enforces, all of them non-negotiable:
 *   - one request at a time, never in parallel;
 *   - pace at the tightest bucket's natural rate (period / hits) rather than bursting;
 *   - hard-wait a full period when a bucket is spent, and the stated time when restricted;
 *   - on 429, honour Retry-After and then double, capped at 30 minutes.
 *
 * `fetchFn`, `sleep` and `now` are injectable so the tests can drive a decade of rate-limit
 * behaviour in milliseconds without touching the network.
 */

import { describeError, silentLogger, type Logger } from './logger.ts';
import { timeoutSignal } from './http.ts';

export interface RateLimitPolicy {
  hits: number;
  periodSeconds: number;
  restrictedSeconds: number;
}

export interface BucketView {
  limit: RateLimitPolicy;
  state: RateLimitPolicy | null;
  remaining: number;
}

export interface RateLimitView {
  buckets: BucketView[];
  observedAt: string | null;
  restrictedUntil: string | null;
  consecutive429: number;
  /** Null until the first request; otherwise when the next one may go out. */
  nextRequestAt: string | null;
  totalRequests: number;
  total429: number;
}

export interface RateLimiterOptions {
  fetchFn?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  log?: Logger;
  /** Retries of a single request after a 429 before giving up. */
  maxRetries?: number;
  /** Floor for the first 429 wait when the response carries no Retry-After. */
  minBackoffMs?: number;
  /** Ceiling for the doubling. The spec's 30 minutes. */
  maxBackoffMs?: number;
  /** Never fire two requests closer together than this, even with an empty bucket. */
  minIntervalMs?: number;
  /** Ceiling on a single attempt. Without one, a hung socket stops the poller permanently. */
  timeoutMs?: number;
  /** Ceiling on any wait this class will sit through, however long a header asks for. */
  maxWaitMs?: number;
}

export class RateLimitError extends Error {
  readonly retryAfterMs: number;
  constructor(message: string, retryAfterMs: number) {
    super(message);
    this.name = 'RateLimitError';
    this.retryAfterMs = retryAfterMs;
  }
}

const HEADER_LIMIT = 'x-rate-limit-account';
const HEADER_STATE = 'x-rate-limit-account-state';
/** Applied to the whole client, not just the account. Parsed the same way. */
const HEADER_CLIENT_LIMIT = 'x-rate-limit-ip';
const HEADER_CLIENT_STATE = 'x-rate-limit-ip-state';

/**
 * Parse a `hits:period:restrict,hits:period:restrict` header. Anything malformed is dropped
 * rather than guessed at: a policy we cannot read is a policy we must not pretend to know.
 */
export function parseRateLimitHeader(value: string | null | undefined): RateLimitPolicy[] {
  if (!value) return [];
  const policies: RateLimitPolicy[] = [];
  for (const chunk of value.split(',')) {
    const parts = chunk.trim().split(':');
    if (parts.length !== 3) continue;
    const numbers = parts.map((part) => Number(part.trim()));
    if (numbers.some((value) => !Number.isFinite(value))) continue;
    const [hits = Number.NaN, periodSeconds = Number.NaN, restrictedSeconds = Number.NaN] = numbers;
    if (hits < 0 || periodSeconds <= 0) continue;
    policies.push({ hits, periodSeconds, restrictedSeconds });
  }
  return policies;
}

/** `Retry-After` is seconds in every GGG response we have seen, but the header also permits
 *  an HTTP date. Handle both; fall back to 0 so the caller applies its own floor. */
export function parseRetryAfter(value: string | null | undefined, nowMs: number): number {
  if (!value) return 0;
  const seconds = Number(value.trim());
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(value);
  if (Number.isFinite(at)) return Math.max(0, at - nowMs);
  return 0;
}

/**
 * How long to wait before the next request, given every policy in force. Returns the largest
 * wait any single bucket demands — the tightest bucket, as the spec puts it.
 */
export function computeDelayMs(
  limits: RateLimitPolicy[],
  states: RateLimitPolicy[],
  options: { minIntervalMs?: number } = {},
): number {
  let delay = options.minIntervalMs ?? 0;

  for (let i = 0; i < limits.length; i += 1) {
    const limit = limits[i];
    if (!limit || limit.hits <= 0) continue;
    const state = states[i] ?? null;

    // Actively restricted: the server has told us exactly how long to sit down for.
    if (state && state.restrictedSeconds > 0) {
      delay = Math.max(delay, state.restrictedSeconds * 1000);
    }

    const used = state?.hits ?? 0;
    const remaining = limit.hits - used;

    if (remaining <= 0) {
      // Bucket spent. We do not know when the window opened, so assume the worst.
      delay = Math.max(delay, limit.periodSeconds * 1000);
      continue;
    }

    // Pace at the rate the bucket refills. Bursting up to the cap and then stalling is what
    // trips the longer policies, and it buys nothing: the poll has ten minutes to finish.
    delay = Math.max(delay, (limit.periodSeconds / limit.hits) * 1000);
  }

  return Math.ceil(delay);
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class RateLimiter {
  readonly #fetch: typeof fetch;
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #now: () => number;
  readonly #log: Logger;
  readonly #maxRetries: number;
  readonly #minBackoffMs: number;
  readonly #maxBackoffMs: number;
  readonly #minIntervalMs: number;
  readonly #timeoutMs: number;
  readonly #maxWaitMs: number;

  #limits: RateLimitPolicy[] = [];
  #states: RateLimitPolicy[] = [];
  #observedAt: number | null = null;
  #restrictedUntil: number | null = null;
  #nextRequestAt = 0;
  #consecutive429 = 0;
  #totalRequests = 0;
  #total429 = 0;
  /** The serialisation point: every request links onto this chain. */
  #queue: Promise<unknown> = Promise.resolve();

  constructor(options: RateLimiterOptions = {}) {
    this.#fetch = options.fetchFn ?? globalThis.fetch;
    this.#sleep = options.sleep ?? defaultSleep;
    this.#now = options.now ?? Date.now;
    this.#log = options.log ?? silentLogger;
    this.#maxRetries = options.maxRetries ?? 3;
    this.#minBackoffMs = options.minBackoffMs ?? 10_000;
    this.#maxBackoffMs = options.maxBackoffMs ?? 30 * 60_000;
    this.#minIntervalMs = options.minIntervalMs ?? 1_000;
    this.#timeoutMs = options.timeoutMs ?? 30_000;
    // A restrictedSeconds of 999999999 — a garbled header, a proxy inventing one — would
    // otherwise put the poller to sleep for thirty years. An hour is longer than any real
    // GGG timeout and short enough that the next poll still gets a turn.
    this.#maxWaitMs = options.maxWaitMs ?? 60 * 60_000;
  }

  /** Run `task` with nothing else in flight. Used for anything that must not race a request. */
  schedule<T>(task: () => Promise<T>): Promise<T> {
    const run = this.#queue.then(task, task);
    // Keep the chain alive even when a task rejects; the rejection goes to the caller.
    this.#queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /**
   * Perform one rate-limited request. Serialised against every other call on this limiter,
   * delayed to stay inside the buckets, and retried on 429 with honoured Retry-After.
   */
  request(url: string, init: RequestInit = {}): Promise<Response> {
    return this.schedule(() => this.#attempt(url, init));
  }

  async #attempt(url: string, init: RequestInit): Promise<Response> {
    for (let attempt = 0; ; attempt += 1) {
      await this.#waitForSlot();

      let response: Response;
      try {
        response = await this.#fetch(url, {
          ...init,
          signal: timeoutSignal(this.#timeoutMs, init.signal),
        });
      } catch (error) {
        // A transport failure still consumed a slot as far as we know. Keep the pacing.
        this.#nextRequestAt = this.#now() + this.#minIntervalMs;
        this.#log.warn({ err: describeError(error) }, 'rate-limited request failed in transport');
        throw error;
      }

      this.#totalRequests += 1;
      this.observe(response.headers);

      if (response.status !== 429) {
        this.#consecutive429 = 0;
        return response;
      }

      this.#total429 += 1;
      this.#consecutive429 += 1;
      const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'), this.#now());
      const waitMs = this.#backoffMs(retryAfterMs);
      this.#restrictedUntil = this.#now() + waitMs;

      if (attempt >= this.#maxRetries) {
        this.#log.error(
          { consecutive429: this.#consecutive429, waitMs },
          'gave up on a request after repeated 429s',
        );
        throw new RateLimitError(
          `GGG returned 429 ${attempt + 1} times; backing off ${Math.round(waitMs / 1000)}s`,
          waitMs,
        );
      }

      this.#log.warn(
        { attempt: attempt + 1, retryAfterMs, waitMs, consecutive429: this.#consecutive429 },
        'rate limited by GGG, backing off',
      );
      await this.#sleep(waitMs);
      this.#nextRequestAt = this.#now();
    }
  }

  /** Honour Retry-After first, then double it per consecutive 429, capped at the ceiling. */
  #backoffMs(retryAfterMs: number): number {
    const base = Math.max(retryAfterMs, this.#minBackoffMs);
    const doubled = base * 2 ** Math.max(0, this.#consecutive429 - 1);
    return Math.min(doubled, this.#maxBackoffMs);
  }

  async #waitForSlot(): Promise<void> {
    const delay = computeDelayMs(this.#limits, this.#states, { minIntervalMs: this.#minIntervalMs });
    const readyAt = Math.max(this.#nextRequestAt, this.#restrictedUntil ?? 0);
    const wanted = Math.max(readyAt - this.#now(), 0, this.#observedAt === null ? 0 : delay);
    const wait = Math.min(wanted, this.#maxWaitMs);

    if (wanted > this.#maxWaitMs) {
      this.#log.warn(
        { wantedMs: wanted, cappedToMs: wait },
        'a rate-limit header asked for an implausible wait; capping it',
      );
    }

    if (wait > 0) {
      if (wait > 5_000) this.#log.info({ waitMs: wait }, 'holding off to stay inside the rate limit');
      await this.#sleep(wait);
    }
    this.#nextRequestAt = this.#now() + this.#minIntervalMs;
  }

  /** Record the policy state from a response. Public so a non-limited probe can feed it too. */
  observe(headers: Headers): void {
    const limits = [
      ...parseRateLimitHeader(headers.get(HEADER_LIMIT)),
      ...parseRateLimitHeader(headers.get(HEADER_CLIENT_LIMIT)),
    ];
    const states = [
      ...parseRateLimitHeader(headers.get(HEADER_STATE)),
      ...parseRateLimitHeader(headers.get(HEADER_CLIENT_STATE)),
    ];
    if (limits.length === 0) return;

    this.#limits = limits;
    this.#states = states;
    this.#observedAt = this.#now();

    const restrictedSeconds = states.reduce((max, state) => Math.max(max, state.restrictedSeconds), 0);
    if (restrictedSeconds > 0) {
      this.#restrictedUntil = this.#now() + restrictedSeconds * 1000;
      this.#log.warn({ restrictedSeconds }, 'GGG has us in a rate-limit timeout');
    } else if (this.#restrictedUntil !== null && this.#restrictedUntil <= this.#now()) {
      this.#restrictedUntil = null;
    }
  }

  /** Everything /api/health reports about rate limiting. */
  view(): RateLimitView {
    return {
      buckets: this.#limits.map((limit, i) => ({
        limit,
        state: this.#states[i] ?? null,
        remaining: Math.max(0, limit.hits - (this.#states[i]?.hits ?? 0)),
      })),
      observedAt: this.#observedAt === null ? null : new Date(this.#observedAt).toISOString(),
      restrictedUntil:
        this.#restrictedUntil === null ? null : new Date(this.#restrictedUntil).toISOString(),
      consecutive429: this.#consecutive429,
      nextRequestAt:
        this.#nextRequestAt === 0 ? null : new Date(this.#nextRequestAt).toISOString(),
      totalRequests: this.#totalRequests,
      total429: this.#total429,
    };
  }
}
