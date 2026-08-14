import { describe, expect, it, vi } from 'vitest';
import { RateLimiter } from '../src/lib/rateLimiter.ts';
import { clearSecrets, registerSecret } from '../src/lib/logger.ts';
import { StashError, StashService, parseTabs, selectTabs } from '../src/services/stashService.ts';
import { dumpTabResponse, mapTabResponse, stashResponse, tabListResponse } from './fixtures/stash.ts';

const SESSION = 'f00dcafe'.repeat(4);
const HEADERS = { limit: '45:60:120', state: '1:60:0' };

/** Routes by tabIndex, the way the real endpoint does. */
function stashFetch(responses: Record<string, () => Response> = {}) {
  return vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input));
    const index = url.searchParams.get('tabIndex') ?? '0';
    const withTabs = url.searchParams.get('tabs') === '1';
    const override = responses[withTabs ? 'list' : index];
    if (override) return override();
    if (withTabs) return stashResponse(tabListResponse, 200, HEADERS);
    if (index === '1') return stashResponse(dumpTabResponse, 200, HEADERS);
    if (index === '2') return stashResponse(mapTabResponse, 200, HEADERS);
    return stashResponse({ items: [] }, 200, HEADERS);
  }) as unknown as typeof fetch;
}

function service(fetchFn: typeof fetch, trackedTabs: string[] = []) {
  const limiter = new RateLimiter({
    fetchFn,
    now: () => 0,
    sleep: async () => {},
    minIntervalMs: 0,
  });
  return new StashService({
    accountName: 'Exile#1234',
    league: 'Settlers',
    poesessid: SESSION,
    userAgent: 'valuuttaloki/test',
    trackedTabs,
    limiter,
  });
}

describe('parseTabs', () => {
  it('reads name, index, id and type', () => {
    const tabs = parseTabs(tabListResponse.tabs);
    expect(tabs[0]).toEqual({ name: 'Currency', index: 0, id: 'aaa', type: 'CurrencyStash' });
  });

  it('skips hidden tabs, which are not really tabs to read', () => {
    expect(parseTabs(tabListResponse.tabs).map((tab) => tab.name)).toEqual(['Currency', 'Dump', 'Maps']);
  });

  it('names an unnamed tab after its index rather than dropping it', () => {
    expect(parseTabs([{ i: 4, id: 'zzz' }])[0]?.name).toBe('Tab 4');
  });

  it('ignores entries with no index, which cannot be fetched', () => {
    expect(parseTabs([{ n: 'Broken', id: 'x' }])).toEqual([]);
  });

  it('survives a payload that is not an array', () => {
    expect(parseTabs(undefined)).toEqual([]);
  });
});

describe('selectTabs', () => {
  const tabs = parseTabs(tabListResponse.tabs);

  it('takes every tab when the allowlist is empty', () => {
    expect(selectTabs(tabs, []).selected).toHaveLength(3);
  });

  it('filters by name', () => {
    const { selected } = selectTabs(tabs, ['Dump']);
    expect(selected.map((tab) => tab.name)).toEqual(['Dump']);
  });

  it('reports allowlist names no tab answers to', () => {
    const { unknownNames } = selectTabs(tabs, ['Dump', 'Renamed Tab']);
    expect(unknownNames).toEqual(['Renamed Tab']);
  });
});

describe('StashService', () => {
  it('sends the session as a cookie and never in the URL', async () => {
    const fetchFn = stashFetch();
    await service(fetchFn).listTabs();

    const [url, init] = (fetchFn as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).not.toContain(SESSION);
    expect((init.headers as Record<string, string>).cookie).toBe(`POESESSID=${SESSION}`);
    expect((init.headers as Record<string, string>)['user-agent']).toBe('valuuttaloki/test');
  });

  it('reuses the tab-list response for tab 0 instead of spending a second request', async () => {
    const fetchFn = stashFetch();
    const contents = await service(fetchFn, ['Currency']).fetchTrackedTabs();

    expect(contents).toHaveLength(1);
    expect(contents[0]?.items).toHaveLength(3);
    expect((fetchFn as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(1);
  });

  it('reads every tab when no allowlist is configured', async () => {
    const contents = await service(stashFetch()).fetchTrackedTabs();
    expect(contents.map((entry) => entry.tab.name)).toEqual(['Currency', 'Dump', 'Maps']);
  });

  it('fetches tabs one at a time, never in parallel', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const fetchFn = vi.fn(async (input: string | URL | Request) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      return stashFetch()(input);
    }) as unknown as typeof fetch;

    await service(fetchFn).fetchTrackedTabs();
    expect(maxInFlight).toBe(1);
  });

  it('explains an expired session rather than reporting a bare 403', async () => {
    registerSecret(SESSION);
    const fetchFn = stashFetch({ list: () => stashResponse({ error: 'forbidden' }, 403, HEADERS) });

    await expect(service(fetchFn).listTabs()).rejects.toThrow(/POESESSID has most likely expired/);
    clearSecrets();
  });

  it('never leaks the session into an error message', async () => {
    registerSecret(SESSION);
    const fetchFn = stashFetch({
      list: () => stashResponse({ error: `bad session ${SESSION}` }, 500, HEADERS),
    });

    const error = await service(fetchFn)
      .listTabs()
      .then(
        () => null,
        (err: unknown) => err as Error,
      );
    expect(error?.message).toBeDefined();
    expect(error?.message).not.toContain(SESSION);
    clearSecrets();
  });

  it('names the likely mistake on a 404', async () => {
    const fetchFn = stashFetch({ list: () => stashResponse({}, 404, HEADERS) });
    await expect(service(fetchFn).listTabs()).rejects.toThrow(/Check both spellings/);
  });

  it('refuses to treat an account with no tabs as an empty stash', async () => {
    const fetchFn = stashFetch({ list: () => stashResponse({ tabs: [], items: [] }, 200, HEADERS) });
    await expect(service(fetchFn).listTabs()).rejects.toBeInstanceOf(StashError);
  });

  it('refuses to write an empty snapshot when the allowlist matches nothing', async () => {
    const fetchFn = stashFetch();
    await expect(service(fetchFn, ['Gone']).fetchTrackedTabs()).rejects.toThrow(/Refusing to write/);
  });

  it('propagates a mid-poll tab failure so the whole poll is abandoned', async () => {
    const fetchFn = stashFetch({ '1': () => stashResponse({}, 500, HEADERS) });
    await expect(service(fetchFn).fetchTrackedTabs()).rejects.toThrow(/HTTP 500/);
  });

  it('rejects a response that is not JSON at all', async () => {
    const fetchFn = stashFetch({
      list: () => new Response('<html>maintenance</html>', { status: 200 }),
    });
    await expect(service(fetchFn).listTabs()).rejects.toThrow(/unparseable JSON/);
  });
});
