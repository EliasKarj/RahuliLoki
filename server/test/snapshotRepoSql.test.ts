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
import { PrismaSnapshotStore } from '../src/services/snapshotRepo.ts';
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
