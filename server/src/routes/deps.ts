/** What the route plugins need. Narrow interfaces so tests can hand them plain objects. */

import type { AppConfig } from '../lib/config.ts';
import type { RateLimitView } from '../lib/rateLimiter.ts';
import type { PriceSet } from '../services/priceService.ts';
import type { SnapshotStore } from '../services/snapshotRepo.ts';
import type { PollerHealth, PollOutcome } from '../jobs/pollJob.ts';
import type { LeagueList } from '../services/leagueService.ts';
import type { Profile } from '../services/profileService.ts';

export interface PollerLike {
  readonly health: PollerHealth;
  runNow(): Promise<PollOutcome>;
}

export interface PriceStateLike {
  readonly cached: PriceSet | null;
  isStale(): boolean;
}

export interface ApiDeps {
  config: AppConfig;
  /** Required settings that are absent. Empty means the poller can run. */
  missing: string[];
  store: SnapshotStore;
  poller: PollerLike;
  prices: PriceStateLike;
  rateLimit: () => RateLimitView;
  startedAt: Date;
  /** The league list for the setup dropdown. Cached and failure-tolerant — see leagueService. */
  leagues: () => Promise<LeagueList>;
  /**
   * Who GGG says the stored session belongs to. Rejects when GGG will not say, which is itself
   * the answer — see services/profileService.ts.
   */
  profile: () => Promise<Profile>;
}
