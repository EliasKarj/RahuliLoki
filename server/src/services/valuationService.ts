/**
 * Items × prices → chaos total + per-tab breakdown.
 *
 * Name resolution is the hard part of this whole project, and it got harder when poe.ninja
 * stopped publishing display names. The price map is now keyed by poe.ninja's own identifier,
 * so resolution runs in two steps: work out the item's display name, then turn that name into
 * an id with `ninjaId()`. The breakdown is still keyed by the *display name*, because that is
 * what a person reads and because the stash is a better source for it than poe.ninja ever was.
 *
 * A stash item carries `name`, `typeLine` and `baseType`, and which of those is the display
 * name depends on what kind of item it is:
 *
 *   currency, fragments, scarabs, essences…  baseType === typeLine === the poe.ninja name
 *   divination cards                         typeLine is the card name
 *   uniques                                  `name` is the unique, `baseType` is the base
 *
 * Categories whose value depends on more than a name — gems (level/quality/corruption), maps
 * (tier), clusters (passive count) — are skipped outright rather than valued wrongly. They are
 * counted separately so the skip is visible instead of looking like missing wealth.
 *
 * Everything that resolves to no price at all is returned in `unresolved` and logged by the
 * caller. A silent zero is the failure mode this design exists to avoid.
 */

import { ninjaId } from './ninjaId.ts';
import { iconUrl } from './ninjaPayload.ts';
import { linkCount, pickCandidate, uniqueKey, type UniqueIndex } from './uniques.ts';

export interface ValuedEntry {
  qty: number;
  chaosEach: number;
  chaosTotal: number;
}

/** { [tabName]: { [itemName]: { qty, chaosEach, chaosTotal } } } */
export type Breakdown = Record<string, Record<string, ValuedEntry>>;

export interface UnresolvedItem {
  name: string;
  count: number;
}

export interface ValuationResult {
  breakdown: Breakdown;
  totalChaos: number;
  totalDivine: number;
  /** Units of valued items — a stack of 500 alterations counts as 500. */
  itemCount: number;
  unresolved: UnresolvedItem[];
  /**
   * The poe.ninja ids that items in the stash actually matched.
   *
   * Fed to `unmatchedIds` by the poller. Since the price payload carries no names, an id that
   * nothing ever matches is the only visible symptom of a missing entry in the alias table —
   * see services/ninjaId.ts.
   */
  matchedIds: Set<string>;
  /**
   * Display name → the item's artwork on GGG's CDN, for the items that were priced.
   *
   * Collected here because this is the only place that holds both halves at once: the stash item
   * carries the icon, and this is where it becomes a named row in the breakdown. poe.ninja used
   * to supply these and no longer does — see StashItem.icon.
   */
  icons: Record<string, string>;
  /** Items in a category we deliberately do not price. */
  skipped: number;
  /** Aggregated entries that fell under MIN_ITEM_CHAOS. */
  droppedBelowThreshold: number;
  droppedChaos: number;
}

export interface ValuationInput {
  tab: { name: string };
  items: Array<{
    typeLine?: string;
    baseType?: string;
    name?: string;
    stackSize?: number;
    frameType?: number;
    identified?: boolean;
    corrupted?: boolean;
    /** GGG's artwork for this item. The source of every icon the dashboard shows. */
    icon?: string;
    sockets?: Array<{ group?: unknown }>;
  }>;
}

export interface ValuationOptions {
  prices: Record<string, number>;
  divineRate: number;
  minItemChaos: number;
  /** Per-variant unique lines. Omit to price uniques by name only, as before. */
  uniques?: UniqueIndex;
}

export const FRAME_UNIQUE = 3;
const FRAME_GEM = 4;
const FRAME_DIVINATION = 6;

/** GGG prefixes localised names with markup like `<<set:MS>><<set:M>><<set:S>>`. */
export function stripNameMarkup(value: string): string {
  return value.replace(/^(?:<<[^>]*>>)+/, '').trim();
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = stripNameMarkup(value);
  return cleaned.length > 0 ? cleaned : null;
}

export type SkipReason = 'gem' | 'map' | 'cluster-jewel' | 'unidentified-unique';

/** Categories whose price is not a function of the name alone. */
export function skipReason(item: ValuationInput['items'][number]): SkipReason | null {
  if (item.frameType === FRAME_GEM) return 'gem';

  const base = text(item.baseType) ?? text(item.typeLine);
  if (base !== null) {
    if (/\bMap$/i.test(base)) return 'map';
    if (/Cluster Jewel$/i.test(base)) return 'cluster-jewel';
  }
  if (item.frameType === FRAME_UNIQUE && item.identified === false) return 'unidentified-unique';
  return null;
}

/**
 * The candidate display names for an item, most specific first. Uniques lead with `name` so a
 * Headhunter is never valued as a Leather Belt; everything else leads with the base type.
 */
export function priceKeyCandidates(item: ValuationInput['items'][number]): string[] {
  const name = text(item.name);
  const typeLine = text(item.typeLine);
  const baseType = text(item.baseType);

  const ordered =
    item.frameType === FRAME_UNIQUE
      ? [name, baseType, typeLine]
      : item.frameType === FRAME_DIVINATION
        ? [typeLine, baseType, name]
        : [baseType, typeLine, name];

  const seen = new Set<string>();
  const candidates: string[] = [];
  for (const candidate of ordered) {
    if (candidate === null || seen.has(candidate)) continue;
    seen.add(candidate);
    candidates.push(candidate);
  }
  return candidates;
}

/**
 * Resolve an item to its display name and chaos value, or null when poe.ninja prices nothing
 * this item could be.
 *
 * The returned `name` is the stash's display name and the returned `id` is what poe.ninja filed
 * the price under. Both are handed back because they are needed in different places: the name
 * keys the breakdown a person reads, the id feeds `unmatchedIds` so a missing alias is
 * detectable.
 */
export function resolvePrice(
  item: ValuationInput['items'][number],
  prices: Record<string, number>,
): { name: string; id: string; chaos: number } | null {
  for (const candidate of priceKeyCandidates(item)) {
    const id = ninjaId(candidate);
    if (id !== '' && Object.hasOwn(prices, id)) {
      return { name: candidate, id, chaos: prices[id] as number };
    }
  }
  return null;
}

/** Two decimals is the resolution anyone reads a chaos value at. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Price one unique against the variant index, or null when it is not a unique / has no line.
 *
 * The returned key carries the links and corruption so the breakdown keeps a 6-linked item
 * apart from a plain one — merging them would hide the whole reason a number moved.
 */
export function resolveUnique(
  item: ValuationInput['items'][number],
  uniques: UniqueIndex,
): { key: string; chaos: number } | null {
  if (item.frameType !== FRAME_UNIQUE) return null;
  const name = text(item.name);
  if (name === null || !Object.hasOwn(uniques, name)) return null;

  const links = linkCount(item.sockets);
  const corrupted = item.corrupted === true;
  const picked = pickCandidate(uniques[name] ?? [], links, corrupted);
  if (picked === null) return null;

  // The key describes the *item*, not the line that priced it. A corrupted 6-link is its own
  // row in the breakdown even when the line behind the number was an uncorrupted one, because
  // the row is the player's holding and the approximation belongs to the price, not the item.
  return { key: uniqueKey(name, links, corrupted), chaos: picked.price.chaos };
}

export function valueTabs(tabs: ValuationInput[], options: ValuationOptions): ValuationResult {
  const { prices, minItemChaos, uniques } = options;

  // Aggregate before applying the threshold. A hundred separate stacks of alterations are one
  // pile of alterations to the player, and thresholding each stack would throw the pile away.
  const aggregated = new Map<string, Map<string, { qty: number; chaosEach: number }>>();
  const unresolved = new Map<string, number>();
  const matchedIds = new Set<string>();
  // Null-prototype for the same reason the breakdown is: the keys are item names out of a
  // remote payload.
  const icons: Record<string, string> = Object.create(null) as Record<string, string>;
  let skipped = 0;

  for (const { tab, items } of tabs) {
    let perTab = aggregated.get(tab.name);
    if (!perTab) {
      perTab = new Map();
      aggregated.set(tab.name, perTab);
    }

    for (const item of items) {
      if (skipReason(item) !== null) {
        skipped += 1;
        continue;
      }

      // Uniques take the variant-aware path: the same name is several prices depending on
      // links and corruption, so the flat name map cannot answer for them.
      const unique = uniques === undefined ? null : resolveUnique(item, uniques);

      const priced = unique === null ? resolvePrice(item, prices) : null;
      const key = unique?.key ?? priced?.name ?? null;
      if (key === null) {
        const label = priceKeyCandidates(item)[0] ?? '(unnamed item)';
        unresolved.set(label, (unresolved.get(label) ?? 0) + 1);
        continue;
      }
      if (priced !== null) matchedIds.add(priced.id);

      // Validated rather than trusted: this string comes from a remote payload and ends up in an
      // <img src>. First one wins — every copy of an item carries the same artwork.
      if (icons[key] === undefined) {
        const icon = iconUrl(item.icon);
        if (icon !== null) icons[key] = icon;
      }

      const chaosEach = unique?.chaos ?? (priced?.chaos as number);
      const qty =
        typeof item.stackSize === 'number' && Number.isFinite(item.stackSize) && item.stackSize > 0
          ? Math.floor(item.stackSize)
          : 1;

      const existing = perTab.get(key);
      if (existing) existing.qty += qty;
      else perTab.set(key, { qty, chaosEach });
    }
  }

  // Null-prototype: the keys here are stash tab names and item names. A player can name a tab
  // `__proto__`, and on an ordinary object literal that assignment replaces the prototype
  // instead of adding a tab — the tab then vanishes from every chart that reads the breakdown.
  const breakdown: Breakdown = Object.create(null) as Breakdown;
  let totalChaos = 0;
  let itemCount = 0;
  let droppedBelowThreshold = 0;
  let droppedChaos = 0;

  for (const [tabName, entries] of aggregated) {
    const kept: Record<string, ValuedEntry> = Object.create(null) as Record<string, ValuedEntry>;
    for (const [name, { qty, chaosEach }] of entries) {
      const chaosTotal = round2(qty * chaosEach);
      if (chaosTotal < minItemChaos) {
        droppedBelowThreshold += 1;
        droppedChaos += chaosTotal;
        continue;
      }
      kept[name] = { qty, chaosEach: round2(chaosEach), chaosTotal };
      totalChaos += chaosTotal;
      itemCount += qty;
    }
    // A tracked tab that values to nothing still belongs in the breakdown: the stacked area
    // chart needs the zero, otherwise the series silently changes shape.
    breakdown[tabName] = kept;
  }

  totalChaos = round2(totalChaos);
  const totalDivine = options.divineRate > 0 ? round2(totalChaos / options.divineRate) : 0;

  return {
    breakdown,
    totalChaos,
    totalDivine,
    itemCount,
    unresolved: [...unresolved.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    matchedIds,
    icons,
    skipped,
    droppedBelowThreshold,
    droppedChaos: round2(droppedChaos),
  };
}

/** Per-tab chaos totals — what the stacked-area chart needs, without the item detail. */
export function tabTotals(breakdown: Breakdown): Record<string, number> {
  const totals: Record<string, number> = Object.create(null) as Record<string, number>;
  for (const [tabName, entries] of Object.entries(breakdown)) {
    let sum = 0;
    for (const entry of Object.values(entries)) sum += entry.chaosTotal;
    totals[tabName] = round2(sum);
  }
  return totals;
}

export interface TopItem {
  tab: string;
  name: string;
  qty: number;
  chaosEach: number;
  chaosTotal: number;
  /** GGG's artwork for this item, when a poll has seen one. */
  icon?: string;
  /**
   * The poe.ninja category this item was priced under — `Currency`, `Scarab`, `DivinationCard`.
   *
   * Absent when nothing priced it, which is why the dashboard files those under "Other" rather
   * than pretending they belong somewhere.
   */
  category?: string;
}

/**
 * The latest snapshot's biggest holdings, flattened across tabs.
 *
 * `icons` is joined in here rather than stored on the snapshot: the breakdown is written once
 * per poll and read rarely, while an icon URL is the same string every time. Looking it up at
 * read time also means an item that only got an icon later picks one up without a rewrite.
 */
export function topItems(
  breakdown: Breakdown,
  limit = 100,
  icons: Record<string, string> = {},
  /** poe.ninja id → category. Keyed by id, so the join goes through `ninjaId` — see below. */
  categories: Record<string, string> = {},
): TopItem[] {
  const rows: TopItem[] = [];
  for (const [tab, entries] of Object.entries(breakdown)) {
    for (const [name, entry] of Object.entries(entries)) {
      const icon = Object.hasOwn(icons, name) ? icons[name] : undefined;
      // Icons are keyed by display name and categories by poe.ninja's id, because that is how
      // each was collected: icons from the stash, which names things, and categories from the
      // request, which does not. The name has to go back through `ninjaId` to find one.
      const id = ninjaId(name);
      const category = Object.hasOwn(categories, id) ? categories[id] : undefined;
      rows.push({
        tab,
        name,
        qty: entry.qty,
        chaosEach: entry.chaosEach,
        chaosTotal: entry.chaosTotal,
        ...(icon === undefined ? {} : { icon }),
        ...(category === undefined ? {} : { category }),
      });
    }
  }
  rows.sort((a, b) => b.chaosTotal - a.chaosTotal || a.name.localeCompare(b.name));
  return rows.slice(0, limit);
}
