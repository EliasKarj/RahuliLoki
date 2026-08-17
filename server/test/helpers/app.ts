/**
 * A built app around fake dependencies, shared by the route tests and the auth tests.
 *
 * Lives in helpers/ rather than in one of the test files so importing it does not re-register
 * that file's `describe` blocks in whatever imported it.
 */

import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.ts';
import { loadConfig } from '../../src/lib/config.ts';
import type { PollOutcome, PollerHealth } from '../../src/jobs/pollJob.ts';
import type { ApiDeps, PollerLike } from '../../src/routes/deps.ts';
import type { RateLimitView } from '../../src/lib/rateLimiter.ts';
import { MemorySnapshotStore } from './memoryStore.ts';

export const SESSION = 'deadbeef'.repeat(4);
export const START = Date.parse('2026-01-01T00:00:00Z');

export const idleHealth: PollerHealth = {
  running: false,
  halted: false,
  haltReason: null,
  disabledReason: null,
  consecutiveFailures: 0,
  lastSuccessAt: '2026-01-01T02:00:00.000Z',
  lastAttemptAt: '2026-01-01T02:00:00.000Z',
  lastError: null,
  nextAttemptAfter: null,
  totalPolls: 12,
  totalFailures: 0,
  lastOutcome: null,
};

export const rateLimitView: RateLimitView = {
  buckets: [
    {
      limit: { hits: 45, periodSeconds: 60, restrictedSeconds: 120 },
      state: { hits: 3, periodSeconds: 60, restrictedSeconds: 0 },
      remaining: 42,
    },
  ],
  observedAt: '2026-01-01T02:00:00.000Z',
  restrictedUntil: null,
  consecutive429: 0,
  nextRequestAt: '2026-01-01T02:00:01.000Z',
  totalRequests: 36,
  total429: 0,
};

export class FakePoller implements PollerLike {
  health: PollerHealth = { ...idleHealth };
  outcome: PollOutcome | Error = new Error('not configured');
  /** Counts calls that actually reached the poller, which is what the auth tests assert on. */
  calls = 0;

  /**
   * Resolves on the next tick rather than immediately, matching the real poller: the route
   * starts a poll and answers without waiting, so a double that settled synchronously would
   * let a test pass that the real thing could not.
   */
  async runNow(): Promise<PollOutcome> {
    this.calls += 1;
    await Promise.resolve();
    if (this.outcome instanceof Error) throw this.outcome;
    return this.outcome;
  }

  /** Drain the started poll, so a test can assert on what it recorded. */
  async settle(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
  }
}

export function seeded(store: MemorySnapshotStore): MemorySnapshotStore {
  store.seed({
    takenAt: new Date(START),
    totalChaos: 1000,
    itemCount: 500,
    breakdown: { Currency: { 'Chaos Orb': { qty: 1000, chaosEach: 1, chaosTotal: 1000 } }, Dump: {} },
  });
  store.seed({
    takenAt: new Date(START + 3_600_000),
    totalChaos: 1600,
    itemCount: 520,
    breakdown: {
      Currency: { 'Chaos Orb': { qty: 1000, chaosEach: 1, chaosTotal: 1000 } },
      Dump: { 'The Doctor': { qty: 1, chaosEach: 600, chaosTotal: 600 } },
    },
  });
  store.seed({ takenAt: new Date(START + 7_200_000), totalChaos: 1600.2, itemCount: 520 });
  store.seed({ league: 'Standard', takenAt: new Date(START), totalChaos: 42 });
  return store;
}

export async function makeApp(
  overrides: Partial<ApiDeps> = {},
  env: NodeJS.ProcessEnv = {},
): Promise<{ app: FastifyInstance; store: MemorySnapshotStore; poller: FakePoller }> {
  const { config, missing } = loadConfig({
    POESESSID: SESSION,
    POE_ACCOUNT_NAME: 'Exile#1234',
    POE_LEAGUE: 'Settlers',
    ...env,
  } as NodeJS.ProcessEnv);

  const store = seeded(new MemorySnapshotStore());
  const poller = new FakePoller();

  const app = await buildApp(
    {
      config,
      missing,
      store,
      poller,
      prices: {
        cached: {
          league: 'Settlers',
          fetchedAt: new Date(START),
          prices: { 'Chaos Orb': 1, 'Divine Orb': 218.4 },
          divineRate: 218.4,
          icons: {
            'The Doctor': 'https://web.poecdn.com/doctor.png',
            'Divine Orb': 'https://web.poecdn.com/divine.png',
          },
          uniques: {},
          categories: {},
        },
        isStale: () => false,
      },
      rateLimit: () => rateLimitView,
      nextPollAt: () => '2026-01-01T02:10:00.000Z',
      leagues: async () => ({
        leagues: [
          { id: 'Settlers', hardcore: false, ssf: false, ruthless: false, endAt: null },
          { id: 'Standard', hardcore: false, ssf: false, ruthless: false, endAt: null },
        ],
        source: 'ggg' as const,
        fetchedAt: new Date(START).toISOString(),
      }),
      profile: async () => ({ name: 'Exile#1234', uuid: 'uuid-1' }),
      startedAt: new Date(START),
      ...overrides,
    },
    { logger: false },
  );

  return { app, store, poller };
}
