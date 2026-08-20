/**
 * The dust formula, checked against the table it was derived from.
 *
 * The table publishes two values per unique — item level 84 at no quality and at 20% — and this
 * code reconstructs a base dust and an inherent multiplier from them. That reconstruction is
 * either right for every row or it is worthless, so the test runs all 1,103 of them back through
 * the formula and requires the published numbers to come out again.
 */

import { describe, expect, it } from 'vitest';
import rawTable from '../src/data/dust.json' with { type: 'json' };
import { DUST_TABLE, ILVL_CEILING, ILVL_FLOOR, dustFor, inherentFactorsFrom } from '../src/services/dust.ts';

interface RawRow {
  n: string;
  b: string;
  d84: number;
  d84q: number;
  g: number;
  s: number;
}

const rows = rawTable as RawRow[];

describe('the published table', () => {
  it('is all there', () => {
    expect(rows.length).toBe(1103);
    expect(DUST_TABLE.size).toBe(1103);
  });

  it('has one row per name, which is why the lookup is by name alone', () => {
    expect(new Set(rows.map((row) => row.n)).size).toBe(rows.length);
  });
});

describe('inherentFactorsFrom', () => {
  it('finds the four factors the table actually contains', () => {
    const seen = new Map<number, number>();
    for (const row of rows) {
      const factors = inherentFactorsFrom(row.d84, row.d84q);
      seen.set(factors, (seen.get(factors) ?? 0) + 1);
    }

    // 100 is an ordinary unique, 150 one influence, 200 two, 400 six units of influence or
    // corruption. Anything outside that set would mean the derivation is finding noise.
    expect([...seen.keys()].sort((a, b) => a - b)).toEqual([100, 150, 200, 400]);
    expect(seen.get(100)).toBe(1077);
  });

  it('falls back to the neutral factor rather than guessing', () => {
    expect(inherentFactorsFrom(0, 100)).toBe(100);
    expect(inherentFactorsFrom(100, 0)).toBe(100);
    expect(inherentFactorsFrom(100, 100)).toBe(100);
    expect(inherentFactorsFrom(100, 50)).toBe(100);
  });
});

describe('dustFor, against every row of the table', () => {
  it('reproduces the published item-level-84 value with no quality', () => {
    const wrong = rows.filter((row) => dustFor(row.n, { ilvl: 84, quality: 0 })?.dust !== row.d84);
    expect(wrong.map((row) => row.n)).toEqual([]);
  });

  it('reproduces the published 20% quality value, to within a single dust', () => {
    // One row of 1,103 comes out one dust short of what is published — 640,252 against 640,253
    // for Entropic Devastation. That is a rounding artefact in the source data, not a
    // disagreement about the formula, and it is asserted rather than hidden so a real
    // regression cannot slip in behind it.
    const offBy = rows.map((row) => {
      const got = dustFor(row.n, { ilvl: 84, quality: 20 })?.dust ?? 0;
      return { name: row.n, delta: got - row.d84q };
    });

    expect(offBy.filter((row) => row.delta !== 0)).toEqual([
      { name: 'Entropic Devastation', delta: -1 },
    ]);
  });
});

describe('dustFor', () => {
  const tabula = 'Tabula Rasa';

  it('knows a unique from the table and reports the gold and the slots with it', () => {
    const result = dustFor(tabula, { ilvl: 84, quality: 0 });

    expect(result).not.toBeNull();
    expect(result?.goldCost).toBeGreaterThan(0);
    expect(result?.slots).toBeGreaterThan(0);
  });

  it('scales steeply with item level: 65 is a twentieth of 84', () => {
    const top = dustFor(tabula, { ilvl: ILVL_CEILING, quality: 0 })?.dust ?? 0;
    const bottom = dustFor(tabula, { ilvl: ILVL_FLOOR, quality: 0 })?.dust ?? 0;

    expect(bottom).toBeGreaterThan(0);
    expect(top / bottom).toBeCloseTo(20, 6);
  });

  it('stops falling below 65 and stops rising above 84', () => {
    const floor = dustFor(tabula, { ilvl: ILVL_FLOOR, quality: 0 })?.dust;
    const ceiling = dustFor(tabula, { ilvl: ILVL_CEILING, quality: 0 })?.dust;

    expect(dustFor(tabula, { ilvl: 1, quality: 0 })?.dust).toBe(floor);
    expect(dustFor(tabula, { ilvl: 100, quality: 0 })?.dust).toBe(ceiling);
  });

  it('adds two per cent per point of quality', () => {
    const plain = dustFor(tabula, { ilvl: 84, quality: 0 })?.dust ?? 0;
    const quality = dustFor(tabula, { ilvl: 84, quality: 20 })?.dust ?? 0;

    expect(quality / plain).toBeCloseTo(1.4, 6);
  });

  it('does not boost an already-influenced item twice', () => {
    // Impresence carries its influence in the published figure. Applying a second influence
    // multiplier on top would inflate it by half again — the mistake this derivation exists to
    // avoid — so its quality ratio is smaller than an ordinary unique's, not equal to it.
    const plain = dustFor('Impresence', { ilvl: 84, quality: 0 })?.dust ?? 0;
    const quality = dustFor('Impresence', { ilvl: 84, quality: 20 })?.dust ?? 0;

    expect(quality / plain).toBeCloseTo(190 / 150, 6);
  });

  it('treats a missing item level as the floor, and says the figure is a floor', () => {
    const unknown = dustFor(tabula, { ilvl: null, quality: 0 });
    const floor = dustFor(tabula, { ilvl: ILVL_FLOOR, quality: 0 });

    // The worst case rather than the best: somebody is deciding what to destroy, and an unknown
    // that flatters the item is the unknown that costs them something.
    expect(unknown?.dust).toBe(floor?.dust);
    expect(unknown?.atLeast).toBe(true);
    expect(floor?.atLeast).toBe(false);
  });

  it('marks a corrupted item as a floor, because its implicits are not in the payload', () => {
    expect(dustFor(tabula, { ilvl: 84, quality: 0, corrupted: true })?.atLeast).toBe(true);
  });

  it('returns null for a unique it has never heard of', () => {
    // Null rather than zero and rather than an estimate: a unique added after the table was
    // captured has no dust value here, and inventing one puts a number with nothing behind it
    // in the column the decision is made from.
    expect(dustFor('Some Unique From Next League', { ilvl: 84, quality: 0 })).toBeNull();
  });

  it('refuses a nonsense quality rather than propagating it', () => {
    const plain = dustFor(tabula, { ilvl: 84, quality: 0 })?.dust;

    expect(dustFor(tabula, { ilvl: 84, quality: Number.NaN })?.dust).toBe(plain);
    expect(dustFor(tabula, { ilvl: 84, quality: -5 })?.dust).toBe(plain);
  });
});
