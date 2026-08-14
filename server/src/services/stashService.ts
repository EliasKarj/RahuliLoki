/**
 * The GGG stash endpoint.
 *
 *   GET /character-window/get-stash-items?accountName=…&league=…&tabIndex=0&tabs=1
 *
 * `tabs=1` returns the tab list *and* the items of `tabIndex` in the same response, so the
 * initial listing call doubles as the fetch for whichever tab we point it at. That is one
 * fewer request against a limit we care a great deal about.
 *
 * Every request goes through the RateLimiter, which serialises them. Nothing in here fires
 * requests in parallel, and nothing in here should ever be changed to.
 */

import { scrub, silentLogger, type Logger } from '../lib/logger.ts';
import type { RateLimiter } from '../lib/rateLimiter.ts';

/** Only the fields valuation actually reads. GGG sends a great deal more. */
export interface StashItem {
  typeLine?: string;
  baseType?: string;
  name?: string;
  stackSize?: number;
  frameType?: number;
  identified?: boolean;
  corrupted?: boolean;
}

export interface StashTabInfo {
  /** Tab name as the player sees it. */
  name: string;
  index: number;
  id: string;
  type: string;
}

export interface TabContents {
  tab: StashTabInfo;
  items: StashItem[];
}

export class StashError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null = null) {
    super(scrub(message));
    this.name = 'StashError';
    this.status = status;
  }
}

export interface StashServiceOptions {
  accountName: string;
  league: string;
  poesessid: string;
  userAgent: string;
  limiter: RateLimiter;
  log?: Logger;
  baseUrl?: string;
  /** Tab names to value; empty means every tab. */
  trackedTabs?: string[];
}

interface StashResponse {
  numTabs?: number;
  tabs?: unknown;
  items?: unknown;
}

function asItems(value: unknown): StashItem[] {
  return Array.isArray(value) ? (value as StashItem[]) : [];
}

/** Normalise GGG's tab list. `n` is the name, `i` the index, `type` the tab kind. */
export function parseTabs(value: unknown): StashTabInfo[] {
  if (!Array.isArray(value)) return [];
  const tabs: StashTabInfo[] = [];
  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null) continue;
    const tab = raw as { n?: unknown; i?: unknown; id?: unknown; type?: unknown; hidden?: unknown };
    if (tab.hidden === true) continue;
    const index = typeof tab.i === 'number' ? tab.i : null;
    if (index === null) continue;
    tabs.push({
      name: typeof tab.n === 'string' ? tab.n : `Tab ${index}`,
      index,
      id: typeof tab.id === 'string' ? tab.id : String(index),
      type: typeof tab.type === 'string' ? tab.type : 'unknown',
    });
  }
  return tabs;
}

/**
 * Which tabs to value. An empty allowlist means all of them; otherwise match by name, and
 * report names in the allowlist that no tab answers to — a renamed tab silently dropping out
 * of the series would look exactly like losing the wealth in it.
 */
export function selectTabs(
  tabs: StashTabInfo[],
  tracked: string[],
): { selected: StashTabInfo[]; unknownNames: string[] } {
  if (tracked.length === 0) return { selected: tabs, unknownNames: [] };
  const wanted = new Set(tracked);
  const selected = tabs.filter((tab) => wanted.has(tab.name));
  const present = new Set(selected.map((tab) => tab.name));
  return { selected, unknownNames: tracked.filter((name) => !present.has(name)) };
}

export class StashService {
  readonly #options: StashServiceOptions;
  readonly #log: Logger;
  readonly #baseUrl: string;

  constructor(options: StashServiceOptions) {
    this.#options = options;
    this.#log = options.log ?? silentLogger;
    this.#baseUrl =
      options.baseUrl ?? 'https://www.pathofexile.com/character-window/get-stash-items';
  }

  #url(tabIndex: number, withTabs: boolean): string {
    const params = new URLSearchParams({
      accountName: this.#options.accountName,
      league: this.#options.league,
      tabIndex: String(tabIndex),
      tabs: withTabs ? '1' : '0',
    });
    return `${this.#baseUrl}?${params.toString()}`;
  }

  async #get(tabIndex: number, withTabs: boolean): Promise<StashResponse> {
    const response = await this.#options.limiter.request(this.#url(tabIndex, withTabs), {
      headers: {
        // The credential travels as a cookie and only as a cookie. It is never logged and
        // never put in a URL, where it would end up in proxy logs and error messages.
        cookie: `POESESSID=${this.#options.poesessid}`,
        accept: 'application/json',
        'user-agent': this.#options.userAgent,
      },
    });

    if (response.status === 403 || response.status === 401) {
      throw new StashError(
        'GGG rejected the session (HTTP ' +
          response.status +
          '). POESESSID has most likely expired — log in again and copy a fresh one.',
        response.status,
      );
    }
    if (response.status === 404) {
      throw new StashError(
        `GGG returned 404 for account "${this.#options.accountName}" in league ` +
          `"${this.#options.league}". Check both spellings, including the #discriminator.`,
        404,
      );
    }
    if (!response.ok) {
      throw new StashError(`GGG returned HTTP ${response.status} for tab ${tabIndex}`, response.status);
    }

    try {
      return (await response.json()) as StashResponse;
    } catch {
      throw new StashError(`GGG returned unparseable JSON for tab ${tabIndex}`, response.status);
    }
  }

  /** The tab list, plus the items of tab 0 which come along for free. */
  async listTabs(): Promise<{ tabs: StashTabInfo[]; firstTabItems: StashItem[] }> {
    const payload = await this.#get(0, true);
    const tabs = parseTabs(payload.tabs);
    if (tabs.length === 0) {
      throw new StashError(
        'GGG returned no stash tabs. Either the account has none in this league, or the ' +
          'session belongs to a different account.',
      );
    }
    return { tabs, firstTabItems: asItems(payload.items) };
  }

  /**
   * Fetch every tracked tab, one at a time. Any failure propagates: a partial read must never
   * become a snapshot, because a missing tab is indistinguishable from a spent one on a chart.
   */
  async fetchTrackedTabs(): Promise<TabContents[]> {
    const { tabs, firstTabItems } = await this.listTabs();
    const { selected, unknownNames } = selectTabs(tabs, this.#options.trackedTabs ?? []);

    if (unknownNames.length > 0) {
      this.#log.warn(
        { unknownNames, available: tabs.map((tab) => tab.name) },
        'TRACKED_TABS names no tab in this league — renamed or deleted?',
      );
    }
    if (selected.length === 0) {
      throw new StashError(
        'No stash tab matched TRACKED_TABS. Refusing to write an empty snapshot; fix the ' +
          'allowlist or clear it to track every tab.',
      );
    }

    const contents: TabContents[] = [];
    for (const tab of selected) {
      // The listing call already carried tab 0's items. Do not spend a request re-reading it.
      const items = tab.index === 0 ? firstTabItems : asItems((await this.#get(tab.index, false)).items);
      this.#log.debug({ tab: tab.name, items: items.length }, 'read stash tab');
      contents.push({ tab, items });
    }
    return contents;
  }
}
