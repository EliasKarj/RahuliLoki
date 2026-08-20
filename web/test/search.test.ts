import { describe, expect, it } from 'vitest';
import { looseIncludes } from '../src/lib/search.ts';
import { matchesQuery } from '../src/lib/items.ts';
import { matches } from '../src/components/Economy.tsx';
import type { EconomyRow } from '../src/lib/api.ts';

describe('looseIncludes', () => {
  it('ignores case', () => {
    expect(looseIncludes("Assassin's Favour", 'ASSASSIN')).toBe(true);
  });

  it('ignores punctuation in the text', () => {
    expect(looseIncludes("Assassin's Favour", 'assassins')).toBe(true);
  });

  it('ignores punctuation in the query too', () => {
    // The half that was missing. Two of the three old copies stripped punctuation from the text
    // and not from what was typed, so a box that promised you need not remember the apostrophe
    // failed for everyone who did remember it.
    expect(looseIncludes('Assassins Favour', "assassin's")).toBe(true);
    expect(looseIncludes("Assassin's Favour", "assassin's")).toBe(true);
  });

  it('treats an empty query as no filter at all', () => {
    expect(looseIncludes('anything', '')).toBe(true);
    expect(looseIncludes('anything', '   ')).toBe(true);
  });

  it('still says no when it means no', () => {
    expect(looseIncludes("Assassin's Favour", 'scarab')).toBe(false);
  });
});

describe('both tables search the same way', () => {
  const economyRow: EconomyRow = {
    id: 'assassins-favour',
    name: "Assassin's Favour",
    nameSource: 'stash',
    category: 'DivinationCard',
    chaos: 5,
    divine: 0.02,
    icon: null,
    change: null,
    volume: null,
    sparkline: [],
  };
  const itemRow = { name: "Assassin's Favour", tabs: ['Dump'], qty: 1, chaosEach: 5, chaosTotal: 5, category: 'DivinationCard' };

  it('finds the same item from the same query in either one', () => {
    for (const query of ['assassins', "assassin's", 'ASSASSIN', 'favour']) {
      expect(matches(economyRow, query)).toBe(true);
      expect(matchesQuery(itemRow, query)).toBe(true);
    }
  });
});
