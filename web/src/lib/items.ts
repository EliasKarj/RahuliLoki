/**
 * The item table's data, without the table.
 *
 * Folding per-tab rows into one row per item, filing them under a category, sorting and
 * searching them: none of it needs a DOM, and all of it is what the table's tests are actually
 * about. It lived inside the component file, which meant the tests imported a module that pulls
 * in Recharts to check that two stacks of chaos add up.
 */

import type { TopItem } from './api.ts';
import type { SortDirection } from './series.ts';
import { looseIncludes } from './search.ts';

/**
 * One row of the items table: an item, wherever it sits.
 *
 * The snapshot's breakdown is per tab, so the same currency in three tabs arrives as three
 * rows. To a player that is one pile — the split is an accident of storage, not a fact about
 * their wealth — so the rows are folded together here and the tabs become a column, the way
 * every stash tracker worth using shows it.
 */
export interface ItemRow {
  name: string;
  tabs: string[];
  qty: number;
  chaosEach: number;
  chaosTotal: number;
  icon?: string;
  category: string;
}

/** What an item with no category is filed under. Not a category poe.ninja has. */
export const UNCATEGORISED = 'Other';

export function groupByItem(items: TopItem[]): ItemRow[] {
  const byName = new Map<string, ItemRow>();
  for (const item of items) {
    const row = byName.get(item.name);
    if (row === undefined) {
      byName.set(item.name, {
        name: item.name,
        tabs: [item.tab],
        qty: item.qty,
        chaosTotal: item.chaosTotal,
        chaosEach: item.chaosEach,
        category: item.category ?? UNCATEGORISED,
        ...(item.icon === undefined ? {} : { icon: item.icon }),
      });
      continue;
    }
    row.qty += item.qty;
    row.chaosTotal = Math.round((row.chaosTotal + item.chaosTotal) * 100) / 100;
    if (!row.tabs.includes(item.tab)) row.tabs.push(item.tab);
    // Unit price does not add up. Keeping the one already recorded is right: every copy of an
    // item is priced identically, so the tabs cannot disagree.
    if (row.icon === undefined && item.icon !== undefined) row.icon = item.icon;
  }
  return [...byName.values()];
}


export type SortKey = 'name' | 'tabs' | 'qty' | 'chaosEach' | 'chaosTotal';

export function sortItemRows(rows: ItemRow[], key: SortKey, direction: SortDirection): ItemRow[] {
  const sign = direction === 'desc' ? -1 : 1;
  return [...rows].sort((a, b) => {
    if (key === 'name') return sign * a.name.localeCompare(b.name);
    if (key === 'tabs') return sign * a.tabs.join(', ').localeCompare(b.tabs.join(', '));
    return sign * (a[key] - b[key]);
  });
}

/**
 * Each category present, with what it is worth, largest first.
 *
 * The totals are the point. "Scarab" on its own is a filter; "Scarab 3.2kc" answers the
 * question that made someone reach for the filter in the first place.
 */
export function categoryTotals(rows: ItemRow[]): Array<{ category: string; chaos: number }> {
  const totals = new Map<string, number>();
  for (const row of rows) {
    totals.set(row.category, (totals.get(row.category) ?? 0) + row.chaosTotal);
  }
  return [...totals.entries()]
    .map(([category, chaos]) => ({ category, chaos: Math.round(chaos * 100) / 100 }))
    // Uncategorised last whatever it is worth: it is a leftover pile, not a category, and
    // letting it head the list would suggest it means something.
    .sort((a, b) => {
      if (a.category === UNCATEGORISED) return 1;
      if (b.category === UNCATEGORISED) return -1;
      return b.chaos - a.chaos;
    });
}

/** Case- and punctuation-insensitive, so "assassins" finds "Assassin's Favour". */
export function matchesQuery(row: ItemRow, query: string): boolean {
  return looseIncludes(`${row.name} ${row.tabs.join(' ')}`, query);
}
