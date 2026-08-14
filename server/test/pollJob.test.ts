import { describe, expect, it, vi } from 'vitest';
import { PollRunner, PollerBusyError, PollerHaltedError, runPoll } from '../src/jobs/pollJob.ts';
import { RateLimiter } from '../src/lib/rateLimiter.ts';
import { PriceService, type PriceSetStore } from '../src/services/priceService.ts';
import { StashService } from '../src/services/stashService.ts';
import { MemorySnapshotStore } from './helpers/memoryStore.ts';
import {
  currencyOverview,
  divinationCardOverview,
  emptyOverview,
  fragmentOverview,
  jsonResponse,
  scarabOverview,
} from './fixtures/poeninja.ts';
import { dumpTabResponse, mapTabResponse, stashResponse, tabListResponse } from './fixtures/stash.ts';

const HEADERS = { limit: '45:60:120', state: '1:60:0' };

const priceStore: PriceSetStore = { latest: async () => null, save: async () => {} };

/** One fetch that answers both poe.ninja and GGG, so a poll can be driven end to end. */
function worldFetch(overrides: { stash?: Record<string, () => Response>; ninjaDown?: boolean } = {}) {
  return vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input));

    if (url.hostname.includes('poe.ninja')) {
      if (overrides.ninjaDown) return jsonResponse({}, 503);
      switch (url.searchParams.get('type')) {
        case 'Currency':
          return jsonResponse(currencyOverview);
        case 'Fragment':
          return jsonResponse(fragmentOverview);
        case 'DivinationCard':
          return jsonResponse(divinationCardOverview);
        case 'Scarab':
          return jsonResponse(scarabOverview);
        default:
          return jsonResponse(emptyOverview);
      }
    }

    const index = url.searchParams.get('tabIndex') ?? '0';
    const withTabs = url.searchParams.get('tabs') === '1';
    const key = withTabs ? 'list' : index;
    const override = overrides.stash?.[key];
    if (override) return override();
    if (withTabs) return stashResponse(tabListResponse, 200, HEADERS);
    if (index === '1') return stashResponse(dumpTabResponse, 200, HEADERS);
    if (index === '2') return stashResponse(mapTabResponse, 200, HEADERS);
    return stashResponse({ items: [] }, 200, HEADERS);
  }) as unknown as typeof fetch;
}

function world(overrides: Parameters<typeof worldFetch>[0] = {}) {
  const fetchFn = worldFetch(overrides);
  const limiter = new RateLimiter({ fetchFn, now: () => 0, sleep: async () => {}, minIntervalMs: 0 });
  const store = new MemorySnapshotStore();

  return {
    fetchFn,
    store,
    deps: {
      league: 'Settlers',
      minItemChaos: 2,
      store,
      prices: new PriceService({
        league: 'Settlers',
        currencyCategories: ['Currency', 'Fragment'],
        itemCategories: ['DivinationCard', 'Scarab'],
        ttlMs: 3_600_000,
        store: priceStore,
        fetchFn,
        now: () => 0,
      }),
      stash: new StashService({
        accountName: 'Exile#1234',
        league: 'Settlers',
        poesessid: 'x'.repeat(32),
        userAgent: 'valuuttaloki/test',
        limiter,
      }),
      now: () => Date.parse('2026-01-01T00:00:00Z'),
    },
  };
}

describe('runPoll', () => {
  it('writes exactly one snapshot for a successful poll', async () => {
    const { deps, store } = world();
    const outcome = await runPoll(deps);

    expect(store.rows).toHaveLength(1);
    expect(outcome.snapshot.id).toBe(1);
    expect(outcome.tabsRead).toBe(3);
  });

  it('values the whole stash in chaos and divine', async () => {
    const { deps } = world();
    const { snapshot } = await runPoll(deps);

    expect(snapshot.totalChaos).toBeGreaterThan(0);
    expect(snapshot.divineRate).toBe(218.4);
    expect(snapshot.totalDivine).toBeCloseTo(snapshot.totalChaos / 218.4, 2);
  });

  it('records when the prices were fetched, not just when the poll ran', async () => {
    const { deps, store } = world();
    await runPoll(deps);

    expect(store.rows[0]?.priceSetAt.getTime()).toBe(0);
    expect(store.rows[0]?.takenAt.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('stores the per-tab breakdown for later re-slicing', async () => {
    const { deps, store } = world();
    await runPoll(deps);

    expect(Object.keys(store.rows[0]?.breakdown ?? {})).toEqual(['Currency', 'Dump', 'Maps']);
    expect(store.rows[0]?.breakdown.Currency?.['Chaos Orb']?.qty).toBe(250);
  });

  it('reports unresolved names in the outcome', async () => {
    // Two, with the default categories: the made-up fossil, and the Headhunter — uniques are
    // not among the categories fetched by default, so it genuinely has no price here.
    const { deps } = world();
    expect((await runPoll(deps)).unresolvedCount).toBe(2);
  });

  it('counts gems and maps as skipped rather than as pricing gaps', async () => {
    const { deps } = world();
    const outcome = await runPoll(deps);
    expect(outcome.skipped).toBe(2);
  });

  it('writes nothing at all when one tab fails mid-poll', async () => {
    const { deps, store } = world({ stash: { '1': () => stashResponse({}, 500, HEADERS) } });

    await expect(runPoll(deps)).rejects.toThrow(/HTTP 500/);
    expect(store.rows).toHaveLength(0);
  });

  it('writes nothing when poe.ninja is unreachable and nothing is cached', async () => {
    const { deps, store } = world({ ninjaDown: true });

    await expect(runPoll(deps)).rejects.toThrow();
    expect(store.rows).toHaveLength(0);
  });
});

describe('PollRunner', () => {
  interface RunnerOptions {
    overrides?: Parameters<typeof worldFetch>[0];
    maxConsecutiveFailures?: number;
  }

  function runner(options: RunnerOptions = {}) {
    const built = world(options.overrides);
    let now = 0;
    const poller = new PollRunner({
      ...built.deps,
      now: () => now,
      baseBackoffMs: 60_000,
      ...(options.maxConsecutiveFailures !== undefined
        ? { maxConsecutiveFailures: options.maxConsecutiveFailures }
        : {}),
    });
    return { poller, store: built.store, advance: (ms: number) => (now += ms) };
  }

  it('reports a successful poll in its health', async () => {
    const { poller } = runner();
    await poller.runNow();

    expect(poller.health).toMatchObject({
      halted: false,
      consecutiveFailures: 0,
      totalPolls: 1,
      totalFailures: 0,
    });
    expect(poller.health.lastSuccessAt).not.toBeNull();
  });

  it('backs off after a failure instead of retrying on the next tick', async () => {
    const { poller, advance } = runner({
      overrides: { stash: { list: () => stashResponse({}, 500) } },
    });

    await expect(poller.runNow()).rejects.toThrow();
    expect((await poller.tick()).reason).toBe('backing off after a failed poll');

    advance(60_001);
    expect((await poller.tick()).ran).toBe(false); // still failing, but it did try again
    expect(poller.health.consecutiveFailures).toBe(2);
  });

  it('doubles the backoff on each consecutive failure', async () => {
    const { poller, advance } = runner({
      overrides: { stash: { list: () => stashResponse({}, 500) } },
    });

    await expect(poller.runNow()).rejects.toThrow();
    const first = Date.parse(poller.health.nextAttemptAfter as string);

    advance(60_001);
    await poller.tick();
    const second = Date.parse(poller.health.nextAttemptAfter as string);

    expect(second - 60_001).toBeGreaterThan(first);
  });

  it('halts after three consecutive failures rather than hammering GGG', async () => {
    const { poller, advance } = runner({
      overrides: { stash: { list: () => stashResponse({}, 500) } },
    });

    await expect(poller.runNow()).rejects.toThrow();
    advance(120_000);
    await poller.tick();
    advance(300_000);
    await poller.tick();

    expect(poller.health.halted).toBe(true);
    expect(poller.health.haltReason).toMatch(/halted after 3 consecutive failed polls/);
  });

  it('stops trying entirely once halted', async () => {
    const { poller, advance } = runner({
      overrides: { stash: { list: () => stashResponse({}, 500) } },
      maxConsecutiveFailures: 1,
    });

    await expect(poller.runNow()).rejects.toThrow();
    advance(3_600_000);
    const result = await poller.tick();

    expect(result.ran).toBe(false);
    expect(result.reason).toMatch(/halted/);
    expect(poller.health.totalPolls).toBe(1);
  });

  it('lets a manual poll clear the halt, because a human is now looking at it', async () => {
    let broken = true;
    const built = world({ stash: { list: () => (broken ? stashResponse({}, 500) : stashResponse(tabListResponse, 200, HEADERS)) } });
    const poller = new PollRunner({ ...built.deps, maxConsecutiveFailures: 1 });

    await expect(poller.runNow()).rejects.toThrow();
    expect(poller.health.halted).toBe(true);

    broken = false;
    await poller.runNow();

    expect(poller.health.halted).toBe(false);
    expect(poller.health.consecutiveFailures).toBe(0);
  });

  it('refuses to start a second poll while one is running', async () => {
    const gate = Promise.withResolvers<void>();
    const built = world({
      stash: {
        list: () => {
          throw new Error('unused');
        },
      },
    });
    const slow = {
      ...built.deps,
      stash: {
        fetchTrackedTabs: async () => {
          await gate.promise;
          return [];
        },
      } as unknown as (typeof built.deps)['stash'],
    };
    const poller = new PollRunner(slow);

    const first = poller.runNow();
    await expect(poller.runNow()).rejects.toBeInstanceOf(PollerBusyError);
    gate.resolve();
    await first;
  });

  it('never throws out of a scheduled tick, which would take cron down with it', async () => {
    const { poller } = runner({ overrides: { stash: { list: () => stashResponse({}, 500) } } });
    await expect(poller.tick()).resolves.toMatchObject({ ran: false });
  });

  it('skips scheduled polls when the credentials are missing', async () => {
    const built = world();
    const poller = new PollRunner({ ...built.deps, disabledReason: 'polling disabled: POESESSID not set' });

    expect((await poller.tick()).reason).toMatch(/POESESSID/);
    await expect(poller.runNow()).rejects.toBeInstanceOf(PollerHaltedError);
    expect(built.store.rows).toHaveLength(0);
  });
});
