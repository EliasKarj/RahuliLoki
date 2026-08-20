/**
 * Reading poe.ninja's payloads: everything that turns a downloaded blob into numbers.
 *
 * It is split from priceService.ts because it is the half with no I/O in it. These functions
 * take a parsed body and return prices, icons, a divine rate, or nothing — no fetch, no store,
 * no clock — which is why they can be tested against recorded responses without a service
 * around them, and why four other modules can import a constant or a parser from here without
 * pulling in the fetching and caching machinery they have no use for.
 *
 * Everything here treats its input as hostile: the payload comes off the internet, and the one
 * value in it that reaches an `<img src>` is checked against an allowlist before it can.
 *
 * ## What the payload lost when poe.ninja redesigned it
 *
 * `lines[]` no longer carries a name, an icon, or the unique variant fields. A line is now an
 * id and a number. Three consequences, all of them losses, all of them worth stating plainly:
 *
 *   Names.  Handled by mapping the *stash item's* name to an id — see services/ninjaId.ts.
 *           That direction works; the reverse does not.
 *
 *   Icons.  Gone for everything except chaos and divine, the only two items the payload still
 *           names. The website has the rest baked into its JavaScript. Nothing is fabricated to
 *           fill the gap: an item with no icon simply shows none.
 *
 *   Uniques.  Not on this endpoint at all: every unique type answers 200 with zero lines. They
 *           live on the item endpoint instead, whose URL is DEFAULT_NINJA_ITEM_URL below. That
 *           payload is the old shape — names, prices, icons, and `links` — and it is parsed in
 *           services/uniques.ts rather than here, because reading it is inseparable from
 *           deciding which line prices a given item, which is that file's whole subject.
 */

/** One priced line. `id` is poe.ninja's identifier; there is no name on it any more. */
interface OverviewLine {
  id?: unknown;
  primaryValue?: unknown;
  /** Trade volume over poe.ninja's window, in the primary currency. */
  volumePrimaryValue?: unknown;
  /** poe.ninja's own recent history: a percentage series and its total move. */
  sparkline?: { totalChange?: unknown; data?: unknown } | unknown;
}

/**
 * What a line says about its own movement, beyond the number.
 *
 * poe.ninja publishes this and this app used to throw it away, which left the price list able
 * to say what something costs and nothing about whether that is a normal price for it. A value
 * with no trend beside it is the thing you check a second source for.
 *
 * All three are optional in the payload and null here when absent. Nothing is derived from
 * nothing: an item poe.ninja gives no history for is shown without one.
 */
export interface LineMeta {
  /** Percentage change across poe.ninja's own window. Null when it does not publish one. */
  change: number | null;
  /** Volume traded, in chaos. Not a price — a measure of how much the price is worth trusting. */
  volume: number | null;
  /** The series behind the change, as percentages from its own start. Empty when absent. */
  sparkline: number[];
}

/** The pricing pair and the exchange rates between them. */
interface CoreItem {
  id?: unknown;
  name?: unknown;
  image?: unknown;
  category?: unknown;
}

/**
 * poe.ninja serves its own images now, as paths relative to its origin.
 *
 * The old API pointed at GGG's CDN and this function only accepted poecdn.com hosts. That
 * allowlist would reject every icon the new API sends, so poe.ninja's own origin is accepted
 * too — and a relative path is resolved against it rather than passed through, because
 * `<img src="/gen/image/…">` in the dashboard would resolve against *our* origin and 404.
 *
 * The check itself stays strict for the same reason it existed: this value comes from a remote
 * payload and ends up in an `<img src>`, so a `javascript:` or `data:` URL, or any other host,
 * is not an icon.
 */
export function iconUrl(value: unknown, base = 'https://poe.ninja'): string | null {
  if (typeof value !== 'string' || value === '') return null;
  let parsed: URL;
  try {
    parsed = new URL(value, base);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  const host = parsed.hostname.toLowerCase();
  const allowed =
    host === 'web.poecdn.com' ||
    host.endsWith('.poecdn.com') ||
    host === 'poe.ninja' ||
    host.endsWith('.poe.ninja');
  return allowed ? parsed.toString() : null;
}

/**
 * Whether an icon is GGG's own artwork, off the CDN the game itself serves from.
 *
 * The stash gives one of these per item; poe.ninja gives its own for chaos and divine. Both are
 * loadable, but only one of them is the picture of the item being counted, so this is the tie
 * break in `rememberIcons`.
 */
export function fromGameCdn(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === 'poecdn.com' || host.endsWith('.poecdn.com');
  } catch {
    return false;
  }
}

export class PriceFetchError extends Error {}

export const DEFAULT_NINJA_URL = 'https://poe.ninja/poe1/api/economy/exchange/current';

/**
 * The other poe.ninja endpoint, and the one this project spent months concluding did not exist.
 *
 * `exchange/current` serves currency-like things: a line is an id and a number, with no name on
 * it, which is where "poe.ninja publishes no names any more" came from. That is true of that
 * endpoint. It is not true of this one.
 *
 * `stash/current/item` serves items, and its lines carry `name`, `baseType`, `chaosValue`,
 * `icon`, `listingCount` — and, on weapons and armour, `links`, the field whose absence made a
 * unique unpriceable here. Recorded by scripts/probe.mjs: 986 unique armours, 667 weapons, 364
 * accessories, 167 jewels and 39 flasks, every one of them named. No `corrupted` anywhere; see
 * services/uniques.ts for what follows from that.
 *
 * The conclusion in this repository was not wrong about what it saw. It was wrong about how much
 * it had looked at.
 */
export const DEFAULT_NINJA_ITEM_URL = 'https://poe.ninja/poe1/api/economy/stash/current/item';

/** poe.ninja's id for chaos, which every other price on the set is quoted in. */
export const CHAOS_ID = 'chaos';
export const DIVINE_ID = 'divine';

/** poe.ninja returns numbers as numbers, but a null or a string would silently become NaN. */
function finitePositive(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return value;
}

/** The `core.items` entries that carry both an id and a name, narrowed. */
export function coreItems(payload: unknown): Array<{ id: string; name: string; icon: string | null }> {
  const items = (payload as { core?: { items?: unknown } })?.core?.items;
  if (!Array.isArray(items)) return [];
  const out: Array<{ id: string; name: string; icon: string | null }> = [];
  for (const raw of items as CoreItem[]) {
    const id = typeof raw?.id === 'string' ? raw.id : null;
    const name = typeof raw?.name === 'string' ? raw.name : null;
    if (id === null || name === null) continue;
    out.push({ id, name, icon: iconUrl(raw?.image) });
  }
  return out;
}

/**
 * Merge one overview payload into `into`. Returns how many lines were usable.
 *
 * `core.primary` names the currency every `primaryValue` is quoted in. It is chaos in every
 * response seen so far, and this refuses to merge when it is not: silently treating divine-
 * denominated numbers as chaos would multiply the whole chart by about two hundred, and a
 * wealth chart that is wrong by a constant factor is harder to notice than one that is empty.
 */
export function mergeOverview(
  payload: unknown,
  into: Record<string, number>,
  icons: Record<string, string> = Object.create(null) as Record<string, string>,
  categories: Record<string, string> = Object.create(null) as Record<string, string>,
  category = '',
): number {
  const primary = (payload as { core?: { primary?: unknown } })?.core?.primary;
  if (typeof primary === 'string' && primary !== CHAOS_ID) {
    throw new PriceFetchError(
      `poe.ninja quoted this overview in "${primary}" rather than chaos; refusing to read the ` +
        'values as chaos',
    );
  }

  for (const item of coreItems(payload)) {
    // Keyed by display name, not by id: the breakdown a person reads is keyed by name, and so
    // is every icon lookup. Keying these by id meant even chaos and divine — the only two items
    // the API still names — never matched anything.
    if (item.icon !== null && icons[item.name] === undefined) icons[item.name] = item.icon;
  }

  const lines = (payload as { lines?: unknown })?.lines;
  if (!Array.isArray(lines)) return 0;

  let merged = 0;
  for (const raw of lines as OverviewLine[]) {
    const id = typeof raw?.id === 'string' && raw.id !== '' ? raw.id : null;
    const value = finitePositive(raw?.primaryValue);
    if (id === null || value === null) continue;
    // First category wins, matching the old behaviour: when two types carry the same id the
    // earlier (more specific) list is the one the operator put first on purpose.
    if (into[id] === undefined) into[id] = value;
    // Same first-wins rule as the price. An id that appears under two types belongs to the
    // earlier, more specific one — that is why the operator ordered the list the way they did.
    if (category !== '' && categories[id] === undefined) categories[id] = category;
    merged += 1;
  }
  return merged;
}

/**
 * The movement fields, per id.
 *
 * Separate from `mergeOverview` rather than a sixth and seventh output parameter of it: that
 * function already takes four maps to fill, and a price is the thing it must never get wrong,
 * while this is decoration around the price. They fail independently, so they are read
 * independently — a payload with a broken sparkline still yields correct prices.
 */
export function overviewMeta(payload: unknown): Record<string, LineMeta> {
  const out = Object.create(null) as Record<string, LineMeta>;
  const lines = (payload as { lines?: unknown })?.lines;
  if (!Array.isArray(lines)) return out;

  for (const raw of lines as OverviewLine[]) {
    const id = typeof raw?.id === 'string' && raw.id !== '' ? raw.id : null;
    if (id === null || out[id] !== undefined) continue;

    const spark = (raw.sparkline ?? null) as { totalChange?: unknown; data?: unknown } | null;
    const data = Array.isArray(spark?.data)
      ? (spark.data as unknown[]).filter((point): point is number => typeof point === 'number' && Number.isFinite(point))
      : [];

    const change = typeof spark?.totalChange === 'number' && Number.isFinite(spark.totalChange)
      ? spark.totalChange
      : null;
    const volume =
      typeof raw.volumePrimaryValue === 'number' && Number.isFinite(raw.volumePrimaryValue) && raw.volumePrimaryValue >= 0
        ? raw.volumePrimaryValue
        : null;

    // A line that carries none of the three is not recorded at all, so the map stays the size of
    // what poe.ninja actually published rather than of every id it priced.
    if (change === null && volume === null && data.length === 0) continue;
    out[id] = { change, volume, sparkline: data };
  }

  return out;
}

/**
 * Chaos per divine, from whichever of the two places the payload states it.
 *
 * `lines` carries a `divine` row priced in chaos, and `core.rates.divine` carries the inverse —
 * divine per chaos. They agree, so either will do, but reading both means a payload that drops
 * one still yields a rate instead of failing the whole fetch.
 */
export function divineRateFrom(payload: unknown, prices: Record<string, number>): number | null {
  const fromLines = finitePositive(prices[DIVINE_ID]);
  if (fromLines !== null) return fromLines;

  const rate = (payload as { core?: { rates?: Record<string, unknown> } })?.core?.rates?.[DIVINE_ID];
  const inverse = finitePositive(rate);
  return inverse === null ? null : 1 / inverse;
}

/**
 * poe.ninja ids that nothing in the stash resolved to.
 *
 * This is the feedback loop for the alias table in services/ninjaId.ts, which cannot be checked
 * against the payload because the payload has no names. An abbreviation we do not know about
 * shows up here as an id nothing claimed, which is a concrete thing to look up and add — rather
 * than a currency that quietly never gets counted.
 *
 * Slugs are excluded: an id containing a hyphen came from a name by rule, so its absence means
 * the account simply does not hold that item, which is not interesting. A short code is the
 * shape that indicates a gap.
 */
export function unmatchedIds(
  prices: Record<string, number>,
  resolved: ReadonlySet<string>,
  limit = 40,
): string[] {
  const missing: string[] = [];
  for (const id of Object.keys(prices)) {
    if (id.includes('-') || resolved.has(id)) continue;
    missing.push(id);
  }
  return missing.sort().slice(0, limit);
}

/** One line of an item overview: the old shape, which the exchange endpoint no longer serves. */
interface ItemLine {
  name?: unknown;
  icon?: unknown;
}

/**
 * The names and artwork on an item overview.
 *
 * This is the endpoint's whole value to the economy list. `exchange/current` answers with ids
 * and numbers — `{ "id": "alt", "primaryValue": 0.1238 }` — so a row's name has to be guessed
 * backwards from its id, and `hinekoras-lock` cannot say where the apostrophe belonged. The
 * item endpoint still answers the old way, with the name and the icon on every line.
 *
 * Pairing the two is what `ninjaId` is for: it turns poe.ninja's own name back into poe.ninja's
 * own id, which is the key the price came under. A name whose id nothing prices is kept anyway
 * and simply goes unused — the cost of a spare entry is nothing beside the cost of dropping a
 * name that a later league does price.
 */
export function itemOverviewNames(payload: unknown): Array<{ name: string; icon: string | null }> {
  const lines = (payload as { lines?: unknown })?.lines;
  if (!Array.isArray(lines)) return [];

  const out: Array<{ name: string; icon: string | null }> = [];
  for (const raw of lines as ItemLine[]) {
    const name = typeof raw?.name === 'string' ? raw.name.trim() : '';
    if (name === '') continue;
    // Validated, never trusted: this string ends up in an <img src>. See iconUrl.
    out.push({ name, icon: iconUrl(raw?.icon) });
  }
  return out;
}
