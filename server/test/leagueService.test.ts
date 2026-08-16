/**
 * The league list.
 *
 * Note on the fixture: this is built from GGG's documented response shape, not recorded from a
 * live call — the development environment cannot reach pathofexile.com. That is exactly why the
 * parser is written to tolerate a shape it has not seen and why the failure path gets as much
 * attention as the happy one: an empty dropdown would be worse than the text field it replaced.
 */

import { describe, expect, it, vi } from 'vitest';
import { LeagueService, PERMANENT_LEAGUES, parseLeagues } from '../src/services/leagueService.ts';

const gggResponse = [
  {
    id: 'Standard',
    realm: 'pc',
    description: 'The default game mode.',
    rules: [],
    endAt: null,
  },
  {
    id: 'Hardcore',
    realm: 'pc',
    rules: [{ id: 'Hardcore', name: 'Hardcore', description: 'A character killed is moved…' }],
    endAt: null,
  },
  {
    id: 'Settlers',
    realm: 'pc',
    rules: [],
    endAt: '2026-12-01T20:00:00Z',
  },
  {
    id: 'HC SSF Settlers',
    realm: 'pc',
    rules: [
      { id: 'Hardcore', name: 'Hardcore' },
      { id: 'NoParties', name: 'Solo' },
    ],
    endAt: '2026-12-01T20:00:00Z',
  },
];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function service(options: { fetchFn?: typeof fetch; known?: string[] } = {}) {
  return new LeagueService({
    userAgent: 'valuuttaloki/test',
    knownLeagues: async () => options.known ?? [],
    fetchFn: options.fetchFn ?? (vi.fn(async () => jsonResponse(gggResponse)) as unknown as typeof fetch),
    now: () => 0,
  });
}

describe('parseLeagues', () => {
  it('reads the league names', () => {
    expect(parseLeagues(gggResponse).map((league) => league.id)).toEqual([
      'Standard',
      'Hardcore',
      'Settlers',
      'HC SSF Settlers',
    ]);
  });

  it('reads the rules that change which league this is', () => {
    const leagues = parseLeagues(gggResponse);
    expect(leagues[1]).toMatchObject({ id: 'Hardcore', hardcore: true, ssf: false });
    // GGG spells solo self-found "NoParties"; the UI should not have to know that.
    expect(leagues[3]).toMatchObject({ id: 'HC SSF Settlers', hardcore: true, ssf: true });
  });

  it('marks temporary leagues by their end date', () => {
    const leagues = parseLeagues(gggResponse);
    expect(leagues[0]?.endAt).toBeNull();
    expect(leagues[2]?.endAt).toBe('2026-12-01T20:00:00Z');
  });

  it('accepts `name` as well as `id`, in case the endpoint ever changes its spelling', () => {
    expect(parseLeagues([{ name: 'Ancestor' }]).map((l) => l.id)).toEqual(['Ancestor']);
  });

  it('accepts an object wrapper as well as a bare array', () => {
    expect(parseLeagues({ leagues: [{ id: 'Standard' }] }).map((l) => l.id)).toEqual(['Standard']);
  });

  it('skips entries with no usable name rather than adding blank options', () => {
    expect(parseLeagues([{ id: '' }, { rules: [] }, { id: 'Standard' }]).map((l) => l.id)).toEqual([
      'Standard',
    ]);
  });

  it('drops duplicates', () => {
    expect(parseLeagues([{ id: 'Standard' }, { id: 'Standard' }])).toHaveLength(1);
  });

  it('returns nothing for a payload that is not a list', () => {
    expect(parseLeagues(null)).toEqual([]);
    expect(parseLeagues({ error: 'nope' })).toEqual([]);
    expect(parseLeagues('Standard')).toEqual([]);
  });
});

describe('LeagueService', () => {
  it('serves the fetched list', async () => {
    const result = await service().list();
    expect(result.source).toBe('ggg');
    expect(result.leagues.map((l) => l.id)).toContain('Settlers');
  });

  it('caches, so a page load does not become a request to GGG', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(gggResponse)) as unknown as typeof fetch;
    const subject = service({ fetchFn });

    await subject.list();
    await subject.list();

    expect((fetchFn as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(1);
  });

  it('collapses concurrent callers onto one request', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(gggResponse)) as unknown as typeof fetch;
    const subject = service({ fetchFn });

    await Promise.all([subject.list(), subject.list(), subject.list()]);

    expect((fetchFn as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(1);
  });

  it('falls back to the permanent leagues when GGG is unreachable', async () => {
    // The property that matters: never an empty dropdown.
    const fetchFn = vi.fn(async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;

    const result = await service({ fetchFn }).list();

    expect(result.source).toBe('fallback');
    expect(result.leagues.map((l) => l.id)).toEqual(expect.arrayContaining([...PERMANENT_LEAGUES]));
  });

  it('falls back on an HTTP error too', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ error: 'nope' }, 503)) as unknown as typeof fetch;
    expect((await service({ fetchFn }).list()).source).toBe('fallback');
  });

  it('falls back when the payload parses to nothing usable', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ unexpected: true })) as unknown as typeof fetch;
    expect((await service({ fetchFn }).list()).source).toBe('fallback');
  });

  it('keeps leagues this database already tracks, so a private one stays selectable', async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;

    const result = await service({ fetchFn, known: ['Private League (PL12345)'] }).list();
    expect(result.leagues.map((l) => l.id)).toContain('Private League (PL12345)');
  });

  it('survives the snapshot store failing while building the fallback', async () => {
    const subject = new LeagueService({
      userAgent: 'valuuttaloki/test',
      knownLeagues: async () => {
        throw new Error('database is gone');
      },
      fetchFn: vi.fn(async () => {
        throw new Error('offline');
      }) as unknown as typeof fetch,
      now: () => 0,
    });

    const result = await subject.list();
    expect(result.leagues.length).toBeGreaterThan(0);
  });
});
