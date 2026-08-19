/**
 * What actually moved between two snapshots.
 *
 * The charts answer "how much" — this answers "from what". A run of +3000c is one number; the
 * useful version is "sold a Mageblood, spent 200 chaos on fossils".
 *
 * One rule shapes the whole thing: **aggregate across tabs before diffing.** A player moving a
 * stack from a dump tab into a currency tab has not gained or lost anything, but a per-tab diff
 * reports it as a loss in one place and an identical gain in another. Two lines of noise for an
 * event that did not happen, in the exact view whose job is to surface real events.
 *
 * Both quantity and value are reported because they answer different questions. A holding whose
 * quantity did not change but whose value rose is the market moving, not the player earning; a
 * chaos-per-hour number that cannot tell those apart is measuring the wrong thing.
 */

import type { Breakdown } from '../services/valuationService.ts';
import type { ItemSeriesPoint } from '../services/snapshotRepo.ts';

export interface ItemChange {
  name: string;
  qtyBefore: number;
  qtyAfter: number;
  qtyDelta: number;
  chaosBefore: number;
  chaosAfter: number;
  chaosDelta: number;
  /** Per-unit price at each end, so a pure price move is distinguishable from a real one. */
  chaosEachBefore: number;
  chaosEachAfter: number;
  /**
   * Why the value moved:
   *   'quantity' the holding itself changed — the player acquired or spent it
   *   'price'    the same quantity is worth more or less than it was
   *   'both'     quantity and unit price both moved
   */
  reason: 'quantity' | 'price' | 'both';
}

export interface ChangeSummary {
  changes: ItemChange[];
  /** Sum of positive deltas, and of negative ones. They do not cancel — both are interesting. */
  gainedChaos: number;
  lostChaos: number;
  netChaos: number;
}

interface Aggregate {
  qty: number;
  chaos: number;
  chaosEach: number;
}

/** Flatten a breakdown across tabs. Where the same item sits in two tabs, the piles are one pile. */
export function flatten(breakdown: Breakdown): Map<string, Aggregate> {
  const out = new Map<string, Aggregate>();
  for (const entries of Object.values(breakdown)) {
    for (const [name, entry] of Object.entries(entries)) {
      const existing = out.get(name);
      if (existing) {
        existing.qty += entry.qty;
        existing.chaos += entry.chaosTotal;
      } else {
        out.set(name, { qty: entry.qty, chaos: entry.chaosTotal, chaosEach: entry.chaosEach });
      }
    }
  }
  return out;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Diff two breakdowns.
 *
 * `minChaos` drops changes too small to be worth a row. It applies to the absolute delta, so a
 * large loss is as visible as a large gain — a view that only showed gains would be useless for
 * the question "where did it go".
 */
export function diffBreakdowns(
  before: Breakdown,
  after: Breakdown,
  minChaos = 1,
): ChangeSummary {
  const a = flatten(before);
  const b = flatten(after);

  const names = new Set([...a.keys(), ...b.keys()]);
  const changes: ItemChange[] = [];
  let gainedChaos = 0;
  let lostChaos = 0;

  for (const name of names) {
    const from = a.get(name) ?? { qty: 0, chaos: 0, chaosEach: 0 };
    const to = b.get(name) ?? { qty: 0, chaos: 0, chaosEach: 0 };

    const chaosDelta = round2(to.chaos - from.chaos);
    if (Math.abs(chaosDelta) < minChaos) continue;

    const qtyDelta = to.qty - from.qty;
    // A unit price is only meaningful where the item existed; a vanished holding has no
    // "new price", and calling that a price move would be nonsense.
    const priceMoved =
      from.chaosEach > 0 && to.chaosEach > 0 && round2(from.chaosEach) !== round2(to.chaosEach);

    changes.push({
      name,
      qtyBefore: from.qty,
      qtyAfter: to.qty,
      qtyDelta,
      chaosBefore: round2(from.chaos),
      chaosAfter: round2(to.chaos),
      chaosDelta,
      chaosEachBefore: round2(from.chaosEach),
      chaosEachAfter: round2(to.chaosEach),
      reason: qtyDelta !== 0 && priceMoved ? 'both' : qtyDelta !== 0 ? 'quantity' : 'price',
    });

    if (chaosDelta > 0) gainedChaos += chaosDelta;
    else lostChaos += chaosDelta;
  }

  // Biggest movement first, in either direction: the largest loss is as much a headline as the
  // largest gain, so ordering is by magnitude rather than by signed value.
  changes.sort((x, y) => Math.abs(y.chaosDelta) - Math.abs(x.chaosDelta) || x.name.localeCompare(y.name));

  return {
    changes,
    gainedChaos: round2(gainedChaos),
    lostChaos: round2(lostChaos),
    netChaos: round2(gainedChaos + lostChaos),
  };
}

export interface ItemHistoryPoint {
  takenAt: string;
  qty: number;
  chaosEach: number;
  chaosTotal: number;
}

/**
 * One item's quantity and value across a series of snapshots, as the API states them.
 *
 * The summing happens in the store — see `itemSeries`, which does it in the database rather
 * than by reading every breakdown in the range. What is left here is the shaping: an ISO
 * timestamp and figures rounded the way every other price in the API is.
 *
 * A snapshot where the item is absent arrives as a zero rather than as a missing point. That is
 * the honest reading — you held none of it — and it keeps the line continuous, so selling a
 * stack shows as a drop to the floor instead of the series quietly ending.
 */
export function itemHistory(points: ItemSeriesPoint[]): ItemHistoryPoint[] {
  return points.map((point) => ({
    takenAt: point.takenAt.toISOString(),
    qty: point.qty,
    chaosEach: round2(point.chaosEach),
    chaosTotal: round2(point.chaosTotal),
  }));
}
