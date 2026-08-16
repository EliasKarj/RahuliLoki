/**
 * One poll: prices → tabs → valuation → one row. Plus the state machine around it.
 *
 * The single most important property here is atomicity. If any tracked tab fails to read,
 * nothing is written at all. A snapshot missing one tab is not a slightly worse data point —
 * it is a wealth crash that never happened, and it stays in the chart forever.
 *
 * Failure handling, per the spec:
 *   - a failed poll backs the next attempt off exponentially, so a GGG outage is not hammered;
 *   - three consecutive failures halt the poller outright and log loudly. It stays halted
 *     until somebody looks at it and triggers POST /api/poll by hand.
 */

import { describeError, silentLogger, type Logger } from '../lib/logger.ts';
import { unmatchedIds, type PriceService } from '../services/priceService.ts';
import type { StashService } from '../services/stashService.ts';
import type { SnapshotMeta, SnapshotStore } from '../services/snapshotRepo.ts';
import { valueTabs } from '../services/valuationService.ts';

export interface PollDependencies {
  league: string;
  minItemChaos: number;
  prices: PriceService;
  stash: StashService;
  store: SnapshotStore;
  log?: Logger;
  now?: () => number;
}

export interface PollOutcome {
  snapshot: SnapshotMeta;
  tabsRead: number;
  unresolvedCount: number;
  skipped: number;
  droppedBelowThreshold: number;
  priceAgeMinutes: number;
  durationMs: number;
}

/** Run one poll to completion. Throws — and writes nothing — if any step fails. */
export async function runPoll(deps: PollDependencies): Promise<PollOutcome> {
  const log = deps.log ?? silentLogger;
  const now = deps.now ?? Date.now;
  const startedAt = now();

  const priceSet = await deps.prices.getPrices();
  const tabs = await deps.stash.fetchTrackedTabs();

  const valuation = valueTabs(tabs, {
    prices: priceSet.prices,
    divineRate: priceSet.divineRate,
    minItemChaos: deps.minItemChaos,
    uniques: priceSet.uniques,
  });

  if (valuation.unresolved.length > 0) {
    // Logged in full, every poll. An item nobody can price is a gap in the number, and a gap
    // you cannot see is a gap you will not fix.
    log.warn(
      { count: valuation.unresolved.length, items: valuation.unresolved.slice(0, 25) },
      'items had no poe.ninja price and were counted as zero',
    );
  }

  // The other half of the same problem, and the only way to see it. poe.ninja's payload carries
  // no names, so a currency whose abbreviation is missing from the alias table looks like an id
  // nothing in the stash ever claimed. Reported at debug because most of these are simply items
  // the account does not hold — it is a lead to follow, not a fault.
  const orphans = unmatchedIds(priceSet.prices, valuation.matchedIds);
  if (orphans.length > 0) {
    log.debug(
      { ids: orphans },
      'poe.ninja priced these ids and nothing in the stash matched them; a missing alias in ' +
        'services/ninjaId.ts would look like this',
    );
  }

  const snapshot = await deps.store.create({
    league: deps.league,
    takenAt: new Date(now()),
    totalChaos: valuation.totalChaos,
    totalDivine: valuation.totalDivine,
    divineRate: priceSet.divineRate,
    itemCount: valuation.itemCount,
    breakdown: valuation.breakdown,
    priceSetAt: priceSet.fetchedAt,
  });

  const outcome: PollOutcome = {
    snapshot,
    tabsRead: tabs.length,
    unresolvedCount: valuation.unresolved.length,
    skipped: valuation.skipped,
    droppedBelowThreshold: valuation.droppedBelowThreshold,
    priceAgeMinutes: Math.round((now() - priceSet.fetchedAt.getTime()) / 60_000),
    durationMs: now() - startedAt,
  };

  log.info(
    {
      totalChaos: snapshot.totalChaos,
      totalDivine: snapshot.totalDivine,
      divineRate: snapshot.divineRate,
      itemCount: snapshot.itemCount,
      tabsRead: outcome.tabsRead,
      durationMs: outcome.durationMs,
    },
    'wrote a snapshot',
  );

  return outcome;
}

export interface PollRunnerOptions extends PollDependencies {
  /** Consecutive failures after which the poller stops trying. */
  maxConsecutiveFailures?: number;
  /** First backoff step. Doubles per failure. */
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  /** True when credentials are missing; scheduled polls are skipped with a clear reason. */
  disabledReason?: string | null;
}

export interface PollerHealth {
  running: boolean;
  halted: boolean;
  haltReason: string | null;
  disabledReason: string | null;
  consecutiveFailures: number;
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  lastError: string | null;
  nextAttemptAfter: string | null;
  totalPolls: number;
  totalFailures: number;
  lastOutcome: Omit<PollOutcome, 'snapshot'> | null;
}

export class PollerHaltedError extends Error {}
export class PollerBusyError extends Error {}

/**
 * Owns whether a poll may run right now. The cron tick calls `tick()`; a human calls `runNow()`,
 * which also clears a halt — the operator has looked at it, which is exactly what a halt is for.
 */
export class PollRunner {
  readonly #deps: PollRunnerOptions;
  readonly #log: Logger;
  readonly #now: () => number;
  readonly #maxFailures: number;
  readonly #baseBackoffMs: number;
  readonly #maxBackoffMs: number;

  #running = false;
  #halted = false;
  #haltReason: string | null = null;
  #consecutiveFailures = 0;
  #lastSuccessAt: number | null = null;
  #lastAttemptAt: number | null = null;
  #lastError: string | null = null;
  #nextAttemptAfter = 0;
  #totalPolls = 0;
  #totalFailures = 0;
  #lastOutcome: Omit<PollOutcome, 'snapshot'> | null = null;

  constructor(options: PollRunnerOptions) {
    this.#deps = options;
    this.#log = options.log ?? silentLogger;
    this.#now = options.now ?? Date.now;
    this.#maxFailures = options.maxConsecutiveFailures ?? 3;
    this.#baseBackoffMs = options.baseBackoffMs ?? 60_000;
    this.#maxBackoffMs = options.maxBackoffMs ?? 30 * 60_000;
  }

  get health(): PollerHealth {
    return {
      running: this.#running,
      halted: this.#halted,
      haltReason: this.#haltReason,
      disabledReason: this.#deps.disabledReason ?? null,
      consecutiveFailures: this.#consecutiveFailures,
      lastSuccessAt: this.#lastSuccessAt === null ? null : new Date(this.#lastSuccessAt).toISOString(),
      lastAttemptAt: this.#lastAttemptAt === null ? null : new Date(this.#lastAttemptAt).toISOString(),
      lastError: this.#lastError,
      nextAttemptAfter:
        this.#nextAttemptAfter > this.#now() ? new Date(this.#nextAttemptAfter).toISOString() : null,
      totalPolls: this.#totalPolls,
      totalFailures: this.#totalFailures,
      lastOutcome: this.#lastOutcome,
    };
  }

  /** A scheduled tick. Returns why it did nothing, when it does nothing. */
  async tick(): Promise<{ ran: boolean; reason?: string; outcome?: PollOutcome }> {
    if (this.#deps.disabledReason) return { ran: false, reason: this.#deps.disabledReason };
    if (this.#halted) return { ran: false, reason: this.#haltReason ?? 'poller halted' };
    if (this.#running) return { ran: false, reason: 'previous poll still running' };
    if (this.#now() < this.#nextAttemptAfter) {
      return { ran: false, reason: 'backing off after a failed poll' };
    }

    try {
      const outcome = await this.#run();
      return { ran: true, outcome };
    } catch {
      // #run has already logged and recorded it. A scheduled tick must not throw into cron.
      return { ran: false, reason: this.#lastError ?? 'poll failed' };
    }
  }

  /** A manual POST /api/poll. Clears a halt and ignores the backoff — a human is watching. */
  async runNow(): Promise<PollOutcome> {
    if (this.#deps.disabledReason) throw new PollerHaltedError(this.#deps.disabledReason);
    if (this.#running) throw new PollerBusyError('a poll is already running');
    if (this.#halted) {
      this.#log.info({ previousHaltReason: this.#haltReason }, 'manual poll clearing the halt');
      this.#halted = false;
      this.#haltReason = null;
      this.#consecutiveFailures = 0;
    }
    this.#nextAttemptAfter = 0;
    return this.#run();
  }

  async #run(): Promise<PollOutcome> {
    this.#running = true;
    this.#lastAttemptAt = this.#now();
    this.#totalPolls += 1;

    try {
      const outcome = await runPoll(this.#deps);
      this.#consecutiveFailures = 0;
      this.#lastSuccessAt = this.#now();
      this.#lastError = null;
      this.#nextAttemptAfter = 0;
      const { snapshot: _snapshot, ...rest } = outcome;
      this.#lastOutcome = rest;
      return outcome;
    } catch (error) {
      this.#totalFailures += 1;
      this.#consecutiveFailures += 1;
      this.#lastError = describeError(error).message;

      if (this.#consecutiveFailures >= this.#maxFailures) {
        this.#halted = true;
        this.#haltReason =
          `halted after ${this.#consecutiveFailures} consecutive failed polls: ${this.#lastError}`;
        this.#log.error(
          { err: error, consecutiveFailures: this.#consecutiveFailures },
          'POLLER HALTED — no further polls will run until POST /api/poll is called by hand',
        );
      } else {
        const backoff = Math.min(
          this.#baseBackoffMs * 2 ** (this.#consecutiveFailures - 1),
          this.#maxBackoffMs,
        );
        this.#nextAttemptAfter = this.#now() + backoff;
        this.#log.error(
          {
            err: error,
            consecutiveFailures: this.#consecutiveFailures,
            backoffMs: backoff,
          },
          'poll failed; nothing written',
        );
      }
      throw error;
    } finally {
      this.#running = false;
    }
  }
}
