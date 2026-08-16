/**
 * poe.ninja prices, merged into one flat `id → chaosValue` map.
 *
 * ## The API this talks to, and the one it used to
 *
 * poe.ninja replaced its economy API. The old one lived at `/api/data/` with two endpoints,
 * `currencyoverview` and `itemoverview`, and keyed every line by display name. It is gone: the
 * whole path answers `not found`, because that URL predates poe.ninja serving two games and
 * carries nothing to say which one is meant.
 *
 * The replacement is one endpoint per game:
 *
 *   https://poe.ninja/poe1/api/economy/exchange/current/overview?league=<league>&type=<type>
 *
 * `league` is GGG's own league name, unchanged — `Allflame`, `Hardcore Allflame`. The old
 * worry that poe.ninja kept its own league vocabulary turned out not to apply here.
 *
 * ## What changed in the payload, and what it costs
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
 *   Uniques.  `links` and `corrupted` are no longer in the payload, so the per-variant index
 *           this project built in order to stop valuing a 6-linked Bronn's Lithe as a plain one
 *           cannot be built. Uniques are therefore left unpriced and appear in `unresolved`
 *           rather than being valued by name — see DEFAULT_UNIQUE_CATEGORIES in lib/config.ts.
 *
 * ## What did not change
 *
 * Caching is still two-tier: an in-memory set refetched past its TTL, and a row per fetch in
 * the database so a restart does not refetch immediately. If poe.ninja is unreachable but an
 * older set is held, the poll continues with it rather than losing the interval — `priceSetAt`
 * on the snapshot records how old the prices were, so the staleness is visible rather than
 * hidden.
 */

import { describeError, silentLogger, type Logger } from '../lib/logger.ts';
import { readJsonCapped, timeoutSignal } from '../lib/http.ts';
import { ninjaId, verifyAliases } from './ninjaId.ts';
import { mergeUniqueOverview, uniqueKey, type UniqueIndex } from './uniques.ts';

export interface PriceSet {
  league: string;
  fetchedAt: Date;
  /**
   * Flat poe.ninja id → chaos value. Always contains "chaos": 1.
   *
   * Keyed by id rather than display name because that is what the API now returns. Callers hold
   * a display name and go through `ninjaId()`; see services/valuationService.ts.
   */
  prices: Record<string, number>;
  /** Chaos per divine. */
  divineRate: number;
  /**
   * poe.ninja id → icon URL, for the ids it gave one.
   *
   * Nearly empty against the current API, which names only chaos and divine. Kept because the
   * shape is right and costs nothing, and because the alternative — deleting the feature — would
   * have to be undone if poe.ninja starts sending icons again.
   */
  icons: Record<string, string>;
  /**
   * Unique lines kept per name, not flattened into `prices`.
   *
   * Empty against the current API, which no longer publishes the variant fields. The structure
   * stays because the valuation path branches on it and an empty index is the correct way to
   * say "nothing here can be priced per variant".
   */
  uniques: UniqueIndex;
}

export interface PriceSetStore {
  latest(league: string): Promise<PriceSet | null>;
  save(set: PriceSet): Promise<void>;
}

/** One priced line. `id` is poe.ninja's identifier; there is no name on it any more. */
interface OverviewLine {
  id?: unknown;
  primaryValue?: unknown;
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

export interface PriceServiceOptions {
  league: string;
  /**
   * poe.ninja `type=` values. One endpoint serves them all now, so the old split between
   * currency and item categories is only kept because it is what the environment already
   * spells; the two lists are concatenated here.
   */
  currencyCategories: string[];
  itemCategories: string[];
  /** Unique types. Left unpriced against the current API — see the module comment. */
  uniqueCategories?: string[];
  ttlMs: number;
  store: PriceSetStore;
  fetchFn?: typeof fetch;
  now?: () => number;
  log?: Logger;
  userAgent?: string;
  baseUrl?: string;
  /** Ceiling on one overview request. Without it a hung poe.ninja never releases the poll. */
  timeoutMs?: number;
  maxBytes?: number;
}

export class PriceFetchError extends Error {}

export const DEFAULT_NINJA_URL = 'https://poe.ninja/poe1/api/economy/exchange/current';

/** poe.ninja's id for chaos, which every other price on the set is quoted in. */
export const CHAOS_ID = 'chaos';
const DIVINE_ID = 'divine';

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
): number {
  const primary = (payload as { core?: { primary?: unknown } })?.core?.primary;
  if (typeof primary === 'string' && primary !== CHAOS_ID) {
    throw new PriceFetchError(
      `poe.ninja quoted this overview in "${primary}" rather than chaos; refusing to read the ` +
        'values as chaos',
    );
  }

  for (const item of coreItems(payload)) {
    if (item.icon !== null && icons[item.id] === undefined) icons[item.id] = item.icon;
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
    merged += 1;
  }
  return merged;
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

export class PriceService {
  readonly #options: PriceServiceOptions;
  readonly #fetch: typeof fetch;
  readonly #now: () => number;
  readonly #log: Logger;
  readonly #baseUrl: string;
  #cached: PriceSet | null = null;
  /** Collapses concurrent callers onto one refetch. */
  #inFlight: Promise<PriceSet> | null = null;

  constructor(options: PriceServiceOptions) {
    this.#options = options;
    this.#fetch = options.fetchFn ?? globalThis.fetch;
    this.#now = options.now ?? Date.now;
    this.#log = options.log ?? silentLogger;
    this.#baseUrl = options.baseUrl ?? DEFAULT_NINJA_URL;
  }

  /** Load the newest persisted set at boot so a restart does not force a refetch. */
  async hydrate(): Promise<PriceSet | null> {
    const stored = await this.#options.store.latest(this.#options.league);
    if (!stored) return null;

    // Rows written before the API change are keyed by display name ("Chaos Orb") rather than
    // by id ("chaos"). Nothing would match against them and every item would read as unpriced,
    // so an old row is discarded rather than restored. No migration: the next fetch replaces it,
    // and a price set is a cache, not history.
    if (!Object.hasOwn(stored.prices, CHAOS_ID)) {
      this.#log.info(
        { fetchedAt: stored.fetchedAt.toISOString() },
        'discarding a price set written against the old poe.ninja API; it will be refetched',
      );
      return null;
    }

    this.#cached = stored;
    this.#log.info(
      { fetchedAt: stored.fetchedAt.toISOString(), prices: Object.keys(stored.prices).length },
      'restored price set from the database',
    );
    return stored;
  }

  get cached(): PriceSet | null {
    return this.#cached;
  }

  isStale(set: PriceSet | null = this.#cached): boolean {
    if (!set) return true;
    return this.#now() - set.fetchedAt.getTime() >= this.#options.ttlMs;
  }

  /** The set to value a snapshot with. Refetches only once the TTL has passed. */
  async getPrices(options: { force?: boolean } = {}): Promise<PriceSet> {
    if (!options.force && !this.isStale()) return this.#cached as PriceSet;
    if (this.#inFlight) return this.#inFlight;

    this.#inFlight = this.#refresh().finally(() => {
      this.#inFlight = null;
    });
    return this.#inFlight;
  }

  async #refresh(): Promise<PriceSet> {
    try {
      const set = await this.#fetchAll();
      this.#cached = set;
      await this.#options.store.save(set);
      return set;
    } catch (error) {
      if (this.#cached) {
        const ageMinutes = Math.round((this.#now() - this.#cached.fetchedAt.getTime()) / 60_000);
        this.#log.warn(
          { err: error, ageMinutes },
          'poe.ninja refetch failed; continuing with the previous price set',
        );
        return this.#cached;
      }
      throw error;
    }
  }

  async #fetchAll(): Promise<PriceSet> {
    const { league, currencyCategories, itemCategories } = this.#options;
    // Null-prototype: every key here comes straight out of a remote payload. On a normal object
    // `prices['toString']` is a function rather than undefined, so the "have I seen this id
    // already" check would silently discard a real price — and `prices['__proto__'] = …` would
    // reassign the prototype instead of storing anything.
    const prices: Record<string, number> = Object.create(null) as Record<string, number>;
    const icons: Record<string, string> = Object.create(null) as Record<string, string>;
    const uniques: UniqueIndex = Object.create(null) as UniqueIndex;

    let divineRate: number | null = null;

    for (const type of [...currencyCategories, ...itemCategories]) {
      const payload = await this.#getJson(league, type);
      const merged = mergeOverview(payload, prices, icons);
      divineRate ??= divineRateFrom(payload, prices);
      this.#log.debug({ type, merged }, 'merged overview');

      // Only chaos and divine are named, so this can check little — but those two are what every
      // other price is quoted in, and an error there would be an error everywhere.
      const problems = verifyAliases(coreItems(payload));
      if (problems.length > 0) {
        this.#log.warn(
          { problems },
          'poe.ninja names an item differently than the alias table expects; prices for it may ' +
            'be missing. Please report this.',
        );
      }
    }

    // Uniques still go through the variant-aware path rather than the flat map. The current API
    // publishes no variant fields, so this yields nothing and uniques stay unpriced — which is
    // the intended outcome, not a bug. Valuing them by name alone is the failure this avoids.
    for (const type of this.#options.uniqueCategories ?? []) {
      const payload = await this.#getJson(league, type);
      const merged = mergeUniqueOverview(payload, uniques, iconUrl);
      this.#log.debug({ type, merged }, 'merged unique overview');
    }

    for (const entries of Object.values(uniques)) {
      for (const entry of entries) {
        if (entry.icon === null) continue;
        const key = uniqueKey(entry.name, entry.links, entry.corrupted);
        if (icons[key] === undefined) icons[key] = entry.icon;
      }
    }

    // Chaos prices itself at one. The payload does carry a `chaos` line, but asserting it here
    // means a response that omits it cannot produce a set where chaos is unpriced.
    prices[CHAOS_ID] = 1;

    if (divineRate === null) {
      throw new PriceFetchError(
        `poe.ninja returned no divine rate for league "${league}"; refusing to value a snapshot ` +
          'without one',
      );
    }

    const set: PriceSet = {
      league,
      fetchedAt: new Date(this.#now()),
      prices,
      divineRate,
      icons,
      uniques,
    };
    this.#log.info(
      {
        league,
        entries: Object.keys(prices).length,
        uniques: Object.keys(uniques).length,
        icons: Object.keys(icons).length,
        divineRate,
      },
      'fetched a fresh price set',
    );
    return set;
  }

  async #getJson(league: string, type: string): Promise<unknown> {
    const url =
      `${this.#baseUrl}/overview?league=${encodeURIComponent(league)}` +
      `&type=${encodeURIComponent(type)}`;
    const response = await this.#fetch(url, {
      headers: {
        accept: 'application/json',
        ...(this.#options.userAgent ? { 'user-agent': this.#options.userAgent } : {}),
      },
      signal: timeoutSignal(this.#options.timeoutMs ?? 30_000),
    });
    if (!response.ok) {
      // The URL belongs in the message. "poe.ninja Currency returned HTTP 404" tells an operator
      // nothing they can act on; the same line with the address is something they can paste into
      // a browser and see for themselves in five seconds.
      if (response.status === 404) {
        throw new PriceFetchError(
          `poe.ninja has no ${type} data for league "${league}" (HTTP 404 from ${url}). ` +
            'A 404 from this endpoint means the league or the category is not indexed — or that ' +
            'the API has moved again, which is what happened when it left /api/data. Open the ' +
            'URL above to see which, and set POE_NINJA_URL if it has moved.',
        );
      }
      throw new PriceFetchError(`poe.ninja ${type} returned HTTP ${response.status} from ${url}`);
    }
    try {
      return await readJsonCapped(response, this.#options.maxBytes, `poe.ninja ${type}`);
    } catch (error) {
      throw new PriceFetchError(`poe.ninja ${type} was unusable: ${describeError(error).message}`);
    }
  }
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
