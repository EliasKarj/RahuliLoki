/**
 * poe.ninja prices, merged into one flat `name → chaosValue` map.
 *
 * Two endpoint shapes, both keyed by display name:
 *   currencyoverview — Currency, Fragment. Lines carry `currencyTypeName` + `chaosEquivalent`.
 *   itemoverview     — everything else. Lines carry `name` + `chaosValue`.
 *
 * Caching is two-tier, as the architecture requires: an in-memory set that is refetched once
 * it passes the TTL, and a row per fetch in the database so a container restart does not
 * trigger an immediate refetch (and so old snapshots can be re-valued later).
 *
 * If poe.ninja is unreachable but we hold an older set, the poll continues with the older
 * prices rather than losing the interval entirely — `priceSetAt` on the snapshot records
 * exactly how old they were, so the staleness is visible rather than hidden.
 */

import { describeError, silentLogger, type Logger } from '../lib/logger.ts';
import { readJsonCapped, timeoutSignal } from '../lib/http.ts';
import { mergeUniqueOverview, uniqueKey, type UniqueIndex } from './uniques.ts';

export interface PriceSet {
  league: string;
  fetchedAt: Date;
  /** Flat display-name → chaos value. Always contains "Chaos Orb": 1. */
  prices: Record<string, number>;
  /** Chaos per divine, straight out of the Currency set. */
  divineRate: number;
  /**
   * Display-name → poe.ninja icon URL, for the names it gave one.
   *
   * Kept on the price set rather than on each snapshot's breakdown: an icon URL is a property
   * of the item, not of a moment in time. Copying ~40 bytes per line into every snapshot blob
   * would grow the column that already dominates the database, 144 times a day, to store the
   * same string over and over.
   */
  icons: Record<string, string>;
  /**
   * Unique lines kept per name, not flattened into `prices`.
   *
   * They cannot be flattened: the same name has several prices depending on links and
   * corruption, and which one applies is a property of the item in the stash, not of the
   * price set. See services/uniques.ts.
   */
  uniques: UniqueIndex;
}

export interface PriceSetStore {
  latest(league: string): Promise<PriceSet | null>;
  save(set: PriceSet): Promise<void>;
}

interface CurrencyLine {
  currencyTypeName?: unknown;
  chaosEquivalent?: unknown;
}

interface ItemLine {
  name?: unknown;
  chaosValue?: unknown;
  icon?: unknown;
}

/** The two payload shapes put the icon in different places — see the merge functions. */
interface CurrencyDetail {
  name?: unknown;
  icon?: unknown;
}

/** poe.ninja serves icons off GGG's CDN. Anything else in that field is not an icon. */
export function iconUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value === '') return null;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  const host = parsed.hostname.toLowerCase();
  return host === 'web.poecdn.com' || host.endsWith('.poecdn.com') ? value : null;
}

export interface PriceServiceOptions {
  league: string;
  currencyCategories: string[];
  itemCategories: string[];
  /** poe.ninja itemoverview types whose lines are uniques. Priced per variant, not by name. */
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

const DIVINE = 'Divine Orb';
const CHAOS = 'Chaos Orb';

/** poe.ninja returns numbers as numbers, but a null or a string would silently become NaN. */
function finitePositive(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return value;
}

/**
 * Merge one currencyoverview payload into `into`. Returns how many lines were usable.
 *
 * Icons are not on the lines here. currencyoverview carries them in a sibling
 * `currencyDetails` array keyed by the same display name, so they are collected separately —
 * a line with no matching detail simply has no icon, which is not an error.
 */
export function mergeCurrencyOverview(
  payload: unknown,
  into: Record<string, number>,
  icons: Record<string, string> = Object.create(null) as Record<string, string>,
): number {
  const lines = (payload as { lines?: unknown })?.lines;
  if (!Array.isArray(lines)) return 0;
  let merged = 0;
  for (const raw of lines as CurrencyLine[]) {
    const name = typeof raw?.currencyTypeName === 'string' ? raw.currencyTypeName : null;
    const value = finitePositive(raw?.chaosEquivalent);
    if (name === null || value === null) continue;
    into[name] = value;
    merged += 1;
  }

  const details = (payload as { currencyDetails?: unknown })?.currencyDetails;
  if (Array.isArray(details)) {
    for (const raw of details as CurrencyDetail[]) {
      const name = typeof raw?.name === 'string' ? raw.name : null;
      const icon = iconUrl(raw?.icon);
      if (name === null || icon === null) continue;
      icons[name] = icon;
    }
  }
  return merged;
}

/** Merge one itemoverview payload into `into`. Here the icon is on the line itself. */
export function mergeItemOverview(
  payload: unknown,
  into: Record<string, number>,
  icons: Record<string, string> = Object.create(null) as Record<string, string>,
): number {
  const lines = (payload as { lines?: unknown })?.lines;
  if (!Array.isArray(lines)) return 0;
  let merged = 0;
  for (const raw of lines as ItemLine[]) {
    const name = typeof raw?.name === 'string' ? raw.name : null;
    const value = finitePositive(raw?.chaosValue);
    if (name === null || value === null) continue;
    // First category wins. Categories do not overlap in practice, and when they do the
    // earlier (more specific) list is the one the operator put first on purpose.
    if (into[name] === undefined) into[name] = value;
    const icon = iconUrl(raw?.icon);
    if (icon !== null && icons[name] === undefined) icons[name] = icon;
    merged += 1;
  }
  return merged;
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
    this.#baseUrl = options.baseUrl ?? 'https://poe.ninja/api/data';
  }

  /** Load the newest persisted set at boot so a restart does not force a refetch. */
  async hydrate(): Promise<PriceSet | null> {
    const stored = await this.#options.store.latest(this.#options.league);
    if (stored) {
      this.#cached = stored;
      this.#log.info(
        { fetchedAt: stored.fetchedAt.toISOString(), prices: Object.keys(stored.prices).length },
        'restored price set from the database',
      );
    }
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
          { err: describeError(error), ageMinutes },
          'poe.ninja refetch failed; continuing with the previous price set',
        );
        return this.#cached;
      }
      throw error;
    }
  }

  async #fetchAll(): Promise<PriceSet> {
    const { league, currencyCategories, itemCategories } = this.#options;
    // Null-prototype: every key here is an item name straight out of a remote payload. On a
    // normal object `prices['toString']` is a function rather than undefined, so the
    // "have I seen this name already" check below would silently discard a real price — and
    // `prices['__proto__'] = …` would reassign the prototype instead of storing anything.
    const prices: Record<string, number> = Object.create(null) as Record<string, number>;
    const icons: Record<string, string> = Object.create(null) as Record<string, string>;
    const uniques: UniqueIndex = Object.create(null) as UniqueIndex;

    for (const type of currencyCategories) {
      const payload = await this.#getJson(`${this.#baseUrl}/currencyoverview`, league, type);
      const merged = mergeCurrencyOverview(payload, prices, icons);
      this.#log.debug({ type, merged }, 'merged currency overview');
    }

    for (const type of itemCategories) {
      const payload = await this.#getJson(`${this.#baseUrl}/itemoverview`, league, type);
      const merged = mergeItemOverview(payload, prices, icons);
      this.#log.debug({ type, merged }, 'merged item overview');
    }

    for (const type of this.#options.uniqueCategories ?? []) {
      const payload = await this.#getJson(`${this.#baseUrl}/itemoverview`, league, type);
      const merged = mergeUniqueOverview(payload, uniques, iconUrl);
      this.#log.debug({ type, merged }, 'merged unique overview');
    }

    // Icons for uniques are registered under the same display key the breakdown will use, so
    // the UI needs no rule for turning "Bronn's Lithe (6L)" back into an icon lookup.
    for (const entries of Object.values(uniques)) {
      for (const entry of entries) {
        if (entry.icon === null) continue;
        const key = uniqueKey(entry.name, entry.links, entry.corrupted);
        if (icons[key] === undefined) icons[key] = entry.icon;
      }
    }

    // poe.ninja quotes everything in chaos, so chaos itself is never in the payload.
    prices[CHAOS] = 1;

    const divineRate = Object.hasOwn(prices, DIVINE) ? prices[DIVINE] : undefined;
    if (divineRate === undefined) {
      throw new PriceFetchError(
        `poe.ninja returned no "${DIVINE}" price for league "${league}"; refusing to value a ` +
          'snapshot without a divine rate',
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

  async #getJson(base: string, league: string, type: string): Promise<unknown> {
    const url = `${base}?league=${encodeURIComponent(league)}&type=${encodeURIComponent(type)}`;
    const response = await this.#fetch(url, {
      headers: {
        accept: 'application/json',
        ...(this.#options.userAgent ? { 'user-agent': this.#options.userAgent } : {}),
      },
      signal: timeoutSignal(this.#options.timeoutMs ?? 30_000),
    });
    if (!response.ok) {
      throw new PriceFetchError(`poe.ninja ${type} returned HTTP ${response.status}`);
    }
    try {
      return await readJsonCapped(response, this.#options.maxBytes, `poe.ninja ${type}`);
    } catch (error) {
      throw new PriceFetchError(`poe.ninja ${type} was unusable: ${describeError(error).message}`);
    }
  }
}
