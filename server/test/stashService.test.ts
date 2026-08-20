import { describe, expect, it, vi } from 'vitest';
import { RateLimiter } from '../src/lib/rateLimiter.ts';
import { clearSecrets, registerSecret } from '../src/lib/logger.ts';
import { StashError, StashService, parseTabs, selectTabs } from '../src/services/stashService.ts';
import { dumpTabResponse, mapTabResponse, stashResponse, tabListResponse } from './fixtures/stash.ts';

const SESSION = 'f00dcafe'.repeat(4);
// The account rule GGG really sends on get-stash-items — see scripts/probe.mjs.
const HEADERS = { limit: '30:60:60', state: '1:60:0' };

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

/** The message of whatever `run` throws. Empty when it does not throw. */
async function messageOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
    return '';
  } catch (thrown) {
    return (thrown as Error).message;
  }
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
    userAgent: 'what-remains/test',
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
    expect((init.headers as Record<string, string>)['user-agent']).toBe('what-remains/test');
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

  it('names every cause of a 403, not just the expired session', async () => {
    // Naming only expiry sends someone through a fresh login that cannot help: GGG answers 403
    // just the same when the session is valid but names a different account, and Cloudflare
    // answers 403 before GGG sees the request at all. All three have to be in the message for
    // any of them to be actionable.
    registerSecret(SESSION);
    const fetchFn = stashFetch({ list: () => stashResponse({ error: 'forbidden' }, 403, HEADERS) });

    const message = await messageOf(() => service(fetchFn).listTabs());

    expect(message).toMatch(/session has expired/);
    expect(message).toMatch(/names a different account/);
    expect(message).toMatch(/Cloudflare/);
    // And it says what the name currently is, so the comparison can be made without digging.
    expect(message).toContain('Exile#1234');
    clearSecrets();
  });

  it('quotes the response body, which is what tells the three apart', async () => {
    const fetchFn = stashFetch({
      list: () => stashResponse({ error: { code: 1, message: 'Forbidden' } }, 403, HEADERS),
    });
    expect(await messageOf(() => service(fetchFn).listTabs())).toContain('"message":"Forbidden"');
  });

  it('flattens a Cloudflare page instead of pasting its markup', async () => {
    // The distinguishing case. An HTML challenge page must arrive as one readable line, and it
    // must be recognisable as HTML rather than as GGG's JSON.
    const html =
      '<html><head><style>.x{color:red}</style></head><body>\n  <h1>Sorry, you have been ' +
      'blocked</h1>\n  <p>You are unable to access pathofexile.com</p>\n</body></html>';
    const fetchFn = stashFetch({
      list: () => new Response(html, { status: 403, headers: HEADERS }),
    });

    const message = await messageOf(() => service(fetchFn).listTabs());
    expect(message).toContain('Sorry, you have been blocked You are unable to access');
    expect(message).not.toContain('<h1>');
    expect(message).not.toContain('color:red');
  });

  it('says so plainly when the refusal had no body at all', async () => {
    const fetchFn = stashFetch({ list: () => new Response('', { status: 403, headers: HEADERS }) });
    expect(await messageOf(() => service(fetchFn).listTabs())).toContain('no body');
  });

  it('never lets the session leak out through the quoted body', async () => {
    // The body is remote text pasted into an error a person will screenshot. If GGG ever echoed
    // the cookie back, scrub has to catch it on the way through.
    registerSecret(SESSION);
    const fetchFn = stashFetch({
      list: () => new Response(`rejected session ${SESSION}`, { status: 403, headers: HEADERS }),
    });

    const message = await messageOf(() => service(fetchFn).listTabs());
    expect(message).not.toContain(SESSION);
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
    await expect(service(fetchFn).listTabs()).rejects.toThrow(/not valid JSON/);
  });

  it('never follows a redirect on a request carrying POESESSID', async () => {
    const fetchFn = stashFetch();
    await service(fetchFn).listTabs();
    const init = (fetchFn as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]?.[1];
    // A redirect would hand the session cookie to whatever host the Location points at.
    expect(init?.redirect).toBe('error');
  });

  it('refuses a tab larger than the ceiling rather than buffering it', async () => {
    const fetchFn = stashFetch({
      list: () =>
        new Response('{"tabs":[]}', {
          status: 200,
          headers: { 'content-length': String(64 * 1024 * 1024) },
        }),
    });
    const limiter = new RateLimiter({ fetchFn, now: () => 0, sleep: async () => {}, minIntervalMs: 0 });
    const stash = new StashService({
      accountName: 'Exile#1234',
      league: 'Settlers',
      poesessid: SESSION,
      userAgent: 'what-remains/test',
      limiter,
      maxBytes: 1024,
    });
    await expect(stash.listTabs()).rejects.toThrow(/ceiling/);
  });
});
