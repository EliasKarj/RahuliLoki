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
  api,
  type ConfigResponse,
  type HealthResponse,
  type LatestResponse,
  type SnapshotWithTabs,
  type StatsResponse,
} from '../lib/api.ts';
import { rangeStart, type RangeKey } from '../lib/series.ts';

export interface Dashboard {
  snapshots: SnapshotWithTabs[];
  stats: StatsResponse | null;
  latest: LatestResponse | null;
  config: ConfigResponse | null;
  health: HealthResponse | null;
}

export interface UseSnapshots extends Dashboard {
  loading: boolean;
  error: string | null;
  refreshedAt: number | null;
  refresh: () => void;
}

const EMPTY: Dashboard = { snapshots: [], stats: null, latest: null, config: null, health: null };

export function useSnapshots(
  league: string | undefined,
  range: RangeKey,
  refreshMs = 60_000,
): UseSnapshots {
  const [data, setData] = useState<Dashboard>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<number | null>(null);
  const [nonce, setNonce] = useState(0);

  // Distinguishes the first load of a league/range from a background refresh of one.
  const loadedKey = useRef<string | null>(null);

  const refresh = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    const key = `${league ?? ''}|${range}`;
    const first = loadedKey.current !== key;
    if (first) setLoading(true);

    const query = { ...(league ? { league } : {}), ...(rangeStart(range) ? { from: rangeStart(range) as string } : {}) };

    const load = async (): Promise<void> => {
      try {
        const [snapshots, stats, config, health] = await Promise.all([
          api.snapshots(query, controller.signal),
          api.stats(query, controller.signal),
          api.config(controller.signal),
          api.health(controller.signal),
        ]);

        // The newest snapshot has no breakdown until the first poll lands; a 404 here is a
        // normal empty state, not a failure worth showing an error banner for.
        const latest = await api.latest(league, controller.signal).catch(() => null);

        if (controller.signal.aborted) return;
        setData({ snapshots: snapshots.snapshots, stats, latest, config, health });
        setError(null);
        setRefreshedAt(Date.now());
        loadedKey.current = key;
      } catch (caught) {
        if (controller.signal.aborted) return;
        setError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };

    void load();
    const timer = window.setInterval(() => void load(), refreshMs);

    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [league, range, refreshMs, nonce]);

  return { ...data, loading, error, refreshedAt, refresh };
}
