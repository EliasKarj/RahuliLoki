/**
 * The API surface, typed. Shapes mirror the server's responses exactly; when one changes, the
 * compiler is the thing that notices.
 *
 * Everything is relative to the current origin. In production Fastify serves this bundle, and
 * in development Vite proxies /api — either way there is no host to configure and no CORS.
 */

export interface SnapshotMeta {
  id: number;
  takenAt: string;
  league: string;
  totalChaos: number;
  totalDivine: number;
  divineRate: number;
  itemCount: number;
  priceSetAt: string;
}

export interface ValuedEntry {
  qty: number;
  chaosEach: number;
  chaosTotal: number;
}

export type Breakdown = Record<string, Record<string, ValuedEntry>>;

export interface SnapshotWithTabs extends SnapshotMeta {
  tabs: Record<string, number>;
}

export interface TopItem {
  tab: string;
  name: string;
  qty: number;
  chaosEach: number;
  chaosTotal: number;
}

export interface LatestResponse {
  snapshot: SnapshotMeta & { breakdown: Breakdown };
  tabs: Record<string, number>;
  topItems: TopItem[];
}

export interface SeriesInterval {
  fromId: number;
  toId: number;
  from: string;
  to: string;
  hours: number;
  deltaChaos: number;
  chaosPerHour: number;
  idle: boolean;
  annotated: boolean;
}

export interface StatsResponse {
  league: string;
  count: number;
  firstAt: string | null;
  lastAt: string | null;
  startChaos: number;
  currentChaos: number;
  currentDivine: number;
  divineRate: number;
  totalGainChaos: number;
  wallClockHours: number;
  activeHours: number;
  chaosPerHourWallClock: number;
  chaosPerHourActive: number;
  bestHour: { from: string; to: string; gainChaos: number } | null;
  intervals: SeriesInterval[];
}

export interface ConfigResponse {
  accountName: string;
  league: string;
  pollCron: string;
  minItemChaos: number;
  trackedTabs: string[];
  priceCategories: string[];
  priceTtlMinutes: number;
  configured: boolean;
  missing: string[];
  version: string;
  leagues: string[];
}

export interface HealthResponse {
  status: 'ok' | 'idle' | 'degraded' | 'halted' | 'unconfigured';
  league: string;
  uptimeSeconds: number;
  poller: {
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
  };
  rateLimit: {
    buckets: Array<{
      limit: { hits: number; periodSeconds: number; restrictedSeconds: number };
      state: { hits: number; periodSeconds: number; restrictedSeconds: number } | null;
      remaining: number;
    }>;
    observedAt: string | null;
    restrictedUntil: string | null;
    consecutive429: number;
    totalRequests: number;
    total429: number;
  };
  prices: { fetchedAt: string | null; entries: number; divineRate: number; stale: boolean };
  missing: string[];
}

export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, { signal: signal ?? null, headers: { accept: 'application/json' } });
  if (!response.ok) {
    // The server answers errors as { error }. Fall back to the status when it did not.
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(body?.error ?? `${path} returned HTTP ${response.status}`, response.status);
  }
  return (await response.json()) as T;
}

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const encoded = search.toString();
  return encoded === '' ? '' : `?${encoded}`;
}

/** A type alias rather than an interface: it carries an implicit index signature, which is what
 *  lets it be spread into the query-string builder. */
export type RangeQuery = {
  league?: string;
  from?: string;
};

export const api = {
  snapshots: (range: RangeQuery, signal?: AbortSignal) =>
    get<{ league: string; count: number; snapshots: SnapshotWithTabs[] }>(
      `/api/snapshots${query({ ...range, tabs: 1 })}`,
      signal,
    ),

  stats: (range: RangeQuery, signal?: AbortSignal) =>
    get<StatsResponse>(`/api/stats${query(range)}`, signal),

  latest: (league: string | undefined, signal?: AbortSignal) =>
    get<LatestResponse>(`/api/snapshots/latest${query({ league })}`, signal),

  config: (signal?: AbortSignal) => get<ConfigResponse>('/api/config', signal),

  health: (signal?: AbortSignal) => get<HealthResponse>('/api/health', signal),

  poll: async (): Promise<{ ok: boolean; error?: string }> => {
    const response = await fetch('/api/poll', { method: 'POST' });
    const body = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    if (!response.ok) throw new ApiError(body?.error ?? `poll failed with HTTP ${response.status}`, response.status);
    return { ok: true, ...(body?.error !== undefined ? { error: body.error } : {}) };
  },
};
