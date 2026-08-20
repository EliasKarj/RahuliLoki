/** What the route plugins need. Narrow interfaces so tests can hand them plain objects. */

import type { AppConfig } from '../lib/config.ts';
import type { RateLimitView } from '../lib/rateLimiter.ts';
import type { PricePoint, PriceSet } from '../services/priceService.ts';
import type { SnapshotStore, UniqueStore } from '../services/snapshotRepo.ts';
import type { PollerHealth, PollOutcome } from '../jobs/pollJob.ts';
import type { LeagueList } from '../services/leagueService.ts';
import type { Profile } from '../services/profileService.ts';
import type { UpdateStatus } from '../services/updateService.ts';

export interface PollerLike {
  readonly health: PollerHealth;
  runNow(): Promise<PollOutcome>;
}

export interface PriceStateLike {
  readonly cached: PriceSet | null;
  isStale(): boolean;
}

/** What the economy tab needs beyond the current set: what a price used to be. */
export interface PriceHistoryLike {
  history(league: string, id: string, limit?: number): Promise<PricePoint[]>;
}

export interface ApiDeps {
  config: AppConfig;
  /** Required settings that are absent. Empty means the poller can run. */
  missing: string[];
  store: SnapshotStore;
  poller: PollerLike;
  prices: PriceStateLike;
  /**
   * The stored price sets, for one item's history. Separate from `prices` because that is the
   * live cache and this is the archive — different lifetimes, different failure modes.
   */
  priceHistory: PriceHistoryLike;
  /** The uniques a poll last saw — see services/kingsmarch.ts. */
  uniques: UniqueStore;
  rateLimit: () => RateLimitView;
  startedAt: Date;
  /** The league list for the setup dropdown. Cached and failure-tolerant — see leagueService. */
  leagues: () => Promise<LeagueList>;
  /**
   * Who GGG says the stored session belongs to. Rejects when GGG will not say, which is itself
   * the answer — see services/profileService.ts.
   */
  profile: () => Promise<Profile>;
  /**
   * When the scheduler will next fire, given the poller's current state.
   *
   * Asked of the scheduler rather than reconstructed from the cron expression. Re-deriving it
   * would be a second parser that can disagree with the one actually holding the timer, and a
   * countdown that disagrees with reality is worse than none.
   *
   * Null when nothing is scheduled — no credentials, or a halt that only a person can clear.
   */
  nextPollAt: () => string | null;
  /**
   * Whether a newer release exists, as of the last time anybody asked GitHub.
   *
   * Synchronous on purpose: this hangs off /api/health, which the dashboard polls every minute,
   * and a health endpoint that waits on a third party is a health endpoint that reports the
   * third party's outage as its own. The asking happens elsewhere, on its own daily clock; this
   * only reads the answer.
   */
  update: () => UpdateStatus;
}
