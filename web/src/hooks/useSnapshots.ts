/**
 * The app's single data source.
 *
 * One hook fetches everything for the selected league and range, and re-fetches on a timer so
 * a page left open overnight is showing tonight's wealth in the morning rather than a frozen
 * chart. The refresh is quiet: it swaps in new data without flipping the UI back to a loading
 * state, because a chart that blanks itself every minute is unreadable.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ApiError,
  api,
  type ChangesResponse,
  type ConfigResponse,
  type HealthResponse,
  type LatestResponse,
  type SnapshotWithTabs,
  type StatsResponse,
} from '../lib/api.ts';
import { rangeStart, type RangeKey } from '../lib/series.ts';
import { pollStamp, shouldRefetch } from '../lib/refresh.ts';

export interface Dashboard {
  snapshots: SnapshotWithTabs[];
  stats: StatsResponse | null;
  changes: ChangesResponse | null;
  latest: LatestResponse | null;
  config: ConfigResponse | null;
  health: HealthResponse | null;
}

export interface UseSnapshots extends Dashboard {
  loading: boolean;
  error: string | null;
  /** The server wants a token this tab does not have. App renders the gate instead of an error. */
  unauthorized: boolean;
  refreshedAt: number | null;
  refresh: () => void;
}

const EMPTY: Dashboard = {
  snapshots: [],
  stats: null,
  changes: null,
  latest: null,
  config: null,
  health: null,
};

export function useSnapshots(
  league: string | undefined,
  range: RangeKey,
  refreshMs = 60_000,
): UseSnapshots {
  const [data, setData] = useState<Dashboard>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unauthorized, setUnauthorized] = useState(false);
  const [refreshedAt, setRefreshedAt] = useState<number | null>(null);
  const [nonce, setNonce] = useState(0);

  // Distinguishes the first load of a league/range from a background refresh of one.
  const loadedKey = useRef<string | null>(null);
  // Read by the refresh timer, which is created once per effect and must see the current value
  // rather than the one captured when it was scheduled.
  const running = useRef(false);
  /**
   * The poll this view was built from.
   *
   * Snapshots are append-only and one arrives every ten minutes, so a refresh a minute spent
   * most of its life re-downloading a series that had not changed — several megabytes of it on
   * a league's worth of history. `/api/health` answers in a millisecond and says when the last
   * poll succeeded, which is the one thing that can make any of the rest different.
   */
  const builtFrom = useRef<string | null>(null);

  const refresh = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    const key = `${league ?? ''}|${range}`;
    const first = loadedKey.current !== key;
    if (first) setLoading(true);

    const query = { ...(league ? { league } : {}), ...(rangeStart(range) ? { from: rangeStart(range) as string } : {}) };

    /**
     * Refresh, unless nothing has happened since the last one.
     *
     * `force` is for the first load of a league or range, and for the button: those have to
     * fetch whatever health says, because the question being asked has changed rather than the
     * answer. A background tick asks health first and stops there when the last successful poll
     * is the one already on screen — which is the usual case, ten minutes out of every ten.
     */
    const load = async (force: boolean): Promise<void> => {
      try {
        const health = await api.health(controller.signal);
        if (controller.signal.aborted) return;
        running.current = health.poller.running;

        const stamp = pollStamp(health.poller);
        if (!shouldRefetch(force, builtFrom.current, stamp)) {
          // The clock in the status row still moves: health is what it reads.
          setData((held) => ({ ...held, health }));
          setRefreshedAt(Date.now());
          return;
        }

        const [snapshots, stats, changes, config] = await Promise.all([
          api.snapshots(query, controller.signal),
          api.stats(query, controller.signal),
          api.changes(query, controller.signal),
          api.config(controller.signal),
        ]);

        // The newest snapshot has no breakdown until the first poll lands; a 404 here is a
        // normal empty state, not a failure worth showing an error banner for.
        const latest = await api.latest(league, controller.signal).catch(() => null);

        if (controller.signal.aborted) return;
        setData({ snapshots: snapshots.snapshots, stats, changes, latest, config, health });
        setError(null);
        setUnauthorized(false);
        setRefreshedAt(Date.now());
        loadedKey.current = key;
        builtFrom.current = stamp;
      } catch (caught) {
        if (controller.signal.aborted) return;
        // A 401 is not an error to show in a banner over a blank dashboard — it is a request
        // for the token, and App answers it with the gate.
        if (caught instanceof ApiError && caught.status === 401) {
          setUnauthorized(true);
          setError(null);
          return;
        }
        setError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };

    // The first load of this league and range fetches everything, whatever health says.
    void load(true);

    // A self-rescheduling timer rather than setInterval, so the gap can depend on what the last
    // response said. While a poll is running the page refreshes every few seconds; the rest of
    // the time it stays at the slow cadence.
    //
    // A poll paces itself against GGG's rate limit and takes minutes on a full stash. At one
    // refresh a minute the page looks idle for the whole of it, and then sits on a stale view
    // for up to another minute after the snapshot lands.
    let timer = 0;
    const schedule = (): void => {
      timer = window.setTimeout(() => {
        void load(false).finally(schedule);
      }, running.current ? 5_000 : refreshMs);
    };
    schedule();

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [league, range, refreshMs, nonce]);

  return { ...data, loading, error, unauthorized, refreshedAt, refresh };
}
