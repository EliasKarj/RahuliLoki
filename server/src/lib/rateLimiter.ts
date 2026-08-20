/**
 * GGG's rate limiter, respected properly.
 *
 * Every response carries the policy in force and our current position in it:
 *
 *   X-Rate-Limit-Account:       45:60:120,200:3600:3600
 *   X-Rate-Limit-Account-State:  2:60:0,  17:3600:0
 *
 * Each triple is `hits:period:restrictTime`. In the limit header it is the allowance; in the
 * state header it is what we have already spent, and a non-zero `restrictTime` means we are
 * being timed out right now. There can be several policies at once — the tightest wins.
 *
 * ## The numbers above are an example, not a specification
 *
 * Nothing in this file assumes them. `#limits` starts empty: until a response arrives this class
 * knows no policy at all, which is why it opens with a single request and widens only once the
 * headers have told it what the allowance is. Every figure it paces by is read from the headers
 * of the response in front of it.
 *
 * That is deliberate and it is the only defensible design, because GGG changes these numbers,
 * varies them per endpoint, and does not promise them anywhere this project has verified. Any
 * constant compiled in here would be a guess that goes stale silently. The example above is
 * illustrative — an earlier version of this comment said `180:3600:3600` a few lines from a
 * comment saying `200`, which is exactly what an unverified constant looks like once two people
 * have edited around it.
 *
 * Rules this class enforces, all of them non-negotiable:
 *   - one admission decision at a time, each seeing what the previous one spent;
 *   - never more requests in the air than the observed window has room for;
 *   - pace toward the tightest bucket's natural rate (period / hits) as that bucket empties;
 *   - hard-wait a full period when a bucket is spent, and the stated time when restricted;
 *   - on 429, honour Retry-After and then double, capped at 30 minutes.
 *
 * `fetchFn`, `sleep` and `now` are injectable so the tests can drive a decade of rate-limit
 * behaviour in milliseconds without touching the network.
 */

import { silentLogger, type Logger } from './logger.ts';
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
  /**
   * A hard floor between requests. **Zero by default, and that is the right default.**
   *
   * It used to be one second, and it was the whole reason a poll crawled. GGG's policy allows
   * forty-five requests a minute; this app spent a second between every one of them, so a
   * twenty-four-tab stash took twenty-six seconds to read when the allowance covered it in
   * under four — with the bucket barely touched the entire time. The allowance was there and we
   * simply refused to spend it.
   *
   * There is no moment where a constant beats the headers. Before the first response there is
   * no previous request to be too close to; after it, `computeDelayMs` knows how much of the
   * real bucket is left, which is strictly more than a constant knows. It stays as an option
   * because it is the one way to deliberately slow this app down — behind a proxy that has its
   * own limits, say — and never because the pacing needs help.
   */
  minIntervalMs?: number;
  /** Ceiling on a single attempt. Without one, a hung socket stops the poller permanently. */
  timeoutMs?: number;
  /** Ceiling on any wait this class will sit through, however long a header asks for. */
  maxWaitMs?: number;
  /**
   * How many requests may be in the air at once while the buckets have room to spare.
   *
   * Concurrency does not change how many requests a window counts, only how long they take
   * wall-clock. It drops to one the moment pacing starts, so the paced region is still one
   * decision per observed state.
   */
  concurrency?: number;
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
 * The share of a bucket that may be spent freely before pacing starts.
 *
 * Half. Below that the delay ramps toward the bucket's refill rate, so the second half of the
 * allowance is what pays for the slowdown — the first half is there to be used. Lower means
 * faster polls and less margin; higher means the opposite. It is a single number on purpose:
 * the tuning knob for "how close to GGG's cap is this app willing to run".
 */
export const PACING_RESERVE = 0.5;

/**
 * How long to wait before the next request, given every policy in force. Returns the largest
 * wait any single bucket demands — the tightest bucket, as the spec puts it.
 */
export function computeDelayMs(
  limits: RateLimitPolicy[],
  states: RateLimitPolicy[],
  options: { minIntervalMs?: number; inFlight?: number } = {},
): number {
  let delay = options.minIntervalMs ?? 0;
  // Requests already launched whose response has not come back yet. GGG has counted them; our
  // observed state has not seen them. Without this, concurrency would hide exactly as many hits
  // as it allowed in flight, and the pacing would start late by that many.
  const unseen = Math.max(0, options.inFlight ?? 0);

  for (let i = 0; i < limits.length; i += 1) {
    const limit = limits[i];
    if (!limit || limit.hits <= 0) continue;
    const state = states[i] ?? null;

    // Actively restricted: the server has told us exactly how long to sit down for.
    if (state && state.restrictedSeconds > 0) {
      delay = Math.max(delay, state.restrictedSeconds * 1000);
    }

    const used = (state?.hits ?? 0) + unseen;
    const remaining = limit.hits - used;

    if (remaining <= 0) {
      // Bucket spent. We do not know when the window opened, so assume the worst.
      delay = Math.max(delay, limit.periodSeconds * 1000);
      continue;
    }

    // Pace by how much of the bucket is left, not by its average refill rate.
    //
    // Pacing every request at the slowest bucket's average was too blunt. GGG publishes
    // something like `45:60:120,200:3600:3600`, and the hourly policy averages out to one
    // request every eighteen seconds — so reading a twenty-tab stash took six minutes with the
    // hourly budget barely touched. The allowance was there; we simply refused to spend it.
    //
    // A bucket with room to spare imposes nothing. Past the reserve the delay ramps up smoothly
    // and reaches the full refill rate exactly as the bucket empties, so approaching the cap is
    // a slowdown rather than a wall. The hard protections are untouched above: a spent bucket
    // still waits out its whole period, and an explicit restriction is still obeyed to the
    // second.
    const headroom = remaining / limit.hits;
    if (headroom >= PACING_RESERVE) continue;

    const pressure = (PACING_RESERVE - headroom) / PACING_RESERVE;
    delay = Math.max(delay, pressure * (limit.periodSeconds / limit.hits) * 1000);
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
  /** The serialisation point: every *admission* links onto this chain. */
  #queue: Promise<unknown> = Promise.resolve();
  /** Launched, not yet accounted for by an observed state. */
  #inFlight = 0;
  readonly #concurrency: number;
  #settledResolve: (() => void) | null = null;
  #settled: Promise<void> = Promise.resolve();

  constructor(options: RateLimiterOptions = {}) {
    this.#fetch = options.fetchFn ?? globalThis.fetch;
    this.#sleep = options.sleep ?? defaultSleep;
    this.#now = options.now ?? Date.now;
    this.#log = options.log ?? silentLogger;
    this.#maxRetries = options.maxRetries ?? 3;
    this.#minBackoffMs = options.minBackoffMs ?? 10_000;
    this.#maxBackoffMs = options.maxBackoffMs ?? 30 * 60_000;
    this.#minIntervalMs = options.minIntervalMs ?? 0;
    // Six. GGG's tightest stash policy is forty-five a minute and pacing starts at half of it,
    // so at most six requests can be unaccounted for inside a margin of twenty-two. Enough to
    // read a stash at network speed rather than at network latency times the tab count, and far
    // enough from the cap that the overshoot cannot reach it.
    this.#concurrency = Math.max(1, options.concurrency ?? 6);
    this.#settled = new Promise<void>((resolve) => {
      this.#settledResolve = resolve;
    });
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
   * Perform one rate-limited request.
   *
   * Two things used to be one thing here: deciding *when* a request may start, and waiting for
   * it to come back. Only the first has to be serialised. Holding the queue for the round trip
   * as well meant a stash was read strictly one network latency at a time — twenty-four tabs at
   * two hundred milliseconds each is five seconds of waiting for a policy that would have
   * allowed all twenty-four at once.
   *
   * So admission is serialised and the round trip is not. GGG's buckets count requests per
   * window, not requests at a time; what has to stay true is that we never launch more than the
   * window has room for, and `#inFlight` is what keeps the pacing honest about the ones already
   * in the air.
   */
  async request(url: string, init: RequestInit = {}): Promise<Response> {
    for (let attempt = 0; ; attempt += 1) {
      await this.schedule(() => this.#admit());

      let response: Response;
      try {
        response = await this.#fire(url, init);
      } catch (error) {
        this.#log.warn({ err: error }, 'rate-limited request failed in transport');
        throw error;
      }

      if (response.status !== 429) {
        this.#consecutive429 = 0;
        return response;
      }

      this.#total429 += 1;
      this.#consecutive429 += 1;
      const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'), this.#now());
      const waitMs = this.#backoffMs(retryAfterMs);
      // Global, not per-request: a 429 is the account being told to sit down, so everything
      // waiting for admission waits with it.
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

  /**
   * Take a slot: wait until the buckets allow another request, then count it as in flight.
   *
   * Runs on the queue, so exactly one caller is deciding at a time and each decision sees the
   * count the previous one left behind.
   */
  async #admit(): Promise<void> {
    // While pacing is active the concurrency drops to one, so every delay is computed against a
    // fresh observation instead of against a guess about several unfinished requests.
    while (this.#inFlight >= this.#concurrencyNow()) await this.#anySettled();
    await this.#waitForSlot();
    this.#inFlight += 1;
  }

  /** One request, from the wire to the recorded state. Not serialised; several may overlap. */
  async #fire(url: string, init: RequestInit): Promise<Response> {
    try {
      const response = await this.#fetch(url, {
        ...init,
        signal: timeoutSignal(this.#timeoutMs, init.signal),
      });
      this.#totalRequests += 1;
      this.observe(response.headers);
      return response;
    } finally {
      // Whatever happened, it is no longer in the air: either its hits are in the observed
      // state, or it never reached GGG. A transport failure is counted as spent anyway — we
      // cannot know that it did not arrive.
      this.#inFlight = Math.max(0, this.#inFlight - 1);
      this.#nextRequestAt = this.#now() + this.#minIntervalMs;
      const wake = this.#settledResolve;
      this.#settled = new Promise<void>((resolve) => {
        this.#settledResolve = resolve;
      });
      wake?.();
    }
  }

  /**
   * How many may be in the air right now.
   *
   * One until GGG has told us its policy, and one again as soon as the buckets ask for pacing.
   * The first of those matters more than it looks: before any response there is no policy and
   * no state, so opening with six concurrent requests would be guessing that the allowance is
   * at least six — a guess with nothing behind it. One request buys the headers, and everything
   * after it is informed.
   */
  #concurrencyNow(): number {
    if (this.#observedAt === null) return 1;
    const paced = computeDelayMs(this.#limits, this.#states, {
      minIntervalMs: this.#minIntervalMs,
      inFlight: this.#inFlight,
    });
    return paced > 0 ? 1 : this.#concurrency;
  }

  /** Resolves the next time any in-flight request finishes. */
  #anySettled(): Promise<void> {
    return this.#settled;
  }

  /** Honour Retry-After first, then double it per consecutive 429, capped at the ceiling. */
  #backoffMs(retryAfterMs: number): number {
    const base = Math.max(retryAfterMs, this.#minBackoffMs);
    const doubled = base * 2 ** Math.max(0, this.#consecutive429 - 1);
    return Math.min(doubled, this.#maxBackoffMs);
  }

  async #waitForSlot(): Promise<void> {
    const delay = computeDelayMs(this.#limits, this.#states, {
      minIntervalMs: this.#minIntervalMs,
      inFlight: this.#inFlight,
    });
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
