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
} = {}) {
  return new PriceService({
    league: 'Settlers',
    currencyCategories: ['Currency', 'Fragment'],
    itemCategories: ['DivinationCard', 'Scarab'],
    ttlMs: options.ttlMs ?? 3_600_000,
    store: options.store ?? memoryStore().store,
    fetchFn: options.fetchFn ?? fixtureFetch(),
    now: options.now ?? (() => 0),
    ...(options.maxBytes === undefined ? {} : { maxBytes: options.maxBytes }),
  });
}

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
