import { describe, expect, it } from 'vitest';
import { bestWindow, computeIntervals, computeStats, median, type SeriesPoint } from '../src/lib/series.ts';

const START = Date.parse('2026-01-01T00:00:00Z');

/** Build a series from [minutesFromStart, totalChaos] pairs. */
function series(points: Array<[number, number]>): SeriesPoint[] {
  return points.map(([minutes, totalChaos], index) => ({
    id: index + 1,
    takenAt: new Date(START + minutes * 60_000),
    totalChaos,
    totalDivine: totalChaos / 200,
    divineRate: 200,
  }));
}

describe('median', () => {
  it('takes the middle of an odd count', () => {
    expect(median([5, 1, 3])).toBe(3);
  });

  it('averages the middle two of an even count', () => {
    expect(median([1, 2, 3, 10])).toBe(2.5);
  });

  it('is zero for nothing', () => {
    expect(median([])).toBe(0);
  });
});

describe('computeIntervals', () => {
  it('normalises each delta by its own duration', () => {
    const intervals = computeIntervals(series([[0, 100], [10, 150], [40, 300]]));
    expect(intervals[0]?.chaosPerHour).toBe(300);
    expect(intervals[1]?.chaosPerHour).toBe(300);
  });

  it('handles irregular spacing without assuming a fixed interval', () => {
    const intervals = computeIntervals(series([[0, 100], [10, 110], [190, 500]]));
    expect(intervals[1]?.hours).toBe(3);
    expect(intervals[1]?.chaosPerHour).toBe(130);
  });

  it('marks an interval under a chaos of movement as idle', () => {
    const intervals = computeIntervals(series([[0, 100], [10, 100.4], [20, 105]]));
    expect(intervals[0]?.idle).toBe(true);
    expect(intervals[1]?.idle).toBe(false);
  });

  it('marks an overnight gap with no gain as idle', () => {
    const intervals = computeIntervals(series([[0, 1000], [480, 1000]]));
    expect(intervals[0]?.idle).toBe(true);
    expect(intervals[0]?.hours).toBe(8);
  });

  it('flags a delta more than three times the trailing median', () => {
    const intervals = computeIntervals(
      series([[0, 0], [10, 10], [20, 20], [30, 30], [40, 40], [50, 500]]),
    );
    expect(intervals.slice(0, 4).every((interval) => !interval.annotated)).toBe(true);
    expect(intervals[4]?.annotated).toBe(true);
  });

  it('flags a large loss as well as a large gain — a purchase is worth marking too', () => {
    const intervals = computeIntervals(
      series([[0, 1000], [10, 1010], [20, 1020], [30, 1030], [40, 1040], [50, 500]]),
    );
    expect(intervals[4]?.annotated).toBe(true);
    expect(intervals[4]?.deltaChaos).toBe(-540);
  });

  it('needs a few intervals of history before it will call anything a spike', () => {
    // Two intervals is not enough to know what "normal" looks like for this player.
    const intervals = computeIntervals(series([[0, 0], [10, 10], [20, 500]]));
    expect(intervals).toHaveLength(2);
    expect(intervals.every((interval) => !interval.annotated)).toBe(true);
  });

  it('does not let idle intervals drag the median to zero and flag everything', () => {
    const intervals = computeIntervals(
      series([
        [0, 100],
        [10, 110],
        [20, 120],
        [30, 130],
        [480, 130],
        [490, 140],
      ]),
    );
    // The 7.5-hour gap with no movement is idle and stays out of the median.
    expect(intervals[3]?.idle).toBe(true);
    expect(intervals.filter((interval) => interval.annotated)).toHaveLength(0);
  });

  it('drops a duplicate timestamp rather than dividing by zero', () => {
    const points = series([[0, 100], [0, 100], [10, 120]]);
    const intervals = computeIntervals(points);
    expect(intervals).toHaveLength(1);
    expect(Number.isFinite(intervals[0]?.chaosPerHour ?? Number.NaN)).toBe(true);
  });

  it('returns nothing for a single snapshot', () => {
    expect(computeIntervals(series([[0, 100]]))).toEqual([]);
  });
});

describe('bestWindow', () => {
  it('finds the best hour on an irregularly spaced series', () => {
    // The best hour is 120→150 (+740). 0→150 is a bigger gain but spans two and a half hours.
    const best = bestWindow(series([[0, 0], [30, 100], [60, 150], [120, 160], [150, 900]]));
    expect(best?.gainChaos).toBe(740);
    expect(best?.from).toBe(new Date(START + 120 * 60_000).toISOString());
  });

  it('reports nothing rather than inventing a window when the gaps are all too wide', () => {
    expect(bestWindow(series([[0, 0], [90, 1000]]))).toBeNull();
  });

  it('is null with fewer than two snapshots', () => {
    expect(bestWindow(series([[0, 100]]))).toBeNull();
  });

  it('reports the least-bad window when wealth only ever fell', () => {
    const best = bestWindow(series([[0, 1000], [30, 900], [60, 500]]));
    expect(best?.gainChaos).toBeLessThan(0);
  });
});

describe('computeStats', () => {
  it('separates active chaos-per-hour from wall-clock', () => {
    // One hour of earning 600, then eight hours asleep.
    const stats = computeStats(series([[0, 0], [60, 600], [540, 600]]));
    expect(stats.chaosPerHourActive).toBe(600);
    expect(stats.chaosPerHourWallClock).toBe(66.67);
  });

  it('counts only moving intervals towards active hours', () => {
    const stats = computeStats(series([[0, 0], [60, 600], [540, 600]]));
    expect(stats.activeHours).toBe(1);
    expect(stats.wallClockHours).toBe(9);
  });

  it('reports the total gain over the range', () => {
    const stats = computeStats(series([[0, 250], [60, 1250]]));
    expect(stats.totalGainChaos).toBe(1000);
  });

  it('carries the latest divine rate and totals', () => {
    const stats = computeStats(series([[0, 250], [60, 1250]]));
    expect(stats.currentChaos).toBe(1250);
    expect(stats.divineRate).toBe(200);
    expect(stats.currentDivine).toBe(6.25);
  });

  it('answers safely for an empty league', () => {
    const stats = computeStats([]);
    expect(stats).toMatchObject({
      count: 0,
      firstAt: null,
      chaosPerHourActive: 0,
      chaosPerHourWallClock: 0,
      bestHour: null,
      intervals: [],
    });
  });

  it('answers safely for a single snapshot', () => {
    const stats = computeStats(series([[0, 100]]));
    expect(stats.count).toBe(1);
    expect(stats.currentChaos).toBe(100);
    expect(stats.intervals).toEqual([]);
  });

  it('does not divide by zero when every snapshot shares a timestamp', () => {
    const stats = computeStats(series([[0, 100], [0, 100]]));
    expect(stats.chaosPerHourWallClock).toBe(0);
    expect(stats.chaosPerHourActive).toBe(0);
  });
});
