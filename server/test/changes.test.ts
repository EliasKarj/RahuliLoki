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
  const snapshots: Array<{ takenAt: Date; breakdown: Breakdown }> = [
    { takenAt: new Date('2026-01-01T00:00:00Z'), breakdown: { A: { Widget: entry(2, 10) } } },
    { takenAt: new Date('2026-01-01T01:00:00Z'), breakdown: { A: { Widget: entry(5, 10) } } },
    { takenAt: new Date('2026-01-01T02:00:00Z'), breakdown: { A: {} } },
  ];

  it('tracks quantity and value across the range', () => {
    const points = itemHistory(snapshots, 'Widget');
    expect(points.map((p) => p.qty)).toEqual([2, 5, 0]);
    expect(points.map((p) => p.chaosTotal)).toEqual([20, 50, 0]);
  });

  it('reports absence as zero rather than a gap in the line', () => {
    // A sold-out holding should drop to the floor, not make the series stop.
    const points = itemHistory(snapshots, 'Widget');
    expect(points).toHaveLength(3);
    expect(points[2]).toMatchObject({ qty: 0, chaosTotal: 0 });
  });

  it('sums across tabs', () => {
    const points = itemHistory(
      [
        {
          takenAt: new Date('2026-01-01T00:00:00Z'),
          breakdown: { A: { Widget: entry(2, 10) }, B: { Widget: entry(3, 10) } },
        },
      ],
      'Widget',
    );
    expect(points[0]).toMatchObject({ qty: 5, chaosTotal: 50 });
  });

  it('is all zeroes for an item never held', () => {
    expect(itemHistory(snapshots, 'Nothing').every((p) => p.qty === 0)).toBe(true);
  });

  it('does not mistake an inherited property for a holding', () => {
    // Breakdown keys come from stash tab and item names, so a lookup for `constructor` has to
    // miss rather than return a function off the prototype.
    expect(itemHistory(snapshots, 'constructor').every((p) => p.qty === 0)).toBe(true);
  });
});
