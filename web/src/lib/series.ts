/**
 * Chart-shaping helpers.
 *
 * All the statistics — idle intervals, spike annotations, chaos-per-hour — are computed on the
 * server and arrive with /api/stats. This file only reshapes what came back into the row
 * arrays Recharts wants, which keeps one implementation of the rules rather than two that
 * drift apart.
 */

import type { SeriesInterval, SnapshotWithTabs } from './api.ts';

export type RangeKey = '24h' | '7d' | 'league';

export const RANGES: Array<{ key: RangeKey; label: string; hours: number | null }> = [
  { key: '24h', label: '24 h', hours: 24 },
  { key: '7d', label: '7 d', hours: 24 * 7 },
  { key: 'league', label: 'League', hours: null },
];

/** The `from` query parameter for a range, or undefined for the whole league. */
export function rangeStart(range: RangeKey, now: number = Date.now()): string | undefined {
  const hours = RANGES.find((entry) => entry.key === range)?.hours ?? null;
  return hours === null ? undefined : new Date(now - hours * 3_600_000).toISOString();
}

export interface NetWorthRow {
  t: number;
  takenAt: string;
  chaos: number;
  divine: number;
  divineRate: number;
  itemCount: number;
}

export function netWorthRows(snapshots: SnapshotWithTabs[]): NetWorthRow[] {
  return snapshots.map((snapshot) => ({
    t: new Date(snapshot.takenAt).getTime(),
    takenAt: snapshot.takenAt,
    chaos: snapshot.totalChaos,
    divine: snapshot.totalDivine,
    divineRate: snapshot.divineRate,
    itemCount: snapshot.itemCount,
  }));
}

export interface AnnotationPoint {
  t: number;
  chaos: number;
  deltaChaos: number;
  at: string;
}

/**
 * Spike markers for the net-worth chart, positioned on the snapshot that ended the interval.
 * An annotation with no matching snapshot in the current range is dropped rather than pinned
 * to the edge of the chart, where it would point at the wrong moment.
 */
export function annotationPoints(
  intervals: SeriesInterval[],
  rows: NetWorthRow[],
): AnnotationPoint[] {
  const byTime = new Map(rows.map((row) => [row.takenAt, row]));
  const points: AnnotationPoint[] = [];

  for (const interval of intervals) {
    if (!interval.annotated) continue;
    const row = byTime.get(interval.to);
    if (!row) continue;
    points.push({ t: row.t, chaos: row.chaos, deltaChaos: interval.deltaChaos, at: interval.to });
  }
  return points;
}

export interface RateRow {
  t: number;
  to: string;
  chaosPerHour: number;
  deltaChaos: number;
  hours: number;
  idle: boolean;
  annotated: boolean;
}

export function rateRows(intervals: SeriesInterval[]): RateRow[] {
  return intervals.map((interval) => ({
    t: new Date(interval.to).getTime(),
    to: interval.to,
    chaosPerHour: interval.chaosPerHour,
    deltaChaos: interval.deltaChaos,
    hours: interval.hours,
    idle: interval.idle,
    annotated: interval.annotated,
  }));
}

/** Tab names ordered by their latest value — the biggest holding sits at the bottom of the stack. */
export function tabNames(snapshots: SnapshotWithTabs[]): string[] {
  const latest = snapshots[snapshots.length - 1]?.tabs ?? {};
  const seen = new Set<string>();
  for (const snapshot of snapshots) {
    for (const name of Object.keys(snapshot.tabs)) seen.add(name);
  }
  return [...seen].sort((a, b) => (latest[b] ?? 0) - (latest[a] ?? 0) || a.localeCompare(b));
}

export type TabRow = { t: number; takenAt: string } & Record<string, number | string>;

/**
 * One row per snapshot with a column per tab. A tab absent from a snapshot becomes 0 rather
 * than a hole: a stacked area with gaps in it reads as wealth disappearing.
 */
export function tabRows(snapshots: SnapshotWithTabs[], names: string[]): TabRow[] {
  return snapshots.map((snapshot) => {
    const row: TabRow = { t: new Date(snapshot.takenAt).getTime(), takenAt: snapshot.takenAt };
    for (const name of names) row[name] = snapshot.tabs[name] ?? 0;
    return row;
  });
}

export type SortKey = 'name' | 'tab' | 'qty' | 'chaosEach' | 'chaosTotal';
export type SortDirection = 'asc' | 'desc';

/** Stable sort for the holdings table. Strings compare alphabetically, numbers numerically. */
export function sortRows<T>(rows: T[], key: keyof T & string, direction: SortDirection): T[] {
  const sign = direction === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const left = a[key];
    const right = b[key];
    if (typeof left === 'number' && typeof right === 'number') return (left - right) * sign;
    return String(left).localeCompare(String(right)) * sign;
  });
}
