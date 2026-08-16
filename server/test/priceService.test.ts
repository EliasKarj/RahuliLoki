import { describe, expect, it, vi } from 'vitest';
import {
  PriceFetchError,
  PriceService,
  mergeCurrencyOverview,
  mergeItemOverview,
  type PriceSet,
  type PriceSetStore,
} from '../src/services/priceService.ts';
import {
  currencyOverview,
  divinationCardOverview,
  emptyOverview,
  fragmentOverview,
  jsonResponse,
  scarabOverview,
} from './fixtures/poeninja.ts';

function memoryStore(initial: PriceSet | null = null) {
  const saved: PriceSet[] = [];
  const store: PriceSetStore = {
    latest: async () => saved[saved.length - 1] ?? initial,
    save: async (set) => {
      saved.push(set);
    },
  };
  return { store, saved };
}

/** Serves the recorded fixtures by `type=` query parameter. */
function fixtureFetch(overrides: Record<string, () => Response> = {}) {
  return vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input));
    const type = url.searchParams.get('type') ?? '';
    const override = overrides[type];
    if (override) return override();
    switch (type) {
      case 'Currency':
        return jsonResponse(currencyOverview);
      case 'Fragment':
        return jsonResponse(fragmentOverview);
      case 'DivinationCard':
        return jsonResponse(divinationCardOverview);
      case 'Scarab':
        return jsonResponse(scarabOverview);
      default:
        return jsonResponse(emptyOverview);
    }
  }) as unknown as typeof fetch;
}

function service(options: {
  fetchFn?: typeof fetch;
  store?: PriceSetStore;
  now?: () => number;
  ttlMs?: number;
  maxBytes?: number;
  league?: string;
  ninjaLeague?: string | null;
} = {}) {
  return new PriceService({
    league: options.league ?? 'Settlers',
    currencyCategories: ['Currency', 'Fragment'],
    itemCategories: ['DivinationCard', 'Scarab'],
    ttlMs: options.ttlMs ?? 3_600_000,
    store: options.store ?? memoryStore().store,
    fetchFn: options.fetchFn ?? fixtureFetch(),
    now: options.now ?? (() => 0),
    ...(options.ninjaLeague === undefined ? {} : { ninjaLeague: options.ninjaLeague }),
    ...(options.maxBytes === undefined ? {} : { maxBytes: options.maxBytes }),
  });
}

/**
 * A poe.ninja that only answers for `indexedAs`, plus a getindexstate listing it.
 *
 * Everything else 404s, which is exactly what the real API does for a league name it does not
 * recognise — the failure this whole path exists to recover from.
 */
function pickyFetch(indexedAs: string, indexPayload?: unknown) {
  const calls: string[] = [];
  const fetchFn = vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input));
    calls.push(url.pathname + url.search);
    if (url.pathname.endsWith('/getindexstate')) {
      if (indexPayload === undefined) return new Response('not found', { status: 404 });
      return jsonResponse(indexPayload);
    }
    if (url.searchParams.get('league') !== indexedAs) {
      return new Response('not found', { status: 404 });
    }
    return fixtureFetch()(input);
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}

describe('icon collection', () => {
  it('reads currency icons out of currencyDetails, not the lines', () => {
    // currencyoverview puts icons in a sibling array keyed by the same display name.
    const prices: Record<string, number> = {};
    const icons: Record<string, string> = {};
    mergeCurrencyOverview(currencyOverview, prices, icons);
    expect(icons['Divine Orb']).toBe('https://web.poecdn.com/divine.png');
  });

  it('reads item icons off the line itself', () => {
    const prices: Record<string, number> = {};
    const icons: Record<string, string> = {};
    mergeItemOverview(divinationCardOverview, prices, icons);
    expect(icons['The Doctor']).toBe('https://web.poecdn.com/doctor.png');
  });

  it('leaves a line with no icon out rather than inventing one', () => {
    const prices: Record<string, number> = {};
    const icons: Record<string, string> = {};
    mergeItemOverview(scarabOverview, prices, icons);
    // The scarab fixture carries prices but no icons; the prices still land.
    expect(Object.keys(icons)).toHaveLength(0);
    expect(prices['Gilded Bestiary Scarab']).toBe(88.2);
  });

  it('refuses an icon URL that is not https on a poecdn host', () => {
    // The field comes from a remote payload and ends up in an <img src>. A javascript: or
    // data: URL there, or a host that is not GGG's CDN, is not an icon.
    const hostile = {
      lines: [
        { name: 'A', chaosValue: 1, icon: 'javascript:alert(1)' },
        { name: 'B', chaosValue: 1, icon: 'http://web.poecdn.com/b.png' },
        { name: 'C', chaosValue: 1, icon: 'https://evil.example/c.png' },
        { name: 'D', chaosValue: 1, icon: 'https://web.poecdn.com/d.png' },
      ],
    };
    const prices: Record<string, number> = {};
    const icons: Record<string, string> = {};
    mergeItemOverview(hostile, prices, icons);
    expect(icons).toEqual({ D: 'https://web.poecdn.com/d.png' });
  });

  it('carries icons through a fetch onto the price set', async () => {
    const set = await service().getPrices();
    expect(set.icons['Divine Orb']).toBe('https://web.poecdn.com/divine.png');
    expect(set.icons['The Doctor']).toBe('https://web.poecdn.com/doctor.png');
  });
});

describe('mergeCurrencyOverview', () => {
  it('keys by currencyTypeName and chaosEquivalent', () => {
    const prices: Record<string, number> = {};
    mergeCurrencyOverview(currencyOverview, prices);
    expect(prices['Divine Orb']).toBe(218.4);
    expect(prices['Orb of Alteration']).toBe(0.12);
  });

  it('drops lines with no price rather than storing NaN', () => {
    const prices: Record<string, number> = {};
    mergeCurrencyOverview(currencyOverview, prices);
    expect(prices['Mirror of Kalandra']).toBeUndefined();
  });

  it('survives a payload with no lines array', () => {
    const prices: Record<string, number> = {};
    expect(mergeCurrencyOverview({ error: 'nope' }, prices)).toBe(0);
    expect(prices).toEqual({});
  });
});

describe('mergeItemOverview', () => {
  it('keys by name and chaosValue', () => {
    const prices: Record<string, number> = {};
    mergeItemOverview(divinationCardOverview, prices);
    expect(prices['The Doctor']).toBe(1450.5);
  });

  it('lets the first category win when two overviews carry the same name', () => {
    const prices: Record<string, number> = { 'The Doctor': 1 };
    mergeItemOverview(divinationCardOverview, prices);
    expect(prices['The Doctor']).toBe(1);
  });
});

describe('PriceService', () => {
  it('merges every configured category into one flat map', async () => {
    const set = await service().getPrices();

    expect(set.prices['Divine Orb']).toBe(218.4);
    expect(set.prices['Sacrifice at Dusk']).toBe(3.4);
    expect(set.prices['The Doctor']).toBe(1450.5);
    expect(set.prices['Gilded Bestiary Scarab']).toBe(88.2);
  });

  it('always prices chaos at one, since poe.ninja never lists it', async () => {
    const set = await service().getPrices();
    expect(set.prices['Chaos Orb']).toBe(1);
  });

  it('takes the divine rate from the currency set', async () => {
    const set = await service().getPrices();
    expect(set.divineRate).toBe(218.4);
  });

  it('caches for the TTL and refetches once past it', async () => {
    const fetchFn = fixtureFetch();
    let now = 0;
    const subject = service({ fetchFn, now: () => now });

    await subject.getPrices();
    const callsAfterFirst = (fetchFn as unknown as { mock: { calls: unknown[] } }).mock.calls.length;

    now = 59 * 60_000;
    await subject.getPrices();
    expect((fetchFn as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(callsAfterFirst);

    now = 61 * 60_000;
    await subject.getPrices();
    expect((fetchFn as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(
      callsAfterFirst * 2,
    );
  });

  it('collapses concurrent callers onto a single refetch', async () => {
    const fetchFn = fixtureFetch();
    const subject = service({ fetchFn });

    await Promise.all([subject.getPrices(), subject.getPrices(), subject.getPrices()]);

    // Four configured categories, fetched once between them.
    expect((fetchFn as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(4);
  });

  it('persists each fetched set so a restart does not refetch immediately', async () => {
    const { store, saved } = memoryStore();
    await service({ store }).getPrices();
    expect(saved).toHaveLength(1);
    expect(saved[0]?.league).toBe('Settlers');
  });

  it('restores the persisted set on hydrate', async () => {
    const stored: PriceSet = {
      league: 'Settlers',
      fetchedAt: new Date(0),
      prices: { 'Chaos Orb': 1, 'Divine Orb': 200 },
      divineRate: 200,
      icons: {},
      uniques: {},
    };
    const fetchFn = fixtureFetch();
    const subject = service({ fetchFn, store: memoryStore(stored).store, now: () => 60_000 });

    await subject.hydrate();
    const set = await subject.getPrices();

    expect(set.divineRate).toBe(200);
    expect((fetchFn as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(0);
  });

  it('keeps using the previous set when poe.ninja goes down mid-league', async () => {
    let fail = false;
    const fetchFn = vi.fn(async (input: string | URL | Request) => {
      if (fail) return jsonResponse({ error: 'bad gateway' }, 502);
      return fixtureFetch()(input);
    }) as unknown as typeof fetch;

    let now = 0;
    const subject = service({ fetchFn, now: () => now });
    await subject.getPrices();

    fail = true;
    now = 2 * 3_600_000;
    const set = await subject.getPrices();

    // Stale, but a poll with hour-old prices beats a hole in the chart. `fetchedAt` records it.
    expect(set.divineRate).toBe(218.4);
    expect(set.fetchedAt.getTime()).toBe(0);
  });

  it('throws when poe.ninja is down and there is nothing cached at all', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({}, 503)) as unknown as typeof fetch;
    await expect(service({ fetchFn }).getPrices()).rejects.toBeInstanceOf(PriceFetchError);
  });

  it('refuses a price set with no divine rate rather than valuing against zero', async () => {
    const fetchFn = fixtureFetch({ Currency: () => jsonResponse(emptyOverview) });
    await expect(service({ fetchFn }).getPrices()).rejects.toThrow(/Divine Orb/);
  });

  it('rejects unparseable JSON with a clear message', async () => {
    const fetchFn = vi.fn(
      async () => new Response('<html>rate limited</html>', { status: 200 }),
    ) as unknown as typeof fetch;
    await expect(service({ fetchFn }).getPrices()).rejects.toThrow(/not valid JSON/);
  });

  it('names the league and the URL when poe.ninja has no data for it', async () => {
    // A bare "returned HTTP 404" sends someone hunting. The league name and the address they
    // can paste into a browser are the two things that make it a five-second question.
    const fetchFn = vi.fn(
      async () => new Response('not found', { status: 404 }),
    ) as unknown as typeof fetch;

    await expect(service({ fetchFn }).getPrices()).rejects.toThrow(/no Currency data for league "Settlers"/);
    await expect(service({ fetchFn }).getPrices()).rejects.toThrow(/poe\.ninja\/api\/data\/currencyoverview/);
  });

  it('still reports other HTTP failures with the URL', async () => {
    const fetchFn = vi.fn(
      async () => new Response('nope', { status: 503 }),
    ) as unknown as typeof fetch;
    await expect(service({ fetchFn }).getPrices()).rejects.toThrow(/HTTP 503 from https:/);
  });

  it('refuses an oversized overview on its declared length, before buffering it', async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response('{"lines":[]}', {
          status: 200,
          headers: { 'content-length': String(64 * 1024 * 1024) },
        }),
    ) as unknown as typeof fetch;
    await expect(service({ fetchFn, maxBytes: 1024 }).getPrices()).rejects.toThrow(/ceiling/);
  });

  it('stops reading a chunked overview once it passes the ceiling', async () => {
    // No content-length, so the ceiling has to be enforced while the body streams.
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('x'.repeat(4096)));
        controller.close();
      },
    });
    const fetchFn = vi.fn(async () => new Response(body, { status: 200 })) as unknown as typeof fetch;
    await expect(service({ fetchFn, maxBytes: 1024 }).getPrices()).rejects.toThrow(/ceiling/);
  });

  it('reports staleness for /api/health', async () => {
    let now = 0;
    const subject = service({ now: () => now });
    expect(subject.isStale()).toBe(true);

    await subject.getPrices();
    expect(subject.isStale()).toBe(false);

    now = 3_600_001;
    expect(subject.isStale()).toBe(true);
  });
});

describe('resolving the name poe.ninja indexes the league under', () => {
  const indexState = {
    economyLeagues: [{ name: 'Allflame', url: 'allflame' }, { name: 'AllflameHC' }],
  };

  it('asks nothing extra when the two names already agree', async () => {
    // The common case, and the whole reason resolution is a recovery step rather than a
    // preflight: four category requests, no listing lookup.
    const { calls } = pickyFetch('Settlers');
    const fetchFn = fixtureFetch();
    await service({ fetchFn }).getPrices();
    expect(calls).toHaveLength(0);
    expect(
      (fetchFn as unknown as { mock: { calls: unknown[] } }).mock.calls.length,
    ).toBe(4);
  });

  it("retries under poe.ninja's own name after a 404", async () => {
    const { fetchFn, calls } = pickyFetch('Allflame', indexState);
    const set = await service({ fetchFn, league: 'Allflame Ember' }).getPrices();

    expect(set.divineRate).toBe(218.4);
    expect(calls.some((call) => call.includes('/getindexstate'))).toBe(true);
    expect(calls.some((call) => call.includes('league=Allflame&'))).toBe(true);
  });

  it('files the set under the configured league, not poe.ninja\'s name', async () => {
    // The store and every snapshot key on this. Writing "Allflame" for a league configured as
    // "Allflame Ember" would strand the row where hydrate() cannot find it.
    const { store, saved } = memoryStore();
    const { fetchFn } = pickyFetch('Allflame', indexState);
    await service({ fetchFn, store, league: 'Allflame Ember' }).getPrices();
    expect(saved[0]?.league).toBe('Allflame Ember');
  });

  it('resolves once and reuses the name on later refetches', async () => {
    const { fetchFn, calls } = pickyFetch('Allflame', indexState);
    let now = 0;
    const subject = service({ fetchFn, league: 'Allflame Ember', now: () => now });

    await subject.getPrices();
    now = 2 * 3_600_000;
    await subject.getPrices();

    expect(calls.filter((call) => call.includes('/getindexstate'))).toHaveLength(1);
  });

  it('skips resolution entirely when POE_NINJA_LEAGUE says what to use', async () => {
    const { fetchFn, calls } = pickyFetch('Allflame', indexState);
    const set = await service({
      fetchFn,
      league: 'Allflame Ember',
      ninjaLeague: 'Allflame',
    }).getPrices();

    expect(set.divineRate).toBe(218.4);
    expect(calls.some((call) => call.includes('/getindexstate'))).toBe(false);
  });

  it('names the leagues poe.ninja does index when none of them fit', async () => {
    const { fetchFn } = pickyFetch('Allflame', indexState);
    await expect(service({ fetchFn, league: 'Phrecia' }).getPrices()).rejects.toThrow(
      /it currently indexes: Allflame, allflame, AllflameHC/,
    );
  });

  it('reports the original 404 when the listing cannot be read either', async () => {
    // "getindexstate returned HTTP 404" would bury the operator's actual problem behind an
    // endpoint they have never heard of.
    const { fetchFn } = pickyFetch('Allflame');
    await expect(service({ fetchFn, league: 'Phrecia' }).getPrices()).rejects.toThrow(
      /no Currency data for league "Phrecia"/,
    );
  });

  it('does not go looking when the failure is not a 404', async () => {
    const { calls } = pickyFetch('Settlers');
    const fetchFn = vi.fn(async (input: string | URL | Request) => {
      calls.push(String(input));
      return new Response('nope', { status: 503 });
    }) as unknown as typeof fetch;

    await expect(service({ fetchFn }).getPrices()).rejects.toThrow(/HTTP 503/);
    expect(calls.some((call) => call.includes('getindexstate'))).toBe(false);
  });

});
