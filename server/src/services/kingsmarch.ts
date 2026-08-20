/**
 * The uniques in a stash, as Kingsmarch sees them rather than as a wealth chart does.
 *
 * Disenchanting turns an item into Thaumaturgic Dust, and how much dust depends on the
 * individual item: its level and its quality. That is a different question from the one the
 * rest of this application asks. Valuation keys everything by name, because two copies of one
 * unique are one line on a chart — but at the bench they are two different decisions, and the
 * difference between them is exactly the fields the breakdown throws away.
 *
 * So this reads the tabs a poll already fetched and keeps what dust cares about. It costs no
 * extra request: the items were in hand anyway.
 *
 * ## What is deliberately not here
 *
 * The dust value itself. It scales with item level and quality, and this project has not
 * verified those numbers against anything — so there is no formula in this file, and no column
 * pretending to one. Everything a formula needs is captured and named; the formula arrives when
 * there is a source for it.
 */

import { FRAME_UNIQUE } from './valuationService.ts';
import type { StashItem, TabContents } from './stashService.ts';

export interface UniqueHolding {
  /** The unique's own name, e.g. "Tabula Rasa". */
  name: string;
  /** The base it is built on, e.g. "Simple Robe". */
  baseType: string;
  /** Which tab it sits in, so it can be found again. */
  tab: string;
  /** Item level. Null when GGG did not send one, which happens for a few item classes. */
  ilvl: number | null;
  /** Quality as a percentage. Zero, not null, when the item simply has none. */
  quality: number;
  corrupted: boolean;
  icon: string | null;
  /**
   * How many identical copies this row stands for.
   *
   * Identical means the same name, base, level, quality and corruption — everything dust reads.
   * A hundred Tabula Rasas of the same level are one decision, not a hundred rows of it.
   */
  count: number;
}

/**
 * Quality, out of GGG's display properties.
 *
 * The payload has no quality field; it has a list of rendered strings meant for a tooltip, in
 * which quality appears as `{ name: 'Quality', values: [['+20%', 1]] }`. Everything about that
 * is display formatting — the plus, the percent sign, the nesting — so it is parsed rather than
 * read, and anything unparseable is no quality rather than a guess at one.
 */
export function qualityOf(item: StashItem): number {
  for (const property of item.properties ?? []) {
    if (property?.name !== 'Quality') continue;
    const values = property.values;
    if (!Array.isArray(values)) continue;
    const first = values[0];
    const text = Array.isArray(first) ? first[0] : null;
    if (typeof text !== 'string') continue;
    const match = /(\d+)/.exec(text);
    if (match !== null) return Number(match[1]);
  }
  return 0;
}

/**
 * The key two copies have to share to be one row.
 *
 * Everything dust reads, and the tab. The tab is in here because the row promises you can find
 * the item again: without it, five copies split across two tabs collapse into one row naming
 * whichever tab happened to be read first, which is a row that sends you to the wrong place.
 */
function holdingKey(holding: Omit<UniqueHolding, 'count'>): string {
  return [
    holding.name,
    holding.baseType,
    holding.tab,
    holding.ilvl ?? '',
    holding.quality,
    holding.corrupted,
  ].join(' ');
}

/**
 * Every identified unique across the tabs, grouped.
 *
 * Unidentified uniques are left out. They cannot be named, so they cannot be priced or looked
 * up — and the rest of this application already refuses to value them for the same reason.
 */
export function uniqueHoldings(tabs: TabContents[]): UniqueHolding[] {
  const byKey = new Map<string, UniqueHolding>();

  for (const { tab, items } of tabs) {
    for (const item of items) {
      if (item.frameType !== FRAME_UNIQUE) continue;
      if (item.identified === false) continue;

      // On a unique, `name` is the unique's own name and `baseType` is what it is built on. An
      // empty name means GGG sent something this code does not understand, and inventing one
      // would put a row in the table that matches nothing.
      const name = typeof item.name === 'string' ? item.name.trim() : '';
      if (name === '') continue;

      const holding: Omit<UniqueHolding, 'count'> = {
        name,
        baseType: (item.baseType ?? item.typeLine ?? '').trim(),
        tab: tab.name,
        ilvl: typeof item.ilvl === 'number' && Number.isFinite(item.ilvl) ? item.ilvl : null,
        quality: qualityOf(item),
        corrupted: item.corrupted === true,
        icon: typeof item.icon === 'string' && item.icon !== '' ? item.icon : null,
      };

      const key = holdingKey(holding);
      const seen = byKey.get(key);
      if (seen === undefined) byKey.set(key, { ...holding, count: 1 });
      else seen.count += 1;
    }
  }

  // Most copies first, then by name, so the list opens on the piles rather than on the oddities.
  return [...byKey.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}
