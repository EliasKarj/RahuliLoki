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
  /** GGG's artwork for this item. Absent until a poll has seen one. */
  icon?: string;
  /**
   * poe.ninja's category — `Currency`, `Scarab`, `DivinationCard`.
   *
   * Absent when nothing priced this item, which is why the filter files those under "Other"
   * rather than putting them somewhere they do not belong.
   */
  category?: string;
}

export interface LatestResponse {
  snapshot: SnapshotMeta & { breakdown: Breakdown };
  tabs: Record<string, number>;
  topItems: TopItem[];
}

export interface ItemChange {
  name: string;
  qtyBefore: number;
  qtyAfter: number;
  qtyDelta: number;
  chaosBefore: number;
  chaosAfter: number;
  chaosDelta: number;
  chaosEachBefore: number;
  chaosEachAfter: number;
  reason: 'quantity' | 'price' | 'both';
  icon?: string;
}

export interface ChangesResponse {
  league: string;
  from: string | null;
  to: string | null;
  changes: ItemChange[];
  gainedChaos: number;
  lostChaos: number;
  netChaos: number;
  /** Present only when there was nothing to diff. */
  reason?: string;
}

export interface ItemHistoryPoint {
  takenAt: string;
  qty: number;
  chaosEach: number;
  chaosTotal: number;
}

export interface ItemHistoryResponse {
  league: string;
  name: string;
  icon?: string;
  points: ItemHistoryPoint[];
}

export interface League {
  id: string;
  hardcore: boolean;
  ssf: boolean;
  ruthless: boolean;
  endAt: string | null;
}

export interface LeagueListResponse {
  leagues: League[];
  /** 'fallback' means GGG could not be reached and these are the permanent leagues. */
  source: 'ggg' | 'fallback';
  fetchedAt: string;
}

/** What GGG says about the stored session. See the server's /api/account. */
export interface AccountResponse {
  /** The account name GGG itself reports, discriminator included. */
  name: string;
  /** What POE_ACCOUNT_NAME is currently set to, or null when it is unset. */
  configured: string | null;
  matches: boolean;
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
  authRequired: boolean;
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
  /** The automatic schedule, so the page can count down to the next poll. */
  schedule: {
    /** The cron expression the scheduler is running on. */
    cron: string;
    /** When it next fires *and polls*, or null when nothing is scheduled. */
    nextRunAt: string | null;
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
  prices: {
    fetchedAt: string | null;
    entries: number;
    divineRate: number;
    stale: boolean;
    /** GGG's art for the two orbs everything is quoted in. Null until the first price set. */
    chaosIcon: string | null;
    divineIcon: string | null;
  };
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

/**
 * The API token, when the server is running with one.
 *
 * sessionStorage rather than localStorage: it dies with the tab. This dashboard gets opened on
 * whatever machine is to hand, and a token that outlives the session is a credential left
 * behind on a shared computer.
 *
 * It travels in an `Authorization` header, never in a query string (which lands in proxy logs
 * and browser history) and never in a cookie (which the browser would attach to a cross-site
 * request automatically, re-opening the CSRF hole the server's origin check exists to close).
 */
const TOKEN_KEY = 'valuuttaloki.token';

let token: string | null = readStoredToken();

function readStoredToken(): string | null {
  try {
    return window.sessionStorage.getItem(TOKEN_KEY);
  } catch {
    // Private mode, or storage disabled. The app still works; it just asks again on reload.
    return null;
  }
}

export function setToken(value: string | null): void {
  token = value === null || value.trim() === '' ? null : value.trim();
  try {
    if (token === null) window.sessionStorage.removeItem(TOKEN_KEY);
    else window.sessionStorage.setItem(TOKEN_KEY, token);
  } catch {
    // Keep the in-memory copy: this session works even when nothing can be persisted.
  }
}

export function hasToken(): boolean {
  return token !== null;
}

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    accept: 'application/json',
    ...(token === null ? {} : { authorization: `Bearer ${token}` }),
    ...extra,
  };
}

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, { signal: signal ?? null, headers: authHeaders() });
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

  changes: (range: RangeQuery, signal?: AbortSignal) =>
    get<ChangesResponse>(`/api/changes${query(range)}`, signal),

  itemHistory: (name: string, range: RangeQuery, signal?: AbortSignal) =>
    get<ItemHistoryResponse>(`/api/item-history${query({ ...range, name })}`, signal),

  latest: (league: string | undefined, signal?: AbortSignal) =>
    get<LatestResponse>(`/api/snapshots/latest${query({ league })}`, signal),

  config: (signal?: AbortSignal) => get<ConfigResponse>('/api/config', signal),

  leagueList: (signal?: AbortSignal) => get<LeagueListResponse>('/api/leagues', signal),

  account: (signal?: AbortSignal) => get<AccountResponse>('/api/account', signal),

  health: (signal?: AbortSignal) => get<HealthResponse>('/api/health', signal),

  /**
   * Ask for a poll. Resolves once the server has *started* one, not once it has finished.
   *
   * The server answers 202 immediately, because a poll paces itself against GGG's rate limit and
   * runs for minutes on a large stash. Watch `health.poller.running` for the rest — waiting on
   * this request instead is what produced "Failed to fetch" over a poll that was running fine.
   */
  poll: async (): Promise<{ ok: boolean; error?: string }> => {
    const response = await fetch('/api/poll', { method: 'POST', headers: authHeaders() });
    const body = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    if (!response.ok) throw new ApiError(body?.error ?? `poll failed with HTTP ${response.status}`, response.status);
    return { ok: true, ...(body?.error !== undefined ? { error: body.error } : {}) };
  },
};
