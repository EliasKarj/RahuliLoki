import { describe, expect, it } from 'vitest';
import { categories, matches } from '../src/components/Economy.tsx';
import type { EconomyRow } from '../src/lib/api.ts';

const row = (over: Partial<EconomyRow>): EconomyRow => ({
  id: 'gcp',
  name: "Gemcutter's Prism",
  nameSource: 'alias',
  category: 'Currency',
  chaos: 3,
  divine: 0.014,
  icon: null,
  ...over,
});

describe('matches', () => {
  it('ignores case and punctuation in the name', () => {
    expect(matches(row({}), 'gemcutters')).toBe(true);
    expect(matches(row({}), "GEMCUTTER'S")).toBe(true);
  });

  it('searches the id, because that is what the trade site calls it', () => {
    // Somebody who knows this as "gcp" should not have to guess the written-out name.
    expect(matches(row({}), 'gcp')).toBe(true);
  });

  it('searches the category', () => {
    expect(matches(row({}), 'currency')).toBe(true);
  });

  it('matches everything on an empty query', () => {
    expect(matches(row({}), '   ')).toBe(true);
  });

  it('says no when it means no', () => {
    expect(matches(row({}), 'scarab')).toBe(false);
  });

  it('copes with a row that has no category', () => {
    expect(matches(row({ category: null }), 'gcp')).toBe(true);
    expect(matches(row({ category: null }), 'currency')).toBe(false);
  });
});

describe('categories', () => {
  it('lists each category once, most populous first', () => {
    const rows = [
      row({ id: 'a', category: 'Scarab' }),
      row({ id: 'b', category: 'Currency' }),
      row({ id: 'c', category: 'Currency' }),
      row({ id: 'd', category: 'Currency' }),
      row({ id: 'e', category: 'Scarab' }),
      row({ id: 'f', category: 'Oil' }),
    ];

    expect(categories(rows)).toEqual(['Currency', 'Scarab', 'Oil']);
  });

  it('leaves out the rows that have no category rather than inventing one', () => {
    expect(categories([row({ category: null })])).toEqual([]);
  });
});
