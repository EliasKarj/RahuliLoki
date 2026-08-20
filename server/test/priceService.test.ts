import { describe, expect, it, vi } from 'vitest';
import { PriceService, type PriceSet, type PriceSetStore } from '../src/services/priceService.ts';
import {
  CHAOS_ID,
  PriceFetchError,
  coreItems,
  divineRateFrom,
  iconUrl,
  cheapestByName,
  itemOverview,
  mergeOverview,
  overviewMeta,
  unmatchedIds,
} from '../src/services/ninjaPayload.ts';
import {
  bareOverview,
  core,
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
    history: async () => [],
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
  /** Off by default: these tests are about the exchange endpoint, and it is a separate service. */
  uniqueItemCategories?: string[];
} = {}) {
  return new PriceService({
    league: 'Allflame',
    currencyCategories: ['Currency', 'Fragment'],
    itemCategories: ['DivinationCard', 'Scarab'],
    uniqueItemCategories: options.uniqueItemCategories ?? [],
    ttlMs: options.ttlMs ?? 3_600_000,
    store: options.store ?? memoryStore().store,
    fetchFn: options.fetchFn ?? fixtureFetch(),
    now: options.now ?? (() => 0),
    ...(options.maxBytes === undefined ? {} : { maxBytes: options.maxBytes }),
  });
}

describe('the request it makes', () => {
  it('asks the per-game endpoint, not the retired /api/data one', async () => {
    // /api/data answers a bare "not found" for every league, including Standard: it predates
    // poe.ninja serving two games and carries nothing to say which one is meant.
    const fetchFn = fixtureFetch();
    await service({ fetchFn }).getPrices();

    const urls = (fetchFn as unknown as { mock: { calls: [string][] } }).mock.calls.map(
      ([input]) => String(input),
    );
    expect(urls[0]).toBe(
      'https://poe.ninja/poe1/api/economy/exchange/current/overview?league=Allflame&type=Currency',
    );
    expect(urls.every((url) => !url.includes('/api/data'))).toBe(true);
  });

  it("sends GGG's league name unchanged", async () => {
    // index-state lists "Allflame" and "Hardcore Allflame" — the same spelling GGG uses. There
    // is no separate poe.ninja league vocabulary to translate into.
    const fetchFn = fixtureFetch();
    await new PriceService({
      league: 'Hardcore Allflame',
      currencyCategories: ['Currency'],
      itemCategories: [],
      ttlMs: 1,
      store: memoryStore().store,
      fetchFn,
      now: () => 0,
    }).getPrices();

    const { calls } = (fetchFn as unknown as { mock: { calls: [string][] } }).mock;
    expect(new URL(String(calls[0]?.[0])).searchParams.get('league')).toBe('Hardcore Allflame');
  });
});

describe('iconUrl', () => {
  it('resolves poe.ninja\'s relative image paths against its origin', () => {
    // `<img src="/gen/image/…">` in the dashboard would resolve against our own origin and 404.
    expect(iconUrl('/gen/image/abc/CurrencyRerollRare.png')).toBe(
      'https://poe.ninja/gen/image/abc/CurrencyRerollRare.png',
    );
  });

  it('still accepts GGG\'s CDN, which older price sets point at', () => {
    expect(iconUrl('https://web.poecdn.com/divine.png')).toBe('https://web.poecdn.com/divine.png');
  });

  it('refuses anything that is not https on an allowed host', () => {
    // The field comes from a remote payload and ends up in an <img src>. A javascript: or data:
    // URL there, or a host that is neither GGG's CDN nor poe.ninja, is not an icon.
    expect(iconUrl('javascript:alert(1)')).toBeNull();
    expect(iconUrl('http://web.poecdn.com/b.png')).toBeNull();
    expect(iconUrl('https://evil.example/c.png')).toBeNull();
    expect(iconUrl('data:image/png;base64,AAAA')).toBeNull();
    expect(iconUrl('')).toBeNull();
    expect(iconUrl(42)).toBeNull();
  });
});

describe('coreItems', () => {
  it('reads the pricing pair with its names and icons', () => {
    const items = coreItems(currencyOverview);
    expect(items.map((item) => item.id)).toEqual(['chaos', 'divine']);
    expect(items[0]?.name).toBe('Chaos Orb');
    expect(items[0]?.icon).toMatch(/^https:\/\/poe\.ninja\/gen\/image\//);
  });

  it('returns nothing rather than throwing when core is absent', () => {
    expect(coreItems(bareOverview)).toEqual([]);
    expect(coreItems(null)).toEqual([]);
  });
});

describe('mergeOverview', () => {
  it('keys by the line id and reads primaryValue', () => {
    const prices: Record<string, number> = {};
    mergeOverview(currencyOverview, prices);
    expect(prices['alt']).toBe(0.1238);
    expect(prices['divine']).toBe(196.9);
    expect(prices['ancient-orb']).toBe(8.27);
  });

  it('drops lines with no price rather than storing NaN', () => {
    const prices: Record<string, number> = {};
    mergeOverview(currencyOverview, prices);
    expect(prices['mirror']).toBeUndefined();
  });

  it('lets the first category win when two overviews carry the same id', () => {
    const prices: Record<string, number> = { 'the-doctor': 1 };
    mergeOverview(divinationCardOverview, prices);
    expect(prices['the-doctor']).toBe(1);
  });

  it('survives a payload with no lines array', () => {
    const prices: Record<string, number> = {};
    expect(mergeOverview({ error: 'nope' }, prices)).toBe(0);
    expect(prices).toEqual({});
  });

  it('keys icons by display name, which is how every lookup asks for them', () => {
    // Keyed by id they matched nothing: the breakdown a person reads is keyed by name, so even
    // chaos and divine — the only two items the API still names — never showed an icon.
    const prices: Record<string, number> = {};
    const icons: Record<string, string> = {};
    mergeOverview(currencyOverview, prices, icons);

    expect(icons['Chaos Orb']).toMatch(/CurrencyRerollRare\.png$/);
    // And nothing for the rest: the API no longer publishes their icons at all. Everything else
    // the dashboard shows comes from the stash — see StashItem.icon.
    expect(Object.keys(icons).sort()).toEqual(['Chaos Orb', 'Divine Orb']);
  });

  it('refuses a payload quoted in something other than chaos', () => {
    // Reading divine-denominated numbers as chaos would multiply the chart by ~200, and a chart
    // wrong by a constant factor is harder to notice than an empty one.
    const prices: Record<string, number> = {};
    expect(() =>
      mergeOverview({ core: { primary: 'divine' }, lines: [{ id: 'x', primaryValue: 1 }] }, prices),
    ).toThrow(/rather than chaos/);
  });
});

describe('divineRateFrom', () => {
  it('prefers the divine line, which is already chaos-denominated', () => {
    const prices: Record<string, number> = {};
    mergeOverview(currencyOverview, prices);
    expect(divineRateFrom(currencyOverview, prices)).toBe(196.9);
  });

  it('falls back to core.rates, inverting it', () => {
    // core.rates.divine is divine-per-chaos; this app reports chaos-per-divine.
    expect(divineRateFrom({ core }, {})).toBeCloseTo(1 / 0.00508, 6);
  });

  it('returns null when neither is present', () => {
    expect(divineRateFrom(bareOverview, {})).toBeNull();
  });
});

describe('PriceService', () => {
  it('merges every configured category into one flat map', async () => {
    const set = await service().getPrices();

    expect(set.prices['alt']).toBe(0.1238);
    expect(set.prices['sacrifice-at-dusk']).toBe(3.4);
    expect(set.prices['the-doctor']).toBe(1450.5);
    expect(set.prices['gilded-bestiary-scarab']).toBe(88.2);
  });

  it('always prices chaos at one', async () => {
    const set = await service().getPrices();
    expect(set.prices[CHAOS_ID]).toBe(1);
  });

  it('takes the divine rate from the currency set', async () => {
    const set = await service().getPrices();
    expect(set.divineRate).toBe(196.9);
  });

  it('leaves uniques empty, because the API no longer publishes variants', async () => {
    // Not an oversight. Without `links` and `corrupted` a unique cannot be priced per variant,
    // and pricing it by name would be wrong by up to fortyfold with nothing to show it.
    const set = await service().getPrices();
    expect(set.uniques).toEqual({});
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
    expect(saved[0]?.league).toBe('Allflame');
  });

  it('restores the persisted set on hydrate', async () => {
    const stored: PriceSet = {
      league: 'Allflame',
      fetchedAt: new Date(0),
      prices: { chaos: 1, divine: 200 },
      divineRate: 200,
      icons: {},
      uniques: {},
      categories: {},
      meta: {},
      uniquePrices: {},
    };
    const fetchFn = fixtureFetch();
    const subject = service({ fetchFn, store: memoryStore(stored).store, now: () => 60_000 });

    await subject.hydrate();
    const set = await subject.getPrices();

    expect(set.divineRate).toBe(200);
    expect((fetchFn as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(0);
  });

  it('discards a price set written against the old name-keyed API', async () => {
    // Rows saved before the redesign are keyed "Chaos Orb", not "chaos". Restoring one would
    // match nothing and read as a stash that suddenly became worthless.
    const stale: PriceSet = {
      league: 'Allflame',
      fetchedAt: new Date(0),
      prices: { 'Chaos Orb': 1, 'Divine Orb': 200 },
      divineRate: 200,
      icons: {},
      uniques: {},
      categories: {},
      meta: {},
      uniquePrices: {},
    };
    const subject = service({ store: memoryStore(stale).store, now: () => 0 });

    expect(await subject.hydrate()).toBeNull();
    expect(subject.cached).toBeNull();

    const set = await subject.getPrices();
    expect(set.divineRate).toBe(196.9);
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
    expect(set.divineRate).toBe(196.9);
    expect(set.fetchedAt.getTime()).toBe(0);
  });

  it('throws when poe.ninja is down and there is nothing cached at all', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({}, 503)) as unknown as typeof fetch;
    await expect(service({ fetchFn }).getPrices()).rejects.toBeInstanceOf(PriceFetchError);
  });

  it('refuses a price set with no divine rate rather than valuing against zero', async () => {
    // Every category, not just Currency: the rate is taken from whichever payload states it
    // first, so leaving one intact would supply one and hide the failure this asserts.
    const fetchFn = vi.fn(async () => jsonResponse(bareOverview)) as unknown as typeof fetch;
    await expect(service({ fetchFn }).getPrices()).rejects.toThrow(/divine rate/);
  });

  it('takes the rate from a later category when the first one omits it', async () => {
    // A poll that fails because one payload was thin, while another carried the answer, would
    // be a hole in the chart with no cause worth having.
    const fetchFn = fixtureFetch({ Currency: () => jsonResponse(bareOverview) });
    const set = await service({ fetchFn }).getPrices();
    expect(set.divineRate).toBeCloseTo(1 / 0.00508, 6);
  });

  it('rejects unparseable JSON with a clear message', async () => {
    const fetchFn = vi.fn(
      async () => new Response('<html>rate limited</html>', { status: 200 }),
    ) as unknown as typeof fetch;
    await expect(service({ fetchFn }).getPrices()).rejects.toThrow(/not valid JSON/);
  });

  it('names the league and the URL when poe.ninja has no data for it', async () => {
    const fetchFn = vi.fn(
      async () => new Response('not found', { status: 404 }),
    ) as unknown as typeof fetch;

    await expect(service({ fetchFn }).getPrices()).rejects.toThrow(
      /no Currency data for league "Allflame"/,
    );
    await expect(service({ fetchFn }).getPrices()).rejects.toThrow(
      /poe\.ninja\/poe1\/api\/economy\/exchange\/current\/overview/,
    );
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

describe('unmatchedIds', () => {
  it('reports short codes nothing claimed, which is what a missing alias looks like', () => {
    const prices = { chaos: 1, alt: 0.12, fusing: 3, 'ancient-orb': 8 };
    expect(unmatchedIds(prices, new Set(['chaos']))).toEqual(['alt', 'fusing']);
  });

  it('ignores slugs, since those are just items the account does not hold', () => {
    const prices = { 'the-doctor': 1450, 'rain-of-chaos': 0.3 };
    expect(unmatchedIds(prices, new Set())).toEqual([]);
  });

  it('caps the list so one report cannot flood the log', () => {
    const prices = Object.fromEntries(
      Array.from({ length: 100 }, (_, index) => [`id${index}`, 1]),
    );
    expect(unmatchedIds(prices, new Set(), 5)).toHaveLength(5);
  });
});

describe('rememberIcons', () => {
  it('folds in icons the poll found and persists them', async () => {
    // The stash is where icons come from now, and this is how they reach the read path that
    // joins them onto the breakdown.
    const { store, saved } = memoryStore();
    const subject = service({ store });
    await subject.getPrices();
    const before = saved.length;

    const added = await subject.rememberIcons({ 'The Doctor': 'https://web.poecdn.com/doc.png' });

    expect(added).toBe(1);
    expect(subject.cached?.icons['The Doctor']).toBe('https://web.poecdn.com/doc.png');
    expect(saved.length).toBe(before + 1);
  });

  it('writes nothing when it learned nothing', async () => {
    // Every poll passes the same icons. Rewriting the row 144 times a day for no difference is
    // a write nobody asked for.
    const { store, saved } = memoryStore();
    const subject = service({ store });
    await subject.getPrices();
    await subject.rememberIcons({ 'The Doctor': 'https://web.poecdn.com/doc.png' });
    const after = saved.length;

    const added = await subject.rememberIcons({ 'The Doctor': 'https://web.poecdn.com/doc.png' });

    expect(added).toBe(0);
    expect(saved.length).toBe(after);
  });

  it('keeps the icon it already had rather than churning on a changed URL', async () => {
    const subject = service();
    await subject.getPrices();
    await subject.rememberIcons({ 'The Doctor': 'https://web.poecdn.com/a.png' });
    await subject.rememberIcons({ 'The Doctor': 'https://web.poecdn.com/b.png' });

    expect(subject.cached?.icons['The Doctor']).toBe('https://web.poecdn.com/a.png');
  });

  it("lets the stash's artwork replace poe.ninja's", async () => {
    // poe.ninja publishes icons for chaos and divine only, off its own origin. Those two are
    // the most-shown items in the app — the headline figure carries one of them — so having
    // them come from somewhere other than every other icon is exactly the wrong exception.
    const { store, saved } = memoryStore();
    const subject = service({ store });
    await subject.getPrices();
    (subject.cached as PriceSet).icons['Divine Orb'] = 'https://poe.ninja/gen/image/divine.png';
    const before = saved.length;

    const written = await subject.rememberIcons({
      'Divine Orb': 'https://web.poecdn.com/divine.png',
    });

    expect(written).toBe(1);
    expect(subject.cached?.icons['Divine Orb']).toBe('https://web.poecdn.com/divine.png');
    expect(saved.length).toBe(before + 1);
  });

  it('does not let poe.ninja take a name back from the stash', async () => {
    // The replacement runs one way only. Otherwise the two would trade places on every poll and
    // rewrite the row for it.
    const subject = service();
    await subject.getPrices();
    await subject.rememberIcons({ 'Divine Orb': 'https://web.poecdn.com/divine.png' });

    const written = await subject.rememberIcons({
      'Divine Orb': 'https://poe.ninja/gen/image/divine.png',
    });

    expect(written).toBe(0);
    expect(subject.cached?.icons['Divine Orb']).toBe('https://web.poecdn.com/divine.png');
  });

  it('does nothing at all when there is no price set yet', async () => {
    const subject = service();
    expect(await subject.rememberIcons({ 'The Doctor': 'https://web.poecdn.com/doc.png' })).toBe(0);
  });
});

describe('categories', () => {
  it('records the type each id was fetched under', async () => {
    // The payload says nothing about which category it answered — only the request knows. If it
    // is not captured here it cannot be recovered later without guessing from an item's name.
    const set = await service().getPrices();

    expect(set.categories['alt']).toBe('Currency');
    expect(set.categories['sacrifice-at-dusk']).toBe('Fragment');
    expect(set.categories['the-doctor']).toBe('DivinationCard');
    expect(set.categories['gilded-bestiary-scarab']).toBe('Scarab');
  });

  it('lets the first category win, matching how the price is merged', () => {
    const prices: Record<string, number> = {};
    const categories: Record<string, string> = {};
    mergeOverview(currencyOverview, prices, {}, categories, 'Currency');
    mergeOverview(currencyOverview, prices, {}, categories, 'Fragment');
    expect(categories['alt']).toBe('Currency');
  });

  it('records nothing when no category was given', () => {
    const categories: Record<string, string> = {};
    mergeOverview(currencyOverview, {}, {}, categories);
    expect(categories).toEqual({});
  });
});

describe('overviewMeta', () => {
  it('reads the change, the volume and the series poe.ninja publishes', () => {
    const meta = overviewMeta(currencyOverview);

    expect(meta.chaos).toEqual({ change: 7.14, volume: 19156804, sparkline: [2.59, 6.65, 7.14] });
  });

  it('records a line that has only some of the three', () => {
    const meta = overviewMeta(currencyOverview);

    // `divine` carries a volume and no sparkline; `alt` carries a volume alone.
    expect(meta.divine).toEqual({ change: null, volume: 19156804, sparkline: [] });
    expect(meta.alt).toEqual({ change: null, volume: 97366, sparkline: [] });
  });

  it('leaves out a line that publishes none of it', () => {
    // Absent movement has to stay absent. A row of zeroes would draw a flat sparkline and read
    // as "this price has not moved", which is a different claim from "nothing was published".
    expect(overviewMeta(currencyOverview).annul).toBeUndefined();
  });

  it('drops a series with something that is not a number in it', () => {
    const meta = overviewMeta({
      lines: [{ id: 'x', sparkline: { totalChange: 1, data: [1, 'two', null, 3] } }],
    });

    expect(meta.x?.sparkline).toEqual([1, 3]);
  });

  it('survives a payload with no lines, or nonsense where they should be', () => {
    expect(overviewMeta({})).toEqual({});
    expect(overviewMeta(null)).toEqual({});
    expect(overviewMeta({ lines: 'nope' })).toEqual({});
    expect(overviewMeta({ lines: [{ id: 'x', sparkline: 'nope' }] })).toEqual({});
  });

  it('refuses a negative volume rather than reporting one', () => {
    expect(overviewMeta({ lines: [{ id: 'x', volumePrimaryValue: -5 }] })).toEqual({});
  });
});

describe('itemOverview', () => {
  // Shaped exactly as scripts/probe.mjs recorded it from stash/current/item — names on every
  // line, which is the thing the exchange endpoint does not have.
  const payload = {
    lines: [
      {
        name: 'Bronn’s Lithe',
        baseType: "Cutthroat's Garb",
        chaosValue: 5.2,
        icon: 'https://web.poecdn.com/bronns.png',
        listingCount: 412,
        links: 0,
      },
      {
        name: 'Bronn’s Lithe',
        baseType: "Cutthroat's Garb",
        chaosValue: 210,
        icon: 'https://web.poecdn.com/bronns.png',
        listingCount: 18,
        links: 6,
      },
      { name: 'Progenesis', baseType: 'Amethyst Flask', chaosValue: 12518, listingCount: 7 },
      // Rejects, one of each kind.
      { name: '', chaosValue: 5 },
      { name: 'No price', chaosValue: 0 },
      { name: 'Not a number', chaosValue: 'lots' },
    ],
  };

  it('reads the named lines and drops the unusable ones', () => {
    const prices = itemOverview(payload);

    expect(prices).toHaveLength(3);
    expect(prices.map((price) => price.name)).toEqual(['Bronn’s Lithe', 'Bronn’s Lithe', 'Progenesis']);
  });

  it('keeps the links, which is the field the other endpoint does not have', () => {
    // The whole reason uniques went unpriced: a price with no links on it cannot say whether it
    // is the five-chaos one or the two-hundred-and-ten-chaos one.
    expect(itemOverview(payload).map((price) => price.links)).toEqual([0, 6, null]);
  });

  it('validates the icon like every other URL out of a remote payload', () => {
    const prices = itemOverview({
      lines: [{ name: 'X', chaosValue: 1, icon: 'javascript:alert(1)' }],
    });

    expect(prices[0]?.icon).toBeNull();
  });

  it('does not merge the variants, because choosing between them is not parsing', () => {
    expect(itemOverview(payload).filter((price) => price.name === 'Bronn’s Lithe')).toHaveLength(2);
  });

  it('survives a payload with no lines', () => {
    expect(itemOverview({})).toEqual([]);
    expect(itemOverview(null)).toEqual([]);
    expect(itemOverview({ lines: 'nope' })).toEqual([]);
  });

  it('takes the cheapest per name, so an unmatched item is never valued above what it may be', () => {
    const cheapest = cheapestByName(itemOverview(payload));

    expect(cheapest['Bronn’s Lithe']).toBe(5.2);
    expect(cheapest.Progenesis).toBe(12518);
  });
});

describe('PriceService and the item endpoint', () => {
  /** A fetch that answers the exchange endpoint from fixtures and the item one from here. */
  function bothEndpoints(itemBody: unknown, options: { failItems?: boolean } = {}): typeof fetch {
    const exchange = fixtureFetch();
    return (async (url: string, init?: RequestInit) => {
      if (String(url).includes('/stash/current/item/')) {
        if (options.failItems) return new Response('nope', { status: 503 });
        return new Response(JSON.stringify(itemBody), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return (exchange as unknown as (u: string, i?: RequestInit) => Promise<Response>)(url, init);
    }) as unknown as typeof fetch;
  }

  const itemBody = {
    lines: [
      { name: 'Tabula Rasa', baseType: 'Simple Robe', chaosValue: 12.5, listingCount: 900, links: 6 },
      { name: 'Tabula Rasa', baseType: 'Simple Robe', chaosValue: 40, listingCount: 3, links: 0 },
      { name: 'Headhunter', baseType: 'Leather Belt', chaosValue: 90000, listingCount: 12 },
    ],
  };

  it('reads unique prices into a map of their own, cheapest variant per name', async () => {
    const set = await service({
      fetchFn: bothEndpoints(itemBody),
      uniqueItemCategories: ['UniqueArmour'],
    }).getPrices();

    expect(set.uniquePrices['Tabula Rasa']).toBe(12.5);
    expect(set.uniquePrices.Headhunter).toBe(90000);
  });

  it('keeps them out of the map the valuation reads', async () => {
    const set = await service({
      fetchFn: bothEndpoints(itemBody),
      uniqueItemCategories: ['UniqueArmour'],
    }).getPrices();

    // The whole point of the separate column. `prices` is keyed by poe.ninja id and is what
    // resolvePrice falls through to, so a unique in there would start counting towards net worth
    // by name — a change to make deliberately, not as a side effect of fetching prices.
    expect(set.prices['tabula-rasa']).toBeUndefined();
    expect(Object.keys(set.prices)).not.toContain('Tabula Rasa');
  });

  it('still produces a price set when the item endpoint is down', async () => {
    // Uniques are decoration on the wealth total; the exchange prices are the total. One must
    // not be able to take the other with it.
    const set = await service({
      fetchFn: bothEndpoints(itemBody, { failItems: true }),
      uniqueItemCategories: ['UniqueArmour'],
    }).getPrices();

    expect(set.uniquePrices).toEqual({});
    expect(set.prices.chaos).toBe(1);
  });

  it('asks for nothing when the category list is empty', async () => {
    const fetchFn = vi.fn(bothEndpoints(itemBody) as never) as unknown as typeof fetch;
    await service({ fetchFn, uniqueItemCategories: [] }).getPrices();

    const urls = (fetchFn as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((call) => String(call[0]));
    expect(urls.some((url) => url.includes('/stash/current/item/'))).toBe(false);
  });
});
