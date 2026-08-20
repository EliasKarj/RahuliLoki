/**
 * The two store methods that reach into the database rather than through it.
 *
 * `listTabTotals` reads a denormalised column and `itemSeries` sums inside SQLite's JSON
 * functions. Neither can be exercised by the in-memory store the rest of the suite uses, and
 * both are the kind of code that fails quietly: a raw query that returns the wrong shape still
 * returns *something*. So these run against a real file, migrated by the app's own migrator.
 *
 * The fractional case is not decoration either. Prisma types a raw column from the first value
 * it sees, and a SUM that starts out whole comes back as a BigInt that throws the moment a row
 * is fractional — which is exactly what happened while this was being written.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '../generated/prisma/index.js';
import { migrate } from '../src/lib/migrate.ts';
import { PrismaPriceSetStore, PrismaSnapshotStore } from '../src/services/snapshotRepo.ts';
import type { PriceSet } from '../src/services/priceService.ts';
import type { Breakdown } from '../src/services/valuationService.ts';

const MIGRATIONS = fileURLToPath(new URL('../prisma/migrations', import.meta.url));
const temps: string[] = [];
const clients: PrismaClient[] = [];

afterEach(async () => {
  while (clients.length > 0) await clients.pop()?.$disconnect();
  while (temps.length > 0) rmSync(temps.pop() as string, { recursive: true, force: true });
});

/** A migrated database with a store on top of it. */
function store(): { store: PrismaSnapshotStore; prisma: PrismaClient; file: string } {
  const dir = mkdtempSync(join(tmpdir(), 'what-remains-repo-'));
  temps.push(dir);
  const file = join(dir, 'test.db');
  migrate(file, MIGRATIONS);
  const prisma = new PrismaClient({ datasourceUrl: `file:${file}` });
  clients.push(prisma);
  return { store: new PrismaSnapshotStore(prisma), prisma, file };
}

/** The same, with the price-set store on top instead. */
async function priceStore(): Promise<{ store: PrismaPriceSetStore; prisma: PrismaClient }> {
  const { prisma } = store();
  return { store: new PrismaPriceSetStore(prisma, 0), prisma };
}

async function add(
  subject: PrismaSnapshotStore,
  takenAt: string,
  breakdown: Breakdown,
): Promise<void> {
  const totalChaos = Object.values(breakdown)
    .flatMap((entries) => Object.values(entries))
    .reduce((sum, entry) => sum + entry.chaosTotal, 0);
  await subject.create({
    league: 'Allflame',
    takenAt: new Date(takenAt),
    totalChaos,
    totalDivine: totalChaos / 200,
    divineRate: 200,
    itemCount: 1,
    breakdown,
    pricedUniques: false,
    priceSetAt: new Date(takenAt),
  });
}

const entry = (qty: number, chaosEach: number) => ({
  qty,
  chaosEach,
  chaosTotal: Math.round(qty * chaosEach * 100) / 100,
});

describe('itemSeries', () => {
  it('sums an item across the tabs it sits in', async () => {
    const { store: subject } = store();
    await add(subject, '2026-01-01T00:00:00Z', {
      Currency: { Widget: entry(2, 10) },
      Dump: { Widget: entry(3, 10) },
    });

    const points = await subject.itemSeries({ league: 'Allflame' }, 'Widget');

    expect(points).toHaveLength(1);
    expect(points[0]).toMatchObject({ qty: 5, chaosTotal: 50, chaosEach: 10 });
  });

  it('reports a snapshot without the item as zero rather than leaving it out', async () => {
    // A sold stack should fall to the floor. A missing point would make the line stop, which is
    // a different claim about what happened.
    const { store: subject } = store();
    await add(subject, '2026-01-01T00:00:00Z', { Currency: { Widget: entry(4, 10) } });
    await add(subject, '2026-01-01T01:00:00Z', { Currency: { Other: entry(1, 1) } });

    const points = await subject.itemSeries({ league: 'Allflame' }, 'Widget');

    expect(points.map((point) => point.qty)).toEqual([4, 0]);
    expect(points.map((point) => point.takenAt.toISOString())).toEqual([
      '2026-01-01T00:00:00.000Z',
      '2026-01-01T01:00:00.000Z',
    ]);
  });

  it('survives fractional sums', async () => {
    // The BigInt trap: a whole first row followed by a fractional one.
    const { store: subject } = store();
    await add(subject, '2026-01-01T00:00:00Z', { Currency: { Widget: entry(2, 5) } });
    await add(subject, '2026-01-01T01:00:00Z', { Currency: { Widget: entry(3, 0.13) } });

    const points = await subject.itemSeries({ league: 'Allflame' }, 'Widget');

    expect(points.map((point) => point.chaosTotal)).toEqual([10, 0.39]);
  });

  it('honours the range and the league', async () => {
    const { store: subject } = store();
    await add(subject, '2026-01-01T00:00:00Z', { Currency: { Widget: entry(1, 10) } });
    await add(subject, '2026-01-02T00:00:00Z', { Currency: { Widget: entry(2, 10) } });

    const points = await subject.itemSeries(
      { league: 'Allflame', from: new Date('2026-01-01T12:00:00Z') },
      'Widget',
    );

    expect(points.map((point) => point.qty)).toEqual([2]);
    expect(await subject.itemSeries({ league: 'Elsewhere' }, 'Widget')).toEqual([]);
  });

  it('does not mistake an inherited property for a holding', async () => {
    // Keys come from stash tab and item names, so a lookup for `constructor` has to miss.
    const { store: subject } = store();
    await add(subject, '2026-01-01T00:00:00Z', { Currency: { Widget: entry(1, 10) } });

    const points = await subject.itemSeries({ league: 'Allflame' }, 'constructor');

    expect(points.map((point) => point.qty)).toEqual([0]);
  });
});

describe('listTabTotals', () => {
  it('reads the totals written alongside the breakdown', async () => {
    const { store: subject } = store();
    await add(subject, '2026-01-01T00:00:00Z', {
      Currency: { Widget: entry(2, 10), Other: entry(1, 5) },
      Dump: { Widget: entry(3, 10) },
    });

    const rows = await subject.listTabTotals({ league: 'Allflame' });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.tabs).toEqual({ Currency: 25, Dump: 30 });
  });

  it('falls back to the breakdown for a row written before the column existed', async () => {
    // The migration backfills, so this is the gap between the two — and it must not answer an
    // empty stash, which would draw a chart that says the tabs were empty.
    const { store: subject, prisma } = store();
    await add(subject, '2026-01-01T00:00:00Z', { Currency: { Widget: entry(2, 10) } });
    await prisma.$executeRaw`UPDATE Snapshot SET tabs = NULL`;

    const rows = await subject.listTabTotals({ league: 'Allflame' });

    expect(rows[0]?.tabs).toEqual({ Currency: 20 });
  });
});

describe('price history, against a real database', () => {
  it('reads one id out of every retained set, oldest first', async () => {
    const { prisma, store } = await priceStore();
    await prisma.priceSet.createMany({
      data: [
        { league: 'Settlers', fetchedAt: new Date('2026-01-01T02:00:00Z'), prices: { divine: 220, alt: 0.13 } },
        { league: 'Settlers', fetchedAt: new Date('2026-01-01T00:00:00Z'), prices: { divine: 210, alt: 0.11 } },
        { league: 'Settlers', fetchedAt: new Date('2026-01-01T01:00:00Z'), prices: { divine: 215, alt: 0.12 } },
        { league: 'Standard', fetchedAt: new Date('2026-01-01T01:00:00Z'), prices: { divine: 999, alt: 9 } },
      ],
    });

    const points = await store.history('Settlers', 'alt');

    expect(points.map((point) => point.chaos)).toEqual([0.11, 0.12, 0.13]);
    // The divine rate travels with each point so a chart can quote it in either unit without a
    // second query — and it is the rate *at that moment*, not today's.
    expect(points.map((point) => point.divineRate)).toEqual([210, 215, 220]);
    expect(points[0]?.at).toBe('2026-01-01T00:00:00.000Z');
  });

  it('skips the sets that did not price it, rather than reading them as zero', async () => {
    const { prisma, store } = await priceStore();
    await prisma.priceSet.createMany({
      data: [
        { league: 'Settlers', fetchedAt: new Date('2026-01-01T00:00:00Z'), prices: { divine: 210 } },
        { league: 'Settlers', fetchedAt: new Date('2026-01-01T01:00:00Z'), prices: { divine: 215, alt: 0.12 } },
      ],
    });

    // An item poe.ninja stopped pricing has a gap in its history, not a crash to zero. A zero
    // would draw a cliff on the chart and read as "it became worthless".
    expect(await store.history('Settlers', 'alt')).toHaveLength(1);
  });

  it('keeps the recent end when there are more sets than the limit', async () => {
    const { prisma, store } = await priceStore();
    await prisma.priceSet.createMany({
      data: Array.from({ length: 10 }, (_, index) => ({
        league: 'Settlers',
        fetchedAt: new Date(Date.UTC(2026, 0, 1, index)),
        prices: { divine: 200, alt: index },
      })),
    });

    const points = await store.history('Settlers', 'alt', 3);
    expect(points.map((point) => point.chaos)).toEqual([7, 8, 9]);
  });

  it('does not let an id smuggle anything into the JSON path', async () => {
    const { prisma, store } = await priceStore();
    await prisma.priceSet.createMany({
      data: [{ league: 'Settlers', fetchedAt: new Date('2026-01-01T00:00:00Z'), prices: { divine: 210 } }],
    });

    // The id goes into a json_extract path, which is a string this code builds. A quote in it
    // must not be able to close that string — the answer is an empty history, not an error and
    // certainly not a different query.
    await expect(store.history('Settlers', 'alt", "$.divine') ).resolves.toEqual([]);
  });
});

describe('the unique index, across a save and a restore', () => {
  function set(lines: Record<string, unknown[]>): PriceSet {
    return {
      league: 'Settlers',
      fetchedAt: new Date('2026-01-01T00:00:00Z'),
      prices: { chaos: 1, divine: 200 },
      divineRate: 200,
      icons: {},
      categories: {},
      meta: {},
      names: {},
      uniques: lines as PriceSet['uniques'],
    };
  }

  const bronns = [
    { name: "Bronn's Lithe", links: 0, corrupted: false, variant: null, chaos: 5.2, icon: 'https://web.poecdn.com/b.png' },
    { name: "Bronn's Lithe", links: 6, corrupted: false, variant: null, chaos: 210, icon: 'https://web.poecdn.com/b.png' },
  ];

  it('comes back with every variant intact', async () => {
    // Without this the first poll after a restart values every unique at nothing and writes a
    // collapse into the history that never happened — and history is the one thing this
    // application cannot correct later.
    const { store } = await priceStore();
    await store.save(set({ "Bronn's Lithe": bronns }));

    const restored = await store.latest('Settlers');

    expect(restored?.uniques["Bronn's Lithe"]?.map((line) => [line.links, line.chaos])).toEqual([
      [0, 5.2],
      [6, 210],
    ]);
  });

  it('drops the icons, which are already stored once in the icons map', async () => {
    const { store } = await priceStore();
    await store.save(set({ "Bronn's Lithe": bronns }));

    // 273 KB against 690 KB for the same index. The icon is read from PriceSet.icons, under the
    // same key, and storing it twice buys nothing.
    expect((await store.latest('Settlers'))?.uniques["Bronn's Lithe"]?.[0]?.icon).toBeNull();
  });

  it('keeps one row per league, overwritten, rather than one per fetch', async () => {
    const { prisma, store } = await priceStore();
    await store.save(set({ "Bronn's Lithe": bronns }));
    await store.save({ ...set({ Progenesis: [{ name: 'Progenesis', links: 0, corrupted: false, variant: null, chaos: 12518, icon: null }] }), fetchedAt: new Date('2026-01-01T01:00:00Z') });

    expect(await prisma.uniquePriceSet.count()).toBe(1);
    const restored = await store.latest('Settlers');
    expect(Object.keys(restored?.uniques ?? {})).toEqual(['Progenesis']);
  });

  it('refuses a line the database cannot be trusted about', async () => {
    // This column is JSON on disk and could have been edited or written by an older build. A
    // chaos value that came back as a string would value a whole stash at NaN.
    const { prisma, store } = await priceStore();
    await prisma.uniquePriceSet.create({
      data: {
        league: 'Settlers',
        fetchedAt: new Date('2026-01-01T00:00:00Z'),
        lines: {
          Good: [{ links: 6, chaos: 10 }],
          Stringy: [{ links: 0, chaos: 'lots' }],
          Negative: [{ links: 0, chaos: -5 }],
          NotAnArray: { links: 0, chaos: 10 },
        },
      },
    });
    await prisma.priceSet.create({
      data: { league: 'Settlers', fetchedAt: new Date('2026-01-01T00:00:00Z'), prices: { chaos: 1, divine: 200 } },
    });

    expect(Object.keys((await store.latest('Settlers'))?.uniques ?? {})).toEqual(['Good']);
  });
});
