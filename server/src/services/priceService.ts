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
 * The shape of what comes back, and the losses in it, are in services/ninjaPayload.ts.
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
import { DEFAULT_UNIQUE_CATEGORIES } from '../lib/config.ts';
import { verifyAliases } from './ninjaId.ts';
import {
  CHAOS_ID,
  DEFAULT_NINJA_ITEM_URL,
  DEFAULT_NINJA_URL,
  PriceFetchError,
  coreItems,
  divineRateFrom,
  fromGameCdn,
  iconUrl,
  mergeOverview,
  overviewMeta,
  type LineMeta,
} from './ninjaPayload.ts';
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
   * Display name → icon URL.
   *
   * Mostly filled in from the stash rather than from poe.ninja, which publishes no icons any
   * more beyond chaos and divine. `rememberIcons` merges in what each poll saw; the set is the
   * right home for them for the reason it always was — an icon is a property of the item, not
   * of a moment, so repeating it in every snapshot would grow the largest column in the
   * database 144 times a day to store the same strings.
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
  /**
   * poe.ninja id → what its price has been doing: the percentage change, the volume behind it,
   * and poe.ninja's own sparkline. See LineMeta.
   *
   * Empty for a set restored from a row written before the column existed, and for any id the
   * payload published no movement for. Absent movement is shown as absent, never as flat.
   */
  meta: Record<string, LineMeta>;
  /**
   * poe.ninja id → the category it was fetched under, e.g. `gilded-bestiary-scarab` → `Scarab`.
   *
   * Recorded here because this is the only moment it is known. The app asks poe.ninja one
   * `type=` at a time and the payload says nothing about which one it answered, so the category
   * exists only in the request. Working it out later from an item's name would be guesswork
   * over a fact we already had in hand.
   */
  categories: Record<string, string>;
}

/** One item's price at one moment, out of a stored price set. */
export interface PricePoint {
  at: string;
  chaos: number;
  /** The divine rate at that moment, so the client can quote the point in either unit. */
  divineRate: number;
}

export interface PriceSetStore {
  latest(league: string): Promise<PriceSet | null>;
  save(set: PriceSet): Promise<void>;
  /**
   * One item's price across the price sets still retained, oldest first.
   *
   * This is history the app has watched itself, rather than history poe.ninja reports. It goes
   * back as far as PRICE_SET_RETENTION allows — two days at the default — and it is the only
   * price history in this program that is not a percentage: poe.ninja's sparkline says how much
   * something moved, this says what it actually cost.
   */
  history(league: string, id: string, limit?: number): Promise<PricePoint[]>;
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
  /**
   * Item-endpoint `type=` values to price uniques from.
   *
   * The five that return anything, recorded by scripts/probe.mjs. An empty list turns unique
   * pricing off entirely, which is what the tests that are not about it do.
   */
  uniqueCategories?: string[];
  ttlMs: number;
  store: PriceSetStore;
  fetchFn?: typeof fetch;
  now?: () => number;
  log?: Logger;
  userAgent?: string;
  baseUrl?: string;
  /** poe.ninja's item endpoint. Separate from `baseUrl`; it is a different service shape. */
  itemBaseUrl?: string;
  /** Ceiling on one overview request. Without it a hung poe.ninja never releases the poll. */
  timeoutMs?: number;
  maxBytes?: number;
}


export class PriceService {
  readonly #options: PriceServiceOptions;
  readonly #fetch: typeof fetch;
  readonly #now: () => number;
  readonly #log: Logger;
  readonly #baseUrl: string;
  readonly #itemBaseUrl: string;
  #cached: PriceSet | null = null;
  /** Collapses concurrent callers onto one refetch. */
  #inFlight: Promise<PriceSet> | null = null;

  constructor(options: PriceServiceOptions) {
    this.#options = options;
    this.#fetch = options.fetchFn ?? globalThis.fetch;
    this.#now = options.now ?? Date.now;
    this.#log = options.log ?? silentLogger;
    this.#baseUrl = options.baseUrl ?? DEFAULT_NINJA_URL;
    this.#itemBaseUrl = options.itemBaseUrl ?? DEFAULT_NINJA_ITEM_URL;
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

  /**
   * Fold icons discovered elsewhere into the current set, and persist them.
   *
   * The poller calls this with what it saw in the stash. Existing entries are kept: an icon does
   * not change, and rewriting the row on every poll for no difference is a write nobody asked
   * for. Returns how many were written, which is also how it decides whether to save at all.
   *
   * The one exception is an entry poe.ninja supplied. Those cover chaos and divine only, and
   * they point at poe.ninja's own origin rather than at GGG's CDN — so the two most-shown items
   * in the app were the only two whose artwork came from somewhere else. The stash's copy is
   * the item's own artwork and sits where every other icon does, so it replaces them.
   */
  async rememberIcons(icons: Record<string, string>): Promise<number> {
    const set = this.#cached;
    if (set === null) return 0;

    let written = 0;
    for (const [name, url] of Object.entries(icons)) {
      const held = set.icons[name];
      if (held !== undefined && (fromGameCdn(held) || !fromGameCdn(url))) continue;
      set.icons[name] = url;
      written += 1;
    }
    if (written > 0) await this.#options.store.save(set);
    return written;
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
    const categories: Record<string, string> = Object.create(null) as Record<string, string>;
    const meta: Record<string, LineMeta> = Object.create(null) as Record<string, LineMeta>;

    let divineRate: number | null = null;

    for (const type of [...currencyCategories, ...itemCategories]) {
      const payload = await this.#getJson(league, type);
      const merged = mergeOverview(payload, prices, icons, categories, type);
      // First category wins here too, matching the price: an id appearing under two types
      // belongs to the earlier, more specific one.
      for (const [id, line] of Object.entries(overviewMeta(payload))) {
        if (meta[id] === undefined) meta[id] = line;
      }
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

    // Uniques, from the item endpoint. A different service with a different shape and a
    // different failure mode from the exchange one above, and it is allowed to fail on its own:
    // losing unique prices costs the wealth total its uniques, which is where this application
    // stood for months, and is not worth losing every other price over.
    for (const type of this.#options.uniqueCategories ?? DEFAULT_UNIQUE_CATEGORIES) {
      try {
        const payload = await this.#getItemJson(league, type);
        const merged = mergeUniqueOverview(payload, uniques, iconUrl);
        this.#log.debug({ type, merged }, 'merged unique item overview');
      } catch (error) {
        this.#log.warn({ type, err: error }, 'could not read unique prices; continuing without them');
      }
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
      categories,
      meta,
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

  /**
   * One item-overview request.
   *
   * Its own method rather than a parameter on `#getJson`, because the two endpoints differ in
   * more than a path: this one takes `type` before `league`, returns a different shape, and its
   * failures are survivable where the other's are not.
   */
  async #getItemJson(league: string, type: string): Promise<unknown> {
    const url =
      `${this.#itemBaseUrl}/overview?type=${encodeURIComponent(type)}` +
      `&league=${encodeURIComponent(league)}`;
    const response = await this.#fetch(url, {
      headers: {
        accept: 'application/json',
        ...(this.#options.userAgent ? { 'user-agent': this.#options.userAgent } : {}),
      },
      signal: timeoutSignal(this.#options.timeoutMs ?? 30_000),
    });
    if (!response.ok) throw new PriceFetchError(`poe.ninja ${type} returned HTTP ${response.status}`);
    return readJsonCapped(response, this.#options.maxBytes, `poe.ninja ${type}`);
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
