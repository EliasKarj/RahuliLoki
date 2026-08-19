import { describe, expect, it } from 'vitest';
import {
  UNCATEGORISED,
  categoryLabel,
  categoryTotals,
  groupByItem,
  matchesQuery,
  sortItemRows,
} from '../src/lib/items.ts';
import type { TopItem } from '../src/lib/api.ts';

const item = (over: Partial<TopItem>): TopItem => ({
  tab: 'Currency',
  name: 'Chaos Orb',
  qty: 10,
  chaosEach: 1,
  chaosTotal: 10,
  ...over,
});

describe('groupByItem', () => {
  it('folds the same item across tabs into one row', () => {
    // The breakdown is per tab, so one pile of chaos spread over three tabs arrives as three
    // rows. To a player that is one pile — the split is an accident of storage.
    const rows = groupByItem([
      item({ tab: 'Currency', qty: 1000, chaosTotal: 1000 }),
      item({ tab: 'Dump', qty: 530, chaosTotal: 530 }),
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.qty).toBe(1530);
    expect(rows[0]?.chaosTotal).toBe(1530);
    expect(rows[0]?.tabs).toEqual(['Currency', 'Dump']);
  });

  it('keeps the unit price rather than adding it up', () => {
    // Every copy of an item is priced identically, so summing "each" would be nonsense.
    const rows = groupByItem([
      item({ tab: 'A', chaosEach: 198, qty: 30, chaosTotal: 5940 }),
      item({ tab: 'B', chaosEach: 198, qty: 28, chaosTotal: 5544 }),
    ]);
    expect(rows[0]?.chaosEach).toBe(198);
  });

  it('does not list the same tab twice', () => {
    const rows = groupByItem([item({ tab: 'A' }), item({ tab: 'A' })]);
    expect(rows[0]?.tabs).toEqual(['A']);
  });

  it('picks up an icon from whichever copy carried one', () => {
    const rows = groupByItem([
      item({ tab: 'A' }),
      item({ tab: 'B', icon: 'https://web.poecdn.com/chaos.png' }),
    ]);
    expect(rows[0]?.icon).toBe('https://web.poecdn.com/chaos.png');
  });

  it('keeps different items apart', () => {
    const rows = groupByItem([item({}), item({ name: 'Divine Orb' })]);
    expect(rows.map((row) => row.name).sort()).toEqual(['Chaos Orb', 'Divine Orb']);
  });
});

describe('matchesQuery', () => {
  const rows = groupByItem([item({ name: "Assassin's Favour", tab: 'KORTTEJA' })]);
  const row = rows[0] as NonNullable<(typeof rows)[number]>;

  it('ignores case', () => {
    expect(matchesQuery(row, 'assassin')).toBe(true);
    expect(matchesQuery(row, 'ASSASSIN')).toBe(true);
  });

  it('ignores punctuation, so an apostrophe is not a trap', () => {
    expect(matchesQuery(row, 'assassins')).toBe(true);
  });

  it('searches the tab name too', () => {
    expect(matchesQuery(row, 'kortteja')).toBe(true);
  });

  it('matches everything on an empty query', () => {
    expect(matchesQuery(row, '   ')).toBe(true);
  });

  it('says no when it means no', () => {
    expect(matchesQuery(row, 'headhunter')).toBe(false);
  });
});

describe('sortItemRows', () => {
  const rows = groupByItem([
    item({ name: 'Chaos Orb', chaosTotal: 1530, qty: 1530 }),
    item({ name: 'Divine Orb', chaosTotal: 11500, qty: 58 }),
  ]);

  it('sorts by value, largest first', () => {
    expect(sortItemRows(rows, 'chaosTotal', 'desc').map((row) => row.name)).toEqual([
      'Divine Orb',
      'Chaos Orb',
    ]);
  });

  it('reverses on ascending', () => {
    expect(sortItemRows(rows, 'chaosTotal', 'asc')[0]?.name).toBe('Chaos Orb');
  });

  it('sorts names alphabetically rather than by their numbers', () => {
    expect(sortItemRows(rows, 'name', 'asc').map((row) => row.name)).toEqual([
      'Chaos Orb',
      'Divine Orb',
    ]);
  });

  it('leaves the input untouched', () => {
    const before = rows.map((row) => row.name);
    sortItemRows(rows, 'name', 'desc');
    expect(rows.map((row) => row.name)).toEqual(before);
  });
});

describe('categoryTotals', () => {
  const rows = groupByItem([
    item({ name: 'Chaos Orb', chaosTotal: 4130, category: 'Currency' }),
    item({ name: 'Divine Orb', chaosTotal: 9020, category: 'Currency' }),
    item({ name: 'Gilded Bestiary Scarab', chaosTotal: 288, category: 'Scarab' }),
    item({ name: 'Headhunter', chaosTotal: 12500 }),
  ]);

  it('sums each category and puts the largest first', () => {
    // The total is the whole point: "Scarab" alone is a filter, "Scarab 288c" is an answer.
    const totals = categoryTotals(rows);
    expect(totals[0]).toEqual({ category: 'Currency', chaos: 13150 });
    expect(totals[1]).toEqual({ category: 'Scarab', chaos: 288 });
  });

  it('files an item with no category under Other', () => {
    // Nothing priced it — a unique, most often. Putting it in a real category would be a claim
    // the data does not support.
    const totals = categoryTotals(rows);
    expect(totals.find((entry) => entry.category === UNCATEGORISED)?.chaos).toBe(12500);
  });

  it('keeps Other last however much it is worth', () => {
    // It is a leftover pile, not a category. Letting 12500c head the list would suggest it
    // means something.
    expect(categoryTotals(rows).at(-1)?.category).toBe(UNCATEGORISED);
  });

  it('returns nothing for no rows rather than a lone empty chip', () => {
    expect(categoryTotals([])).toEqual([]);
  });
});

describe('categoryLabel', () => {
  it('spaces out the PascalCase poe.ninja uses', () => {
    expect(categoryLabel('DivinationCard')).toBe('Divination Card');
    expect(categoryLabel('DeliriumOrb')).toBe('Delirium Orb');
  });

  it('leaves a single word alone', () => {
    expect(categoryLabel('Scarab')).toBe('Scarab');
    expect(categoryLabel('Other')).toBe('Other');
  });
});
