/**
 * Everything derived from a series of snapshots.
 *
 * Two rules from the spec drive the whole file:
 *
 *   Active time. If two consecutive snapshots differ by less than a chaos, that interval was
 *   idle — the player was asleep, or logged out. Averaging it in drags chaos-per-hour towards
 *   zero and makes the number meaningless. Both figures are reported so the gap is visible.
 *
 *   Irregular spacing. Snapshots have holes: the host sleeps, the container restarts, GGG
 *   rate-limits a poll into the next slot. Nothing here may assume fixed spacing; every delta
 *   is normalised by its own measured duration.
 */

export interface SeriesPoint {
  id: number;
  takenAt: Date;
  totalChaos: number;
  totalDivine?: number;
  divineRate?: number;
}

export interface SeriesInterval {
  fromId: number;
  toId: number;
  from: string;
  to: string;
  hours: number;
  deltaChaos: number;
  chaosPerHour: number;
  /** Below the idle threshold: excluded from the active average. */
  idle: boolean;
  /** Larger than 3× the trailing median — a sale, a big drop, or a purchase. */
  annotated: boolean;
}

export interface BestWindow {
  from: string;
  to: string;
  gainChaos: number;
}

export interface SeriesStats {
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
  bestHour: BestWindow | null;
  intervals: SeriesInterval[];
}

export interface SeriesOptions {
  /** |delta| under this many chaos means the interval was idle. */
  idleThresholdChaos?: number;
  /** Multiple of the trailing median that counts as a spike. */
  annotationFactor?: number;
  /** How many preceding non-idle intervals the median looks at. */
  medianWindow?: number;
  /** Width of the "best hour" window, in milliseconds. */
  bestWindowMs?: number;
}

const DEFAULTS = {
  idleThresholdChaos: 1,
  annotationFactor: 3,
  medianWindow: 12,
  bestWindowMs: 60 * 60 * 1000,
} as const;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] as number;
  return ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

/** Snapshots oldest first. Anything with a non-positive duration is dropped as a duplicate. */
export function computeIntervals(points: SeriesPoint[], options: SeriesOptions = {}): SeriesInterval[] {
  const idleThreshold = options.idleThresholdChaos ?? DEFAULTS.idleThresholdChaos;
  const factor = options.annotationFactor ?? DEFAULTS.annotationFactor;
  const windowSize = options.medianWindow ?? DEFAULTS.medianWindow;

  const intervals: SeriesInterval[] = [];
  const trailing: number[] = [];

  for (let i = 1; i < points.length; i += 1) {
    const previous = points[i - 1] as SeriesPoint;
    const current = points[i] as SeriesPoint;
    const ms = current.takenAt.getTime() - previous.takenAt.getTime();
    if (!(ms > 0)) continue;

    const hours = ms / 3_600_000;
    const deltaChaos = round2(current.totalChaos - previous.totalChaos);
    const idle = Math.abs(deltaChaos) < idleThreshold;

    // The median is taken over preceding *moving* intervals only. Including idle ones would
    // pull it to zero and flag every ordinary gain as a spike.
    const reference = median(trailing);
    const annotated =
      !idle && trailing.length >= 3 && reference > 0 && Math.abs(deltaChaos) > factor * reference;

    intervals.push({
      fromId: previous.id,
      toId: current.id,
      from: previous.takenAt.toISOString(),
      to: current.takenAt.toISOString(),
      hours: round2(hours),
      deltaChaos,
      chaosPerHour: round2(deltaChaos / hours),
      idle,
      annotated,
    });

    if (!idle) {
      trailing.push(Math.abs(deltaChaos));
      if (trailing.length > windowSize) trailing.shift();
    }
  }

  return intervals;
}

/**
 * The largest gain inside any window of `bestWindowMs`, which is what "best hour" should mean
 * on an irregular series. Computed with a monotonic deque of running minima: O(n), and it
 * never assumes snapshots are an hour, or ten minutes, or anything apart.
 */
export function bestWindow(points: SeriesPoint[], windowMs = DEFAULTS.bestWindowMs): BestWindow | null {
  if (points.length < 2) return null;

  const minima: number[] = [0];
  let best: BestWindow | null = null;

  for (let j = 1; j < points.length; j += 1) {
    const current = points[j] as SeriesPoint;
    while (
      minima.length > 0 &&
      current.takenAt.getTime() - (points[minima[0] as number] as SeriesPoint).takenAt.getTime() > windowMs
    ) {
      minima.shift();
    }

    const start = minima.length > 0 ? (points[minima[0] as number] as SeriesPoint) : null;
    if (start) {
      const gain = round2(current.totalChaos - start.totalChaos);
      if (best === null || gain > best.gainChaos) {
        best = { from: start.takenAt.toISOString(), to: current.takenAt.toISOString(), gainChaos: gain };
      }
    }

    while (
      minima.length > 0 &&
      (points[minima[minima.length - 1] as number] as SeriesPoint).totalChaos >= current.totalChaos
    ) {
      minima.pop();
    }
    minima.push(j);
  }

  return best;
}

export function computeStats(points: SeriesPoint[], options: SeriesOptions = {}): SeriesStats {
  const first = points[0] ?? null;
  const last = points[points.length - 1] ?? null;

  const empty: SeriesStats = {
    count: points.length,
    firstAt: first ? first.takenAt.toISOString() : null,
    lastAt: last ? last.takenAt.toISOString() : null,
    startChaos: first?.totalChaos ?? 0,
    currentChaos: last?.totalChaos ?? 0,
    currentDivine: last?.totalDivine ?? 0,
    divineRate: last?.divineRate ?? 0,
    totalGainChaos: 0,
    wallClockHours: 0,
    activeHours: 0,
    chaosPerHourWallClock: 0,
    chaosPerHourActive: 0,
    bestHour: null,
    intervals: [],
  };

  if (!first || !last || points.length < 2) return empty;

  const intervals = computeIntervals(points, options);
  const wallClockMs = last.takenAt.getTime() - first.takenAt.getTime();
  const wallClockHours = wallClockMs / 3_600_000;

  let activeHours = 0;
  let activeDelta = 0;
  for (const interval of intervals) {
    if (interval.idle) continue;
    activeHours += interval.hours;
    activeDelta += interval.deltaChaos;
  }

  const totalGainChaos = round2(last.totalChaos - first.totalChaos);

  return {
    ...empty,
    totalGainChaos,
    wallClockHours: round2(wallClockHours),
    activeHours: round2(activeHours),
    chaosPerHourWallClock: wallClockHours > 0 ? round2(totalGainChaos / wallClockHours) : 0,
    chaosPerHourActive: activeHours > 0 ? round2(activeDelta / activeHours) : 0,
    bestHour: bestWindow(points, options.bestWindowMs),
    intervals,
  };
}
