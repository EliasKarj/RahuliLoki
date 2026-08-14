import { describe, expect, it } from 'vitest';
import type { SeriesInterval, SnapshotWithTabs } from '../src/lib/api.ts';
import {
  annotationPoints,
  netWorthRows,
  rangeStart,
  rateRows,
  sortRows,
  tabNames,
  tabRows,
} from '../src/lib/series.ts';

const START = Date.parse('2026-01-01T00:00:00Z');

function snapshot(minutes: number, totalChaos: number, tabs: Record<string, number>): SnapshotWithTabs {
  return {
    id: minutes,
    takenAt: new Date(START + minutes * 60_000).toISOString(),
    league: 'Settlers',
    totalChaos,
    totalDivine: totalChaos / 200,
    divineRate: 200,
    itemCount: 100,
    priceSetAt: new Date(START).toISOString(),
    tabs,
  };
}

function interval(minutes: number, delta: number, annotated: boolean): SeriesInterval {
  return {
    fromId: minutes - 10,
    toId: minutes,
    from: new Date(START + (minutes - 10) * 60_000).toISOString(),
    to: new Date(START + minutes * 60_000).toISOString(),
    hours: 1 / 6,
    deltaChaos: delta,
    chaosPerHour: delta * 6,
    idle: Math.abs(delta) < 1,
    annotated,
  };
}

describe('rangeStart', () => {
  const now = Date.parse('2026-01-02T00:00:00Z');

  it('reaches back a day', () => {
    expect(rangeStart('24h', now)).toBe('2026-01-01T00:00:00.000Z');
  });

  it('reaches back a week', () => {
    expect(rangeStart('7d', now)).toBe('2025-12-26T00:00:00.000Z');
  });

  it('leaves the league range open-ended', () => {
    expect(rangeStart('league', now)).toBeUndefined();
  });
});

describe('netWorthRows', () => {
  it('carries the timestamp as a number for the time axis', () => {
    const rows = netWorthRows([snapshot(0, 100, {}), snapshot(10, 150, {})]);
    expect(rows[0]?.t).toBe(START);
    expect(rows[1]?.chaos).toBe(150);
  });
});

describe('annotationPoints', () => {
  it('pins a marker to the snapshot that ended the flagged interval', () => {
    const rows = netWorthRows([snapshot(0, 100, {}), snapshot(10, 900, {})]);
    const points = annotationPoints([interval(10, 800, true)], rows);

    expect(points).toHaveLength(1);
    expect(points[0]?.chaos).toBe(900);
    expect(points[0]?.deltaChaos).toBe(800);
  });

  it('ignores intervals that were not flagged', () => {
    const rows = netWorthRows([snapshot(0, 100, {}), snapshot(10, 150, {})]);
    expect(annotationPoints([interval(10, 50, false)], rows)).toEqual([]);
  });

  it('drops a marker whose snapshot is outside the visible range', () => {
    const rows = netWorthRows([snapshot(20, 900, {})]);
    expect(annotationPoints([interval(10, 800, true)], rows)).toEqual([]);
  });
});

describe('rateRows', () => {
  it('keeps the idle flag so the bar can be drawn faint', () => {
    const rows = rateRows([interval(10, 0.2, false), interval(20, 60, false)]);
    expect(rows[0]?.idle).toBe(true);
    expect(rows[1]?.idle).toBe(false);
  });
});

describe('tabNames', () => {
  it('orders by the latest value, biggest first', () => {
    const names = tabNames([
      snapshot(0, 100, { Dump: 10, Currency: 90 }),
      snapshot(10, 100, { Dump: 80, Currency: 20 }),
    ]);
    expect(names).toEqual(['Dump', 'Currency']);
  });

  it('includes a tab that only existed earlier in the range', () => {
    const names = tabNames([snapshot(0, 100, { Gone: 50 }), snapshot(10, 100, { Currency: 100 })]);
    expect(names).toEqual(['Currency', 'Gone']);
  });
});

describe('tabRows', () => {
  it('fills a missing tab with zero rather than leaving a hole in the stack', () => {
    const snapshots = [snapshot(0, 100, { Currency: 100 }), snapshot(10, 150, { Currency: 100, Dump: 50 })];
    const rows = tabRows(snapshots, tabNames(snapshots));

    expect(rows[0]?.Dump).toBe(0);
    expect(rows[1]?.Dump).toBe(50);
  });
});

describe('sortRows', () => {
  const rows = [
    { name: 'Chaos Orb', chaosTotal: 250 },
    { name: 'Divine Orb', chaosTotal: 2620 },
    { name: 'Awakened Sextant', chaosTotal: 40 },
  ];

  it('sorts numbers numerically', () => {
    expect(sortRows(rows, 'chaosTotal', 'desc').map((row) => row.chaosTotal)).toEqual([2620, 250, 40]);
  });

  it('sorts strings alphabetically', () => {
    expect(sortRows(rows, 'name', 'asc')[0]?.name).toBe('Awakened Sextant');
  });

  it('does not mutate the input', () => {
    sortRows(rows, 'chaosTotal', 'asc');
    expect(rows[0]?.name).toBe('Chaos Orb');
  });
});
