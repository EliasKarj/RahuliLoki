import { describe, expect, it, vi } from 'vitest';
import {
  RateLimitError,
  RateLimiter,
  computeDelayMs,
  parseRateLimitHeader,
  parseRetryAfter,
} from '../src/lib/rateLimiter.ts';
import { stashResponse } from './fixtures/stash.ts';

describe('parseRateLimitHeader', () => {
  it('reads a single policy', () => {
    expect(parseRateLimitHeader('45:60:120')).toEqual([
      { hits: 45, periodSeconds: 60, restrictedSeconds: 120 },
    ]);
  });

  it('reads several policies at once', () => {
    expect(parseRateLimitHeader('45:60:120,180:3600:3600')).toEqual([
      { hits: 45, periodSeconds: 60, restrictedSeconds: 120 },
      { hits: 180, periodSeconds: 3600, restrictedSeconds: 3600 },
    ]);
  });

  it('drops malformed chunks instead of guessing at them', () => {
    expect(parseRateLimitHeader('45:60,nonsense,10:60:0')).toEqual([
      { hits: 10, periodSeconds: 60, restrictedSeconds: 0 },
    ]);
  });

  it('rejects a zero period, which would make the pacing divide by zero', () => {
    expect(parseRateLimitHeader('10:0:0')).toEqual([]);
  });

  it('treats an absent header as no knowledge', () => {
    expect(parseRateLimitHeader(null)).toEqual([]);
    expect(parseRateLimitHeader('')).toEqual([]);
  });
});

describe('parseRetryAfter', () => {
  it('reads seconds', () => {
    expect(parseRetryAfter('30', 0)).toBe(30_000);
  });

  it('reads an HTTP date', () => {
    const now = Date.parse('2026-01-01T00:00:00Z');
    expect(parseRetryAfter('Thu, 01 Jan 2026 00:01:00 GMT', now)).toBe(60_000);
  });

  it('never returns a negative wait for a date in the past', () => {
    const now = Date.parse('2026-01-01T00:05:00Z');
    expect(parseRetryAfter('Thu, 01 Jan 2026 00:00:00 GMT', now)).toBe(0);
  });

  it('falls back to zero when the header is missing or junk', () => {
    expect(parseRetryAfter(null, 0)).toBe(0);
    expect(parseRetryAfter('soon', 0)).toBe(0);
  });
});

describe('computeDelayMs', () => {
  const limit = (hits: number, periodSeconds: number) => ({ hits, periodSeconds, restrictedSeconds: 0 });

  it('does not pace a bucket that still has room', () => {
    // 1 of 45 used. Pacing every request at the bucket's average refill rate was what made a
    // twenty-tab stash take six minutes with the allowance barely touched — the budget is there
    // to be spent, and this is the half of it that is free.
    expect(computeDelayMs([limit(45, 60)], [{ hits: 1, periodSeconds: 60, restrictedSeconds: 0 }])).toBe(
      0,
    );
  });

  it('starts pacing once a bucket is past its reserve', () => {
    // 30 of 45 used: a third of the bucket left, so a third of the way past the reserve.
    const delay = computeDelayMs([limit(45, 60)], [{ hits: 30, periodSeconds: 60, restrictedSeconds: 0 }]);
    expect(delay).toBeGreaterThan(0);
    expect(delay).toBeLessThan(1334);
  });

  it('reaches the full refill rate as the bucket empties', () => {
    // 44 of 45 used. One request left, and the pace has ramped to the bucket's own average —
    // the approach to a cap is a slowdown, not a wall.
    const delay = computeDelayMs([limit(45, 60)], [{ hits: 44, periodSeconds: 60, restrictedSeconds: 0 }]);
    expect(delay).toBeGreaterThan(1200);
    expect(delay).toBeLessThanOrEqual(1334);
  });

  it('ramps monotonically as a bucket fills', () => {
    const at = (used: number) =>
      computeDelayMs([limit(45, 60)], [{ hits: used, periodSeconds: 60, restrictedSeconds: 0 }]);
    const curve = [0, 10, 22, 30, 38, 44].map(at);
    for (let i = 1; i < curve.length; i += 1) {
      expect(curve[i]).toBeGreaterThanOrEqual(curve[i - 1] as number);
    }
  });

  it('follows the tightest of several buckets', () => {
    // The small bucket is 8 of 10 gone while the large one is untouched. The answer has to come
    // from the small one — a spare hourly allowance is no reason to empty a per-minute cap.
    const delay = computeDelayMs(
      [limit(45, 60), limit(10, 60)],
      [
        { hits: 1, periodSeconds: 60, restrictedSeconds: 0 },
        { hits: 8, periodSeconds: 60, restrictedSeconds: 0 },
      ],
    );
    expect(delay).toBeGreaterThan(3000);
    expect(delay).toBeLessThanOrEqual(6000);
  });

  it('lets a long bucket with room stop dictating the pace', () => {
    // The regression this change exists to fix. GGG's hourly policy averages to one request
    // every eighteen seconds; with 17 of 200 spent there is no reason to crawl at it.
    const delay = computeDelayMs(
      [limit(45, 60), limit(200, 3600)],
      [
        { hits: 2, periodSeconds: 60, restrictedSeconds: 0 },
        { hits: 17, periodSeconds: 3600, restrictedSeconds: 0 },
      ],
    );
    expect(delay).toBe(0);
  });

  it('waits a whole period once a bucket is spent', () => {
    const delay = computeDelayMs(
      [limit(45, 60)],
      [{ hits: 45, periodSeconds: 60, restrictedSeconds: 0 }],
    );
    expect(delay).toBe(60_000);
  });

  it('honours an active restriction above everything else', () => {
    const delay = computeDelayMs(
      [limit(45, 60)],
      [{ hits: 46, periodSeconds: 60, restrictedSeconds: 300 }],
    );
    expect(delay).toBe(300_000);
  });

  it('applies the minimum interval when nothing is known yet', () => {
    expect(computeDelayMs([], [], { minIntervalMs: 1000 })).toBe(1000);
  });
});

/** A limiter whose clock and sleeps are fake, so a 30-minute backoff costs nothing to test. */
function testLimiter(
  fetchFn: typeof fetch,
  options: { maxRetries?: number; minBackoffMs?: number } = {},
) {
  let now = 0;
  const sleeps: number[] = [];
  const limiter = new RateLimiter({
    fetchFn,
    now: () => now,
    sleep: async (ms) => {
      sleeps.push(ms);
      now += ms;
    },
    minIntervalMs: 1000,
    ...options,
  });
  return { limiter, sleeps, advance: (ms: number) => (now += ms), nowRef: () => now };
}

describe('RateLimiter', () => {
  it('stays at the minimum interval while the bucket has room', async () => {
    // 2 of 45 used. The floor between requests still applies — being allowed to spend the
    // budget is not a reason to fire as fast as the socket will go — but the bucket itself adds
    // nothing on top of it.
    const fetchFn = vi.fn(async () =>
      stashResponse({ ok: true }, 200, { limit: '45:60:120', state: '2:60:0' }),
    ) as unknown as typeof fetch;
    const { limiter, sleeps } = testLimiter(fetchFn);

    await limiter.request('https://example.test/a');
    await limiter.request('https://example.test/b');

    expect(sleeps.filter((ms) => ms > 0)).toEqual([1000]);
  });

  it('paces beyond the floor once the headers say the bucket is filling', async () => {
    // 40 of 45 used, so the ramp is well past the reserve and asks for more than the floor.
    const fetchFn = vi.fn(async () =>
      stashResponse({ ok: true }, 200, { limit: '45:60:120', state: '40:60:0' }),
    ) as unknown as typeof fetch;
    const { limiter, sleeps } = testLimiter(fetchFn);

    await limiter.request('https://example.test/a');
    await limiter.request('https://example.test/b');

    const paced = sleeps.filter((ms) => ms > 0);
    expect(paced).toHaveLength(1);
    expect(paced[0]).toBeGreaterThan(1000);
  });

  it('serialises requests instead of firing them in parallel', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const fetchFn = vi.fn(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      return stashResponse({ ok: true }, 200, { limit: '45:60:120', state: '1:60:0' });
    }) as unknown as typeof fetch;
    const { limiter } = testLimiter(fetchFn);

    await Promise.all([
      limiter.request('https://example.test/1'),
      limiter.request('https://example.test/2'),
      limiter.request('https://example.test/3'),
    ]);

    expect(maxInFlight).toBe(1);
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it('keeps serialising after a request rejects', async () => {
    let call = 0;
    const fetchFn = vi.fn(async () => {
      call += 1;
      if (call === 1) throw new Error('socket hang up');
      return stashResponse({ ok: true });
    }) as unknown as typeof fetch;
    const { limiter } = testLimiter(fetchFn);

    await expect(limiter.request('https://example.test/1')).rejects.toThrow('socket hang up');
    await expect(limiter.request('https://example.test/2')).resolves.toBeDefined();
  });

  it('honours Retry-After on a 429 and then succeeds', async () => {
    let call = 0;
    const fetchFn = vi.fn(async () => {
      call += 1;
      if (call === 1) return stashResponse({ error: 'slow down' }, 429, { retryAfter: '17' });
      return stashResponse({ ok: true }, 200, { limit: '45:60:120', state: '1:60:0' });
    }) as unknown as typeof fetch;
    const { limiter, sleeps } = testLimiter(fetchFn, { minBackoffMs: 1 });

    const response = await limiter.request('https://example.test/a');

    expect(response.status).toBe(200);
    expect(sleeps).toContain(17_000);
  });

  it('doubles the wait on each consecutive 429, capped at thirty minutes', async () => {
    const fetchFn = vi.fn(async () =>
      stashResponse({ error: 'slow down' }, 429, { retryAfter: '600' }),
    ) as unknown as typeof fetch;
    const { limiter, sleeps } = testLimiter(fetchFn, { maxRetries: 4 });

    await expect(limiter.request('https://example.test/a')).rejects.toBeInstanceOf(RateLimitError);

    // 600s, then 1200s, then the 30-minute ceiling holds.
    expect(sleeps.filter((ms) => ms >= 600_000)).toEqual([600_000, 1_200_000, 1_800_000, 1_800_000]);
  });

  it('gives up with a RateLimitError rather than hammering', async () => {
    const fetchFn = vi.fn(async () => stashResponse({}, 429, { retryAfter: '1' })) as unknown as typeof fetch;
    const { limiter } = testLimiter(fetchFn, { maxRetries: 2, minBackoffMs: 1 });

    await expect(limiter.request('https://example.test/a')).rejects.toThrow(/429/);
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it('waits out a restriction announced in the state header', async () => {
    let call = 0;
    const fetchFn = vi.fn(async () => {
      call += 1;
      if (call === 1) {
        return stashResponse({ ok: true }, 200, { limit: '45:60:120', state: '46:60:120' });
      }
      return stashResponse({ ok: true }, 200, { limit: '45:60:120', state: '1:60:0' });
    }) as unknown as typeof fetch;
    const { limiter, sleeps } = testLimiter(fetchFn);

    await limiter.request('https://example.test/a');
    await limiter.request('https://example.test/b');

    expect(Math.max(...sleeps)).toBe(120_000);
  });

  it('reports its state for /api/health', async () => {
    const fetchFn = vi.fn(async () =>
      stashResponse({ ok: true }, 200, { limit: '45:60:120', state: '7:60:0' }),
    ) as unknown as typeof fetch;
    const { limiter } = testLimiter(fetchFn);

    await limiter.request('https://example.test/a');
    const view = limiter.view();

    expect(view.buckets).toHaveLength(1);
    expect(view.buckets[0]?.remaining).toBe(38);
    expect(view.totalRequests).toBe(1);
    expect(view.total429).toBe(0);
    expect(view.restrictedUntil).toBeNull();
  });

  it('resets the 429 counter once a request succeeds', async () => {
    let call = 0;
    const fetchFn = vi.fn(async () => {
      call += 1;
      if (call === 1) return stashResponse({}, 429, { retryAfter: '1' });
      return stashResponse({ ok: true });
    }) as unknown as typeof fetch;
    const { limiter } = testLimiter(fetchFn, { minBackoffMs: 1 });

    await limiter.request('https://example.test/a');
    expect(limiter.view().consecutive429).toBe(0);
  });
});

describe('the floor, and how long it applies', () => {
  const POLICY = '45:60:120,200:3600:3600';

  /** Reads `tabs` requests through the limiter on a fake clock; returns the elapsed time. */
  async function readTabs(tabs: number, minIntervalMs = 0): Promise<number> {
    let now = 0;
    let used = 0;
    const fetchFn = (async () => {
      now += 100;
      used += 1;
      return new Response('{}', {
        status: 200,
        headers: {
          'x-rate-limit-account': POLICY,
          'x-rate-limit-account-state': `${Math.min(used, 45)}:60:0,${used}:3600:0`,
        },
      });
    }) as unknown as typeof fetch;

    const limiter = new RateLimiter({
      now: () => now,
      sleep: async (ms: number) => {
        now += ms;
      },
      fetchFn,
      minIntervalMs,
    });

    for (let i = 0; i < tabs; i += 1) await limiter.request('https://example.test/stash');
    return now;
  }

  it('spends the allowance GGG actually grants instead of one request a second', async () => {
    // The regression this exists for: a permanent one-second floor made a twenty-four-tab stash
    // take twenty-six seconds against a policy that allows forty-five requests a minute. The
    // bucket was barely touched the whole time.
    const elapsed = await readTabs(24);

    expect(elapsed).toBeLessThan(5_000);
  });

  it('still throttles when somebody asks it to', async () => {
    // The floor is off by default and stays available: behind a proxy with limits of its own,
    // "one a second whatever the headers say" is a thing an operator may want.
    expect(await readTabs(6, 1000)).toBeGreaterThanOrEqual(5_000);
  });

  it('slows down again as the bucket empties, rather than running into the cap', async () => {
    // Past the reserve the pacing ramps toward the refill rate. Forty tabs is more than half of
    // forty-five, so the tail of it is paced and the whole read takes real time.
    const elapsed = await readTabs(40);

    expect(elapsed).toBeGreaterThan(10_000);
    expect(elapsed).toBeLessThan(30_000);
  });
});
