import { describe, expect, it } from 'vitest';
import { diffBreakdowns, flatten, itemHistory } from '../src/lib/changes.ts';
import type { Breakdown } from '../src/services/valuationService.ts';

function entry(qty: number, chaosEach: number) {
  return { qty, chaosEach, chaosTotal: Math.round(qty * chaosEach * 100) / 100 };
}

describe('flatten', () => {
  it('sums a holding that sits in more than one tab', () => {
    const breakdown: Breakdown = {
      Currency: { 'Chaos Orb': entry(100, 1) },
      Dump: { 'Chaos Orb': entry(50, 1) },
    };
    expect(flatten(breakdown).get('Chaos Orb')).toMatchObject({ qty: 150, chaos: 150 });
  });
});

describe('diffBreakdowns', () => {
  it('reports a sale as a loss of the item', () => {
    const before: Breakdown = { Gear: { Mageblood: entry(1, 5000) } };
    const after: Breakdown = { Gear: {} };

    const { changes, lostChaos, netChaos } = diffBreakdowns(before, after);

    expect(changes[0]).toMatchObject({
      name: 'Mageblood',
      qtyBefore: 1,
      qtyAfter: 0,
      chaosDelta: -5000,
      reason: 'quantity',
    });
    expect(lostChaos).toBe(-5000);
    expect(netChaos).toBe(-5000);
  });

  it('does not invent a gain and a loss when a stack moves between tabs', () => {
    // The failure this whole aggregate-first design exists to prevent: reorganising a stash
    // is not an event, and reporting it as one buries the events that are.
    const before: Breakdown = { Dump: { 'Chaos Orb': entry(500, 1) } };
    const after: Breakdown = { Currency: { 'Chaos Orb': entry(500, 1) } };

    expect(diffBreakdowns(before, after).changes).toEqual([]);
  });

  it('separates a price move from a holding move', () => {
    const before: Breakdown = { Currency: { 'Divine Orb': entry(10, 200) } };
    const after: Breakdown = { Currency: { 'Divine Orb': entry(10, 230) } };

    const change = diffBreakdowns(before, after).changes[0];
    expect(change).toMatchObject({ reason: 'price', qtyDelta: 0, chaosDelta: 300 });
  });

  it('calls it both when the pile and the price moved', () => {
    const before: Breakdown = { Currency: { 'Divine Orb': entry(10, 200) } };
    const after: Breakdown = { Currency: { 'Divine Orb': entry(12, 230) } };
    expect(diffBreakdowns(before, after).changes[0]?.reason).toBe('both');
  });

  it('keeps gains and losses apart instead of netting them away', () => {
    // "+4000 and -1000" and "+3000" are the same net and very different afternoons.
    const before: Breakdown = { Gear: { Mageblood: entry(1, 1000) } };
    const after: Breakdown = { Gear: { Headhunter: entry(1, 4000) } };

    const summary = diffBreakdowns(before, after);
    expect(summary.gainedChaos).toBe(4000);
    expect(summary.lostChaos).toBe(-1000);
    expect(summary.netChaos).toBe(3000);
  });

  it('orders by magnitude, so the biggest loss is as visible as the biggest gain', () => {
    const before: Breakdown = { Gear: { Big: entry(1, 9000), Small: entry(1, 10) } };
    const after: Breakdown = { Gear: { Small: entry(1, 60) } };

    expect(diffBreakdowns(before, after).changes.map((c) => c.name)).toEqual(['Big', 'Small']);
  });

  it('drops movements under the threshold rather than filling the table with noise', () => {
    const before: Breakdown = { Currency: { 'Orb of Alteration': entry(100, 0.12) } };
    const after: Breakdown = { Currency: { 'Orb of Alteration': entry(103, 0.12) } };
    expect(diffBreakdowns(before, after, 1).changes).toEqual([]);
  });

  it('is empty for two identical snapshots', () => {
    const same: Breakdown = { Currency: { 'Chaos Orb': entry(100, 1) } };
    expect(diffBreakdowns(same, same).changes).toEqual([]);
  });
});

describe('itemHistory', () => {
  // The summing moved into the store, which does it in SQL — see snapshotRepoSql.test.ts. What
  // is left here is the shaping, and the rounding is the part worth pinning: these figures are
  // prices, and every price in the API is stated to two decimals.
  const point = (qty: number, chaosEach: number, chaosTotal: number) => ({
    takenAt: new Date('2026-01-01T00:00:00Z'),
    qty,
    chaosEach,
    chaosTotal,
  });

  it('states the time as ISO and the money to two decimals', () => {
    const points = itemHistory([point(3, 1.234, 3.014_9)]);
    expect(points).toEqual([
      { takenAt: '2026-01-01T00:00:00.000Z', qty: 3, chaosEach: 1.23, chaosTotal: 3.01 },
    ]);
  });

  it('passes a zero through as a zero', () => {
    // A sold-out holding drops to the floor rather than making the series stop; the store emits
    // the zero and this must not turn it into anything else.
    expect(itemHistory([point(0, 0, 0)])[0]).toMatchObject({ qty: 0, chaosTotal: 0 });
  });

  it('keeps quantities whole', () => {
    // Quantities are counts of items. Rounding them like money would be wrong in a way nobody
    // would notice, so they are not rounded at all.
    expect(itemHistory([point(1234, 0.1, 123.4)])[0]?.qty).toBe(1234);
  });
});
