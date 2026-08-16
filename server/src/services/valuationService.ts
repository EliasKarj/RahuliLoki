/**
 * Items × prices → chaos total + per-tab breakdown.
 *
 * Name resolution is the hard part of this whole project. poe.ninja keys by display name;
 * a stash item carries `name`, `typeLine` and `baseType`, and which of those is the display
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
  }>;
}

export interface ValuationOptions {
  prices: Record<string, number>;
  divineRate: number;
  minItemChaos: number;
}

const FRAME_UNIQUE = 3;
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

/** Resolve to the name poe.ninja knows, or null when nothing matches. */
export function resolvePriceKey(
  item: ValuationInput['items'][number],
  prices: Record<string, number>,
): string | null {
  for (const candidate of priceKeyCandidates(item)) {
    if (Object.hasOwn(prices, candidate)) return candidate;
  }
  return null;
}

/** Two decimals is the resolution anyone reads a chaos value at. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function valueTabs(tabs: ValuationInput[], options: ValuationOptions): ValuationResult {
  const { prices, minItemChaos } = options;

  // Aggregate before applying the threshold. A hundred separate stacks of alterations are one
  // pile of alterations to the player, and thresholding each stack would throw the pile away.
  const aggregated = new Map<string, Map<string, { qty: number; chaosEach: number }>>();
  const unresolved = new Map<string, number>();
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

      const key = resolvePriceKey(item, prices);
      if (key === null) {
        const label = priceKeyCandidates(item)[0] ?? '(unnamed item)';
        unresolved.set(label, (unresolved.get(label) ?? 0) + 1);
        continue;
      }

      const chaosEach = prices[key] as number;
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
  /** poe.ninja's icon, when the current price set knows one for this name. */
  icon?: string;
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
): TopItem[] {
  const rows: TopItem[] = [];
  for (const [tab, entries] of Object.entries(breakdown)) {
    for (const [name, entry] of Object.entries(entries)) {
      const icon = Object.hasOwn(icons, name) ? icons[name] : undefined;
      rows.push({
        tab,
        name,
        qty: entry.qty,
        chaosEach: entry.chaosEach,
        chaosTotal: entry.chaosTotal,
        ...(icon === undefined ? {} : { icon }),
      });
    }
  }
  rows.sort((a, b) => b.chaosTotal - a.chaosTotal || a.name.localeCompare(b.name));
  return rows.slice(0, limit);
}
