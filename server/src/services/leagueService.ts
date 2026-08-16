/**
 * The league list, so nobody has to type "Settlers" and find out they were wrong from a 404.
 *
 * GGG publishes the current leagues at `/api/leagues`. It is not account-scoped and does not
 * need a session, but it is still GGG's infrastructure, so it goes out with the same User-Agent
 * and the same timeout as everything else.
 *
 * Three properties matter more than the fetch itself:
 *
 *   It never returns nothing. A dropdown that is empty because the network hiccuped is worse
 *   than the text field it replaced, so a failed fetch falls back to the permanent leagues plus
 *   whatever leagues already have history in this database.
 *
 *   It tolerates a shape it has not seen. The response is read field by field with fallbacks;
 *   an entry that yields no usable name is skipped rather than turned into an empty option.
 *
 *   It is cached for hours. Leagues change roughly four times a year. Refetching per page load
 *   would be a request GGG has no reason to serve.
 */

import { describeError, silentLogger, type Logger } from '../lib/logger.ts';
import { readJsonCapped, timeoutSignal } from '../lib/http.ts';

export interface League {
  id: string;
  hardcore: boolean;
  /** Solo self-found. GGG expresses it as a "NoParties" rule. */
  ssf: boolean;
  ruthless: boolean;
  /** When the league ends, for the temporary ones. Null for the permanent leagues. */
  endAt: string | null;
}

export interface LeagueList {
  leagues: League[];
  /** 'ggg' when the list came from GGG, 'fallback' when the fetch failed. */
  source: 'ggg' | 'fallback';
  fetchedAt: string;
}

/**
 * The leagues that always exist. Used as the floor for the fallback list.
 *
 * Deliberately not a guess at the current temporary league: naming one that has ended would be
 * worse than offering none, because it looks authoritative.
 */
export const PERMANENT_LEAGUES: readonly string[] = [
  'Standard',
  'Hardcore',
  'Solo Self-Found',
  'Hardcore SSF',
  'Ruthless',
  'Hardcore Ruthless',
];

interface RawLeague {
  id?: unknown;
  name?: unknown;
  endAt?: unknown;
  rules?: unknown;
}

function ruleIds(rules: unknown): string[] {
  if (!Array.isArray(rules)) return [];
  return rules
    .map((rule) => {
      if (typeof rule === 'string') return rule;
      const record = rule as { id?: unknown; name?: unknown };
      if (typeof record?.id === 'string') return record.id;
      if (typeof record?.name === 'string') return record.name;
      return '';
    })
    .filter((id) => id !== '');
}

/**
 * Narrow GGG's payload into the shape the UI needs.
 *
 * Both `id` and `name` are accepted for the league's name: the endpoint uses `id`, but it costs
 * nothing to survive the other spelling, and the alternative is a dropdown full of blanks if it
 * ever changes.
 */
export function parseLeagues(payload: unknown): League[] {
  // The endpoint answers with a bare array; an object with a `leagues` key is tolerated too.
  const entries = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as { leagues?: unknown })?.leagues)
      ? ((payload as { leagues: unknown[] }).leagues)
      : [];

  const leagues: League[] = [];
  const seen = new Set<string>();

  for (const raw of entries as RawLeague[]) {
    const id =
      typeof raw?.id === 'string' && raw.id !== ''
        ? raw.id
        : typeof raw?.name === 'string' && raw.name !== ''
          ? raw.name
          : null;
    if (id === null || seen.has(id)) continue;
    seen.add(id);

    const rules = ruleIds(raw?.rules).map((rule) => rule.toLowerCase());
    leagues.push({
      id,
      hardcore: rules.includes('hardcore'),
      // GGG names the solo rule "NoParties"; accept the plainer spelling too.
      ssf: rules.includes('noparties') || rules.includes('ssf'),
      ruthless: rules.includes('ruthless'),
      endAt: typeof raw?.endAt === 'string' ? raw.endAt : null,
    });
  }

  return leagues;
}

export interface LeagueServiceOptions {
  userAgent: string;
  /** Leagues that already have snapshots here. They belong in the list even if GGG forgot them. */
  knownLeagues: () => Promise<string[]>;
  fetchFn?: typeof fetch;
  now?: () => number;
  log?: Logger;
  baseUrl?: string;
  timeoutMs?: number;
  ttlMs?: number;
}

export class LeagueService {
  readonly #options: LeagueServiceOptions;
  readonly #fetch: typeof fetch;
  readonly #now: () => number;
  readonly #log: Logger;
  readonly #baseUrl: string;
  readonly #ttlMs: number;
  #cached: LeagueList | null = null;
  #cachedAt = 0;
  #inFlight: Promise<LeagueList> | null = null;

  constructor(options: LeagueServiceOptions) {
    this.#options = options;
    this.#fetch = options.fetchFn ?? globalThis.fetch;
    this.#now = options.now ?? Date.now;
    this.#log = options.log ?? silentLogger;
    this.#baseUrl = options.baseUrl ?? 'https://www.pathofexile.com/api/leagues';
    // Six hours. Leagues change about four times a year.
    this.#ttlMs = options.ttlMs ?? 6 * 60 * 60_000;
  }

  async list(): Promise<LeagueList> {
    if (this.#cached !== null && this.#now() - this.#cachedAt < this.#ttlMs) return this.#cached;
    // Collapse concurrent callers; a page load asks once but two windows might not.
    this.#inFlight ??= this.#refresh().finally(() => {
      this.#inFlight = null;
    });
    return this.#inFlight;
  }

  async #refresh(): Promise<LeagueList> {
    try {
      const url = `${this.#baseUrl}?type=main&realm=pc`;
      const response = await this.#fetch(url, {
        headers: { accept: 'application/json', 'user-agent': this.#options.userAgent },
        signal: timeoutSignal(this.#options.timeoutMs ?? 15_000),
        redirect: 'error',
      });
      if (!response.ok) throw new Error(`GGG returned HTTP ${response.status} for the league list`);

      const leagues = parseLeagues(await readJsonCapped(response, 2 * 1024 * 1024, 'league list'));
      if (leagues.length === 0) throw new Error('GGG returned no usable leagues');

      const list: LeagueList = {
        leagues,
        source: 'ggg',
        fetchedAt: new Date(this.#now()).toISOString(),
      };
      this.#cached = list;
      this.#cachedAt = this.#now();
      this.#log.info({ count: leagues.length }, 'fetched the league list');
      return list;
    } catch (error) {
      this.#log.warn(
        { err: error },
        'could not fetch the league list; offering the permanent leagues instead',
      );
      return this.#fallback();
    }
  }

  /**
   * What to show when GGG cannot be reached.
   *
   * The permanent leagues plus anything this database already has history for — which is how a
   * private league someone configured by hand stays selectable instead of vanishing from the
   * dropdown the moment the network is down.
   */
  async #fallback(): Promise<LeagueList> {
    const known = await this.#options.knownLeagues().catch(() => [] as string[]);
    const names = [...new Set([...PERMANENT_LEAGUES, ...known])];

    return {
      leagues: names.map((id) => ({
        id,
        hardcore: /hardcore|^hc/i.test(id),
        ssf: /ssf|self-found/i.test(id),
        ruthless: /ruthless/i.test(id),
        endAt: null,
      })),
      source: 'fallback',
      fetchedAt: new Date(this.#now()).toISOString(),
    };
  }
}
