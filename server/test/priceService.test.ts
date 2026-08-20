import { describe, expect, it, vi } from 'vitest';
import { PriceService, type PriceSet, type PriceSetStore } from '../src/services/priceService.ts';
import {
  CHAOS_ID,
  PriceFetchError,
  coreItems,
  divineRateFrom,
  iconUrl,
  mergeOverview,
  overviewMeta,
  unmatchedIds,
} from '../src/services/ninjaPayload.ts';
import { mergeUniqueOverview, pickCandidate, type UniqueIndex } from '../src/services/uniques.ts';
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

/**
 * The exchange-endpoint calls only.
 *
 * The service talks to two poe.ninja endpoints with the same `type=` vocabulary, and the tests
 * about caching and collapsing are about the priced one. Counting every call would make them
 * fail whenever the other endpoint's category list changes, which is a fact about names and
 * artwork rather than about the cache.
 */
function exchangeCalls(fetchFn: typeof fetch): string[] {
  const { calls } = (fetchFn as unknown as { mock: { calls: unknown[][] } }).mock;
  return calls.map((call) => String(call[0])).filter((url) => url.includes('/exchange/current/'));
}

/** How many times the item endpoint was asked about one `type=`. */
function itemTypeCalls(fetchFn: typeof fetch, type: string): number {
  const { calls } = (fetchFn as unknown as { mock: { calls: unknown[][] } }).mock;
  return calls
    .map((call) => String(call[0]))
    .filter((url) => url.includes('/stash/current/item/') && url.includes(`type=${type}`)).length;
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
  uniqueCategories?: string[];
  /** Off by default for the same reason. The name tests below opt in. */
  namedItemCategories?: readonly string[];
} = {}) {
  return new PriceService({
    league: 'Allflame',
    currencyCategories: ['Currency', 'Fragment'],
    itemCategories: ['DivinationCard', 'Scarab'],
    uniqueCategories: options.uniqueCategories ?? [],
    namedItemCategories: options.namedItemCategories ?? [],
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
    const callsAfterFirst = exchangeCalls(fetchFn).length;

    now = 59 * 60_000;
    await subject.getPrices();
    expect(exchangeCalls(fetchFn).length).toBe(callsAfterFirst);

    now = 61 * 60_000;
    await subject.getPrices();
    expect(exchangeCalls(fetchFn).length).toBe(callsAfterFirst * 2);
  });

  it('collapses concurrent callers onto a single refetch', async () => {
    const fetchFn = fixtureFetch();
    const subject = service({ fetchFn });

    await Promise.all([subject.getPrices(), subject.getPrices(), subject.getPrices()]);

    // Four configured categories, fetched once between them.
    expect(exchangeCalls(fetchFn).length).toBe(4);
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
      names: {},
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
      names: {},
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

describe('the item endpoint, read into the variant index', () => {
  // Shaped exactly as scripts/probe.mjs recorded it from stash/current/item. The full key list
  // it saw was: baseType, chaosValue, count, detailsId, divineValue, exaltedValue,
  // explicitModifiers, flavourText, icon, id, implicitModifiers, itemClass, itemType,
  // levelRequired, links, listingCount, name, sparkLine, and on some types mutatedModifiers,
  // tradeInfo, variant. Note what is absent: corruption.
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

  function index(): UniqueIndex {
    const into: UniqueIndex = Object.create(null) as UniqueIndex;
    mergeUniqueOverview(payload, into, iconUrl);
    return into;
  }

  it('keeps a line per variant rather than one per name', () => {
    // The whole reason uniques went unpriced: a price with no links on it cannot say whether it
    // is the five-chaos one or the two-hundred-and-ten-chaos one.
    expect(index()['Bronn’s Lithe']?.map((line) => [line.links, line.chaos])).toEqual([
      [0, 5.2],
      [6, 210],
    ]);
  });

  it('drops the unusable lines rather than storing a zero', () => {
    expect(Object.keys(index()).sort()).toEqual(['Bronn’s Lithe', 'Progenesis']);
  });

  it('prices a six-link as a six-link and a plain one as plain', () => {
    const lines = index()['Bronn’s Lithe'] ?? [];

    expect(pickCandidate(lines, 6, false)?.price.chaos).toBe(210);
    expect(pickCandidate(lines, 0, false)?.price.chaos).toBe(5.2);
  });

  it('says a corrupted item was approximated, because the payload has no corruption on it', () => {
    // Not a shortcoming of this code: poe.ninja publishes no `corrupted` field on these lines
    // at all. The item is priced as the uncorrupted six-link, and the caller is told so rather
    // than left to assume the number is exact.
    const picked = pickCandidate(index()['Bronn’s Lithe'] ?? [], 6, true);

    expect(picked?.price.chaos).toBe(210);
    expect(picked?.exact).toBe(false);
  });

  it('validates the icon like every other URL out of a remote payload', () => {
    const into: UniqueIndex = Object.create(null) as UniqueIndex;
    mergeUniqueOverview({ lines: [{ name: 'X', chaosValue: 1, icon: 'javascript:alert(1)' }] }, into, iconUrl);

    expect(into.X?.[0]?.icon).toBeNull();
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

  it('fills the variant index the valuation reads', async () => {
    const set = await service({
      fetchFn: bothEndpoints(itemBody),
      uniqueCategories: ['UniqueArmour'],
    }).getPrices();

    expect(set.uniques['Tabula Rasa']).toHaveLength(2);
    expect(pickCandidate(set.uniques['Tabula Rasa'] ?? [], 6, false)?.price.chaos).toBe(12.5);
    expect(pickCandidate(set.uniques['Tabula Rasa'] ?? [], 0, false)?.price.chaos).toBe(40);
  });

  it('leaves the id-keyed map alone', async () => {
    const set = await service({
      fetchFn: bothEndpoints(itemBody),
      uniqueCategories: ['UniqueArmour'],
    }).getPrices();

    // `prices` is keyed by poe.ninja id and is what resolvePrice falls through to. A unique in
    // there would be priced by name, which is the whole thing the variant index exists to avoid.
    expect(set.prices['tabula-rasa']).toBeUndefined();
    expect(Object.keys(set.prices)).not.toContain('Tabula Rasa');
  });

  it('still produces a price set when the item endpoint is down', async () => {
    // Losing uniques costs the total its uniques. Losing the exchange prices costs it
    // everything, so one must not be able to take the other with it.
    const set = await service({
      fetchFn: bothEndpoints(itemBody, { failItems: true }),
      uniqueCategories: ['UniqueArmour'],
    }).getPrices();

    expect(set.uniques).toEqual({});
    expect(set.prices.chaos).toBe(1);
  });

  it('asks for no uniques when the unique category list is empty', async () => {
    const fetchFn = vi.fn(bothEndpoints(itemBody) as never) as unknown as typeof fetch;
    await service({ fetchFn, uniqueCategories: [] }).getPrices();

    // The item endpoint is still reached, for the names and artwork the economy list needs —
    // that is a different list of categories and a different reason. What must not happen is a
    // request for a unique type nobody asked to price.
    const urls = (fetchFn as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((call) => String(call[0]));
    expect(urls.filter((url) => url.includes('type=Unique'))).toEqual([]);
  });
});

/**
 * Names and artwork for the ordinary categories, which is what the economy list was missing.
 *
 * The prices come from the exchange endpoint, keyed by id and carrying no names. These tests
 * are about the second request that puts a name and an icon against those ids, and about it
 * costing nothing when poe.ninja has nothing to give.
 */
describe('PriceService and item names', () => {
  /** Exchange fixtures as usual; the item endpoint answers with whatever is handed in. */
  /** The categories these tests pretend the endpoint serves. */
  const named = ['DivinationCard', 'Scarab'];

  function withItemNames(byType: Record<string, unknown>): typeof fetch {
    const exchange = fixtureFetch();
    return vi.fn((async (url: string, init?: RequestInit) => {
      const parsed = new URL(String(url));
      if (parsed.pathname.includes('/stash/current/item/')) {
        const body = byType[parsed.searchParams.get('type') ?? ''] ?? { lines: [] };
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return (exchange as unknown as (u: string, i?: RequestInit) => Promise<Response>)(url, init);
    }) as unknown as typeof fetch);
  }

  const cards = {
    lines: [
      {
        name: "Hinekora's Lock",
        icon: 'https://web.poecdn.com/hinekora.png',
      },
      { name: 'The Doctor', icon: 'https://web.poecdn.com/doctor.png' },
    ],
  };

  it('files the name under the id the price came under', async () => {
    const set = await service({ fetchFn: withItemNames({ DivinationCard: cards }), namedItemCategories: named }).getPrices();

    // The join that makes the whole thing work: poe.ninja's name, run through the same slug
    // rule the prices are keyed by, lands on the id the exchange endpoint used.
    expect(set.names['hinekoras-lock']).toBe("Hinekora's Lock");
    expect(set.names['the-doctor']).toBe('The Doctor');
  });

  it('files the artwork under that same name, which is where the views look for it', async () => {
    const set = await service({ fetchFn: withItemNames({ DivinationCard: cards }), namedItemCategories: named }).getPrices();

    expect(set.icons["Hinekora's Lock"]).toBe('https://web.poecdn.com/hinekora.png');
  });

  it('refuses artwork from anywhere but the two CDNs, name or no name', async () => {
    const hostile = {
      lines: [{ name: 'Nice Try', icon: 'https://example.invalid/tracker.png' }],
    };
    const set = await service({ fetchFn: withItemNames({ DivinationCard: hostile }), namedItemCategories: named }).getPrices();

    // The name is fine to keep — it is only ever text. The URL is the thing that would end up
    // in an <img src>, and this one is not from poecdn or poe.ninja.
    expect(set.names['nice-try']).toBe('Nice Try');
    expect(set.icons['Nice Try']).toBeUndefined();
  });

  it('stops asking a category that answered with nothing', async () => {
    // The set of categories this endpoint serves is not documented and was found by probing.
    // Being wrong about one should cost a single request, not one an hour for as long as the
    // program runs.
    const fetchFn = withItemNames({ DivinationCard: cards });
    const subject = service({ fetchFn, ttlMs: 0, namedItemCategories: named });

    await subject.getPrices();
    await subject.getPrices();

    // Scarab answered with no lines the first time, so the second refresh does not ask again;
    // DivinationCard answered with names, so it is asked every time.
    expect(itemTypeCalls(fetchFn, 'Scarab')).toBe(1);
    expect(itemTypeCalls(fetchFn, 'DivinationCard')).toBe(2);
  });

  it('stops asking a category the endpoint has never heard of', async () => {
    // The failure that actually happens, and the one this originally got wrong. Eleven of the
    // thirteen categories the app prices answer 404 here. A 404 threw straight past the "asked
    // once, answered with nothing" skip, which only covered a successful reply with no lines —
    // so those eleven were re-requested on every poll, for as long as the program ran.
    const exchange = fixtureFetch();
    const fetchFn = vi.fn((async (url: string, init?: RequestInit) => {
      if (String(url).includes('/stash/current/item/')) return new Response('nope', { status: 404 });
      return (exchange as unknown as (u: string, i?: RequestInit) => Promise<Response>)(url, init);
    }) as unknown as typeof fetch);
    const subject = service({ fetchFn, ttlMs: 0, namedItemCategories: named });

    await subject.getPrices();
    await subject.getPrices();
    await subject.getPrices();

    expect(itemTypeCalls(fetchFn, 'DivinationCard')).toBe(1);
    expect(itemTypeCalls(fetchFn, 'Scarab')).toBe(1);
  });

  it('keeps asking after a failure that is only a bad moment', async () => {
    // The other half, and the reason this is not simply "give up on any error". A 503 is
    // poe.ninja having a minute, not poe.ninja saying the category does not exist, and treating
    // the two alike would lose the names until somebody restarted the program.
    const exchange = fixtureFetch();
    const fetchFn = vi.fn((async (url: string, init?: RequestInit) => {
      if (String(url).includes('/stash/current/item/')) return new Response('later', { status: 503 });
      return (exchange as unknown as (u: string, i?: RequestInit) => Promise<Response>)(url, init);
    }) as unknown as typeof fetch);
    const subject = service({ fetchFn, ttlMs: 0, namedItemCategories: named });

    await subject.getPrices();
    await subject.getPrices();

    expect(itemTypeCalls(fetchFn, 'DivinationCard')).toBe(2);
  });

  it('prices a category the exchange endpoint answers empty for', async () => {
    // Vials are the real case: they are in the app's price categories, the exchange endpoint
    // returns zero lines for them, and every Vial in a stash was therefore counted at nothing.
    // An unpriced item is absent from the breakdown, and absent looks exactly like owning none.
    const vials = { lines: [{ name: 'Vial of the Ghost', icon: 'https://web.poecdn.com/vial.png', chaosValue: 44 }] };
    const set = await service({
      fetchFn: withItemNames({ DivinationCard: vials }),
      namedItemCategories: named,
    }).getPrices();

    expect(set.prices['vial-of-the-ghost']).toBe(44);
    expect(set.categories['vial-of-the-ghost']).toBe('DivinationCard');
  });

  it('never overwrites a price the exchange endpoint gave', async () => {
    // The priced endpoint stays the authority. This one only fills gaps — which is also what
    // keeps it from quietly becoming a second, name-keyed valuation path.
    const clash = { lines: [{ name: 'Divine Orb', icon: null, chaosValue: 1 }] };
    const set = await service({
      fetchFn: withItemNames({ DivinationCard: clash }),
      namedItemCategories: named,
    }).getPrices();

    expect(set.prices.divine).toBeGreaterThan(1);
  });

  it('loses names rather than prices when the endpoint is down', async () => {
    const exchange = fixtureFetch();
    const fetchFn = (async (url: string, init?: RequestInit) => {
      if (String(url).includes('/stash/current/item/')) return new Response('nope', { status: 503 });
      return (exchange as unknown as (u: string, i?: RequestInit) => Promise<Response>)(url, init);
    }) as unknown as typeof fetch;

    const set = await service({ fetchFn, namedItemCategories: named }).getPrices();

    // Not empty: `core.items` rides along on the price payload, so chaos and divine keep their
    // names even with the other endpoint refusing. What is lost is the long tail it would have
    // added — and no price is lost at all, which is the point.
    expect(set.names).toEqual({ chaos: 'Chaos Orb', divine: 'Divine Orb' });
    expect(set.prices.chaos).toBe(1);
    expect(Object.keys(set.prices).length).toBeGreaterThan(1);
  });

  it('takes a name straight from core.items without going through the slug rule', async () => {
    // The only place the exchange endpoint puts an id and a name on the same object. Everywhere
    // else the name has to be turned back into an id, and a name that does not round-trip is
    // lost; here nothing can be.
    const set = await service({ fetchFn: withItemNames({}), namedItemCategories: named }).getPrices();

    expect(set.names.divine).toBe('Divine Orb');
  });
});
