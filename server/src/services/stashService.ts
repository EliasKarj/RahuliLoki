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
import { readJsonCapped } from '../lib/http.ts';

/** Only the fields valuation actually reads. GGG sends a great deal more. */
export interface StashItem {
  typeLine?: string;
  baseType?: string;
  name?: string;
  stackSize?: number;
  frameType?: number;
  identified?: boolean;
  corrupted?: boolean;
  /**
   * The item's own artwork, on GGG's CDN.
   *
   * This is where icons come from now, and it is a better source than the one it replaces.
   * poe.ninja used to publish an icon per priced line; its redesigned API publishes none except
   * for chaos and divine. But the stash response has carried this field all along — it is the
   * picture of the exact item being counted, straight from the people who drew it.
   */
  icon?: string;
  /** Sockets sharing a `group` are linked. Five or six of them prices a unique — see uniques.ts. */
  sockets?: Array<{ group?: unknown }>;
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
  /** Ceiling on one tab's JSON. A quad tab is large; unbounded is a different thing. */
  maxBytes?: number;
}

interface StashResponse {
  numTabs?: number;
  tabs?: unknown;
  items?: unknown;
}

function asItems(value: unknown): StashItem[] {
  return Array.isArray(value) ? (value as StashItem[]) : [];
}

/**
 * A short, flattened look at an error response body.
 *
 * Worth having because the two things a 403 can be look nothing alike and we were throwing the
 * evidence away unread: GGG's own refusal is JSON — `{"error":{"code":1,"message":"Forbidden"}}`
 * — while a Cloudflare bot challenge is an HTML page that never reached GGG at all. Same status
 * code, completely different fix, and no way to tell them apart from the outside.
 *
 * Tags are stripped and whitespace collapsed so an HTML page becomes one readable line rather
 * than two hundred of markup, and the whole thing is capped: this goes in an error message a
 * person reads, not in a log nobody scrolls.
 */
export async function describeBody(response: Response, limit = 300): Promise<string> {
  let text: string;
  try {
    text = await response.text();
  } catch {
    return '';
  }
  const flattened = text
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (flattened === '') return '';
  return flattened.length > limit ? `${flattened.slice(0, limit)}…` : flattened;
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
      // Never follow a redirect on a request that carries the account credential. The fetch
      // spec does strip Cookie when the hop crosses origins, but that is one implementation
      // detail standing between POESESSID and a host GGG's DNS was talked into pointing at.
      // A redirect here is not a thing this API does; treat it as the anomaly it is.
      redirect: 'error',
    });

    if (response.status === 403 || response.status === 401) {
      // Three causes, not one, and the message named only the first for a long time — which sent
      // someone through a fresh login that could not have helped. GGG answers 403 for a session
      // it does not accept, for a session that is fine but belongs to a different account than
      // `accountName` says (asking for somebody else's stash is forbidden, not missing), and the
      // edge in front of GGG answers 403 for a request it decides is a bot, before GGG sees it.
      //
      // The body is what separates them, so it goes in the message. `scrub` runs over the whole
      // thing in the StashError constructor, so a body that echoed the cookie cannot leak here.
      const body = await describeBody(response);
      throw new StashError(
        `GGG rejected this request (HTTP ${response.status}). Three things do this: the session ` +
          'has expired (sign in again); POE_ACCOUNT_NAME names a different account than the ' +
          `session does (it is currently "${this.#options.accountName}" — GGG spells yours at ` +
          'https://www.pathofexile.com/api/profile and it must match exactly); or Cloudflare ' +
          'refused the request before GGG saw it, which looks like an HTML page rather than ' +
          `JSON below.${body === '' ? ' The response had no body.' : ` GGG said: ${body}`}`,
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
      const body = await describeBody(response);
      throw new StashError(
        `GGG returned HTTP ${response.status} for tab ${tabIndex}` +
          (body === '' ? '' : `: ${body}`),
        response.status,
      );
    }

    try {
      return (await readJsonCapped(
        response,
        this.#options.maxBytes,
        `GGG tab ${tabIndex}`,
      )) as StashResponse;
    } catch (error) {
      // The message is worth keeping: "over the ceiling" and "not valid JSON" send an operator
      // to completely different places.
      throw new StashError(
        `GGG returned an unusable response for tab ${tabIndex}: ${(error as Error).message}`,
        response.status,
      );
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
