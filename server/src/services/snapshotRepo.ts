/**
 * Persistence. One row per successful poll, never updated, never deleted by the app.
 *
 * The read side has three shapes on purpose:
 *   - `list`            metadata only. What the net-worth and c/h charts need.
 *   - `listTabTotals`   metadata + per-tab sums, reduced server-side.
 *   - `latest`/`listFull` the full breakdown, for the single latest snapshot or an explicit
 *                       `?full=1` export.
 *
 * A full quad tab is thousands of items, so the breakdown column is only ever read when
 * somebody has actually asked for it.
 */

import type { PrismaClient } from '../../generated/prisma/index.js';
import type { Breakdown } from './valuationService.ts';
import { tabTotals } from './valuationService.ts';
import { DIVINE_ID, type LineMeta } from './ninjaPayload.ts';
import type { PricePoint, PriceSet, PriceSetStore } from './priceService.ts';
import type { UniqueIndex } from './uniques.ts';

export interface SnapshotMeta {
  id: number;
  takenAt: Date;
  league: string;
  totalChaos: number;
  totalDivine: number;
  divineRate: number;
  itemCount: number;
  priceSetAt: Date;
}

export interface SnapshotWithBreakdown extends SnapshotMeta {
  breakdown: Breakdown;
}

export interface SnapshotWithTabs extends SnapshotMeta {
  tabs: Record<string, number>;
}

/** One item's holding at one moment, summed across the tabs it sits in. */
export interface ItemSeriesPoint {
  takenAt: Date;
  qty: number;
  chaosEach: number;
  chaosTotal: number;
}

export interface SnapshotQuery {
  league: string;
  from?: Date;
  to?: Date;
  limit?: number;
}

export interface CreateSnapshotInput {
  league: string;
  takenAt?: Date;
  totalChaos: number;
  totalDivine: number;
  divineRate: number;
  itemCount: number;
  breakdown: Breakdown;
  priceSetAt: Date;
}

export interface SnapshotStore {
  list(query: SnapshotQuery): Promise<SnapshotMeta[]>;
  listTabTotals(query: SnapshotQuery): Promise<SnapshotWithTabs[]>;
  listFull(query: SnapshotQuery): Promise<SnapshotWithBreakdown[]>;
  latest(league: string): Promise<SnapshotWithBreakdown | null>;
  /** One item across a range, one point per snapshot — absent means zero, not a gap. */
  itemSeries(query: SnapshotQuery, name: string): Promise<ItemSeriesPoint[]>;
  /** The oldest and newest snapshot in a range, with breakdowns. Two rows, not the range. */
  bounds(query: SnapshotQuery): Promise<{ first: SnapshotWithBreakdown; last: SnapshotWithBreakdown } | null>;
  create(input: CreateSnapshotInput): Promise<SnapshotMeta>;
  leagues(): Promise<string[]>;
}

const META_SELECT = {
  id: true,
  takenAt: true,
  league: true,
  totalChaos: true,
  totalDivine: true,
  divineRate: true,
  itemCount: true,
  priceSetAt: true,
} as const;

const TABS_SELECT = { ...META_SELECT, tabs: true } as const;

/** Prisma's Json columns come back as `unknown`; narrow once, here. */
function asTabs(value: unknown): Record<string, number> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const out: Record<string, number> = Object.create(null) as Record<string, number>;
  for (const [tab, total] of Object.entries(value as Record<string, unknown>)) {
    if (typeof total === 'number' && Number.isFinite(total)) out[tab] = total;
  }
  return out;
}

function asBreakdown(value: unknown): Breakdown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Breakdown;
}

/** Narrows a string→string Json column. Unknown-shaped entries are dropped. Used for both the
 *  icon map and the category map, which have the same shape and the same tolerances. */
function asIcons(value: unknown): Record<string, string> {
  const out: Record<string, string> = Object.create(null) as Record<string, string>;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return out;
  for (const [name, icon] of Object.entries(value as Record<string, unknown>)) {
    if (typeof icon === 'string' && icon !== '') out[name] = icon;
  }
  return out;
}

function asPrices(value: unknown): Record<string, number> {
  // Null-prototype, matching how PriceService builds a fresh set: these keys came out of a
  // remote payload, and a lookup for `constructor` has to miss rather than return a function.
  const out: Record<string, number> = Object.create(null) as Record<string, number>;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return out;
  for (const [name, price] of Object.entries(value as Record<string, unknown>)) {
    if (typeof price === 'number' && Number.isFinite(price)) out[name] = price;
  }
  return out;
}

/**
 * The movement map, narrowed back out of the database.
 *
 * Every field is checked rather than trusted: this went in as JSON and could have been edited,
 * truncated, or written by an older version of this program. A sparkline with a string in it
 * would draw a broken path in a chart nobody would think to distrust.
 */
function asMeta(value: unknown): Record<string, LineMeta> {
  const out: Record<string, LineMeta> = Object.create(null) as Record<string, LineMeta>;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return out;

  for (const [id, raw] of Object.entries(value as Record<string, unknown>)) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const entry = raw as { change?: unknown; volume?: unknown; sparkline?: unknown };
    out[id] = {
      change: typeof entry.change === 'number' && Number.isFinite(entry.change) ? entry.change : null,
      volume: typeof entry.volume === 'number' && Number.isFinite(entry.volume) ? entry.volume : null,
      sparkline: Array.isArray(entry.sparkline)
        ? entry.sparkline.filter((point): point is number => typeof point === 'number' && Number.isFinite(point))
        : [],
    };
  }
  return out;
}

function where(query: SnapshotQuery) {
  return {
    league: query.league,
    ...(query.from || query.to
      ? {
          takenAt: {
            ...(query.from ? { gte: query.from } : {}),
            ...(query.to ? { lte: query.to } : {}),
          },
        }
      : {}),
  };
}

export class PrismaSnapshotStore implements SnapshotStore {
  readonly #prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.#prisma = prisma;
  }

  /**
   * A range of snapshots, oldest first — but truncated from the far end, not the near one.
   *
   * A limit and an ascending sort together kept the *oldest* rows, which is the wrong half of a
   * wealth history. Past about two weeks of a league the chart stopped mid-league with no sign
   * that it had, and the headline figure — which `computeStats` takes from the last row it is
   * given — reported a net worth from a fortnight ago as the current one. Both were wrong in
   * the direction nobody checks, because a chart that ends is indistinguishable from a chart of
   * someone who stopped playing.
   *
   * So the newest rows win. The series still ends at now, and what falls off is the beginning,
   * where a gap is visible for what it is.
   */
  async list(query: SnapshotQuery): Promise<SnapshotMeta[]> {
    const rows = await this.#prisma.snapshot.findMany({
      where: where(query),
      orderBy: { takenAt: query.limit ? 'desc' : 'asc' },
      ...(query.limit ? { take: query.limit } : {}),
      select: META_SELECT,
    });
    return query.limit ? rows.reverse() : rows;
  }

  async listFull(query: SnapshotQuery): Promise<SnapshotWithBreakdown[]> {
    const rows = await this.#prisma.snapshot.findMany({
      where: where(query),
      orderBy: { takenAt: query.limit ? 'desc' : 'asc' },
      ...(query.limit ? { take: query.limit } : {}),
    });
    const ordered = query.limit ? rows.reverse() : rows;
    return ordered.map((row) => ({ ...row, breakdown: asBreakdown(row.breakdown) }));
  }

  /**
   * Per-tab sums for a range, from the column that holds them rather than from the breakdowns.
   *
   * This is the query the dashboard repeats on every refresh, and it used to read every
   * breakdown in the range to add up numbers that were already known when the row was written.
   * A month of a nineteen-tab stash is a hundred megabytes of JSON for about a kilobyte of
   * answer, which measured 2.3 seconds; the column answers in single-digit milliseconds.
   *
   * Rows written before the column existed are backfilled by its migration. The fallback below
   * is for the gap between the two — and it reads only the rows that need it, not the range.
   */
  async listTabTotals(query: SnapshotQuery): Promise<SnapshotWithTabs[]> {
    const rows = await this.#prisma.snapshot
      .findMany({
        where: where(query),
        // Newest-first with a limit, then reversed — see `list` for why the far end is the one
        // that gets cut.
        orderBy: { takenAt: query.limit ? 'desc' : 'asc' },
        ...(query.limit ? { take: query.limit } : {}),
        select: TABS_SELECT,
      })
      .then((found) => (query.limit ? found.reverse() : found));

    const missing = rows.filter((row) => asTabs(row.tabs) === null).map((row) => row.id);
    const computed = new Map<number, Record<string, number>>();
    if (missing.length > 0) {
      const blobs = await this.#prisma.snapshot.findMany({
        where: { id: { in: missing } },
        select: { id: true, breakdown: true },
      });
      for (const blob of blobs) computed.set(blob.id, tabTotals(asBreakdown(blob.breakdown)));
    }

    return rows.map(({ tabs, ...meta }) => ({
      ...meta,
      tabs: asTabs(tabs) ?? computed.get(meta.id) ?? {},
    }));
  }

  /**
   * One item's quantity and value across a range, summed in the database.
   *
   * The straightforward version — read every breakdown in the range and pick the name out of
   * each — is a hundred megabytes of JSON through the client for one item's line on a chart,
   * and measured 1.7 seconds over a month. SQLite reaches into the blobs itself in about 0.7,
   * which is the difference between a click that feels slow and one that feels broken.
   *
   * The CASTs are not decoration. Prisma types a raw column from the first value it sees, and a
   * SUM that starts out whole gets read back as a BigInt — which then throws the moment a later
   * row is fractional. `CAST(… AS REAL)` says once what every one of these columns is.
   *
   * Snapshots with none of the item are missing from this query and filled in as zero below: a
   * pile that was sold should fall to zero rather than leave a gap, which is a different claim.
   */
  async itemSeries(query: SnapshotQuery, name: string): Promise<ItemSeriesPoint[]> {
    const [meta, sums] = await Promise.all([
      this.list(query),
      this.#prisma.$queryRaw<Array<{ id: number; qty: number; chaosEach: number; chaosTotal: number }>>`
        SELECT s.id AS id,
               CAST(SUM(json_extract(item.value, '$.qty')) AS REAL) AS qty,
               CAST(MAX(json_extract(item.value, '$.chaosEach')) AS REAL) AS chaosEach,
               CAST(SUM(json_extract(item.value, '$.chaosTotal')) AS REAL) AS chaosTotal
        FROM Snapshot s, json_each(s.breakdown) tab, json_each(tab.value) item
        WHERE s.league = ${query.league}
          AND (${query.from ?? null} IS NULL OR s.takenAt >= ${query.from ?? null})
          AND (${query.to ?? null} IS NULL OR s.takenAt <= ${query.to ?? null})
          AND item.key = ${name}
        GROUP BY s.id`,
    ]);

    const found = new Map(sums.map((row) => [row.id, row]));
    return meta.map((row) => {
      const hit = found.get(row.id);
      return {
        takenAt: row.takenAt,
        qty: hit?.qty ?? 0,
        chaosEach: hit?.chaosEach ?? 0,
        chaosTotal: hit?.chaosTotal ?? 0,
      };
    });
  }

  async latest(league: string): Promise<SnapshotWithBreakdown | null> {
    const row = await this.#prisma.snapshot.findFirst({
      where: { league },
      orderBy: { takenAt: 'desc' },
    });
    return row === null ? null : { ...row, breakdown: asBreakdown(row.breakdown) };
  }

  /**
   * The two endpoints of a range, read as two rows rather than by pulling the range and taking
   * its ends. A month of ten-minute snapshots is ~4000 breakdown blobs; the diff needs two.
   */
  async bounds(
    query: SnapshotQuery,
  ): Promise<{ first: SnapshotWithBreakdown; last: SnapshotWithBreakdown } | null> {
    const [first, last] = await Promise.all([
      this.#prisma.snapshot.findFirst({ where: where(query), orderBy: { takenAt: 'asc' } }),
      this.#prisma.snapshot.findFirst({ where: where(query), orderBy: { takenAt: 'desc' } }),
    ]);
    if (first === null || last === null || first.id === last.id) return null;
    return {
      first: { ...first, breakdown: asBreakdown(first.breakdown) },
      last: { ...last, breakdown: asBreakdown(last.breakdown) },
    };
  }

  async create(input: CreateSnapshotInput): Promise<SnapshotMeta> {
    return this.#prisma.snapshot.create({
      data: {
        league: input.league,
        ...(input.takenAt ? { takenAt: input.takenAt } : {}),
        totalChaos: input.totalChaos,
        totalDivine: input.totalDivine,
        divineRate: input.divineRate,
        itemCount: input.itemCount,
        breakdown: input.breakdown as object,
        // Derived here rather than on every read. See the column's comment in schema.prisma.
        tabs: tabTotals(input.breakdown),
        priceSetAt: input.priceSetAt,
      },
      select: META_SELECT,
    });
  }

  async leagues(): Promise<string[]> {
    const rows = await this.#prisma.snapshot.groupBy({
      by: ['league'],
      _max: { takenAt: true },
    });
    return rows
      .sort((a, b) => (b._max.takenAt?.getTime() ?? 0) - (a._max.takenAt?.getTime() ?? 0))
      .map((row) => row.league);
  }
}

export class PrismaPriceSetStore implements PriceSetStore {
  readonly #prisma: PrismaClient;
  readonly #retention: number;

  /**
   * `retention` caps how many price sets are kept per league. Each row holds a full name →
   * chaos map — thousands of entries, hundreds of kilobytes — and one is written every time the
   * hourly TTL lapses. Kept forever, that is a few hundred megabytes over a league on a volume
   * the deployment provisions at one gigabyte, and SQLite's first symptom of a full disk is a
   * failed write in the middle of a poll.
   *
   * 48 is two days of history, which is all the depth anything actually reads: the newest set
   * at boot, and the odd look back at what an old snapshot was valued against.
   */
  constructor(prisma: PrismaClient, retention = 48) {
    this.#prisma = prisma;
    this.#retention = retention;
  }

  async latest(league: string): Promise<PriceSet | null> {
    const row = await this.#prisma.priceSet.findFirst({
      where: { league },
      orderBy: { fetchedAt: 'desc' },
    });
    if (row === null) return null;
    const prices = asPrices(row.prices);
    return {
      league: row.league,
      fetchedAt: row.fetchedAt,
      prices,
      // Derived rather than stored: there is no column for it, and the divine price is already
      // in the map. It has to be read by poe.ninja's *id*, not by the display name — reading
      // `prices['Divine Orb']` against an id-keyed map silently yields 0, and a divine rate of
      // zero makes every restored snapshot worth zero divine while its chaos total stays right.
      divineRate: prices[DIVINE_ID] ?? 0,
      // Null on rows written before the icons column existed. An empty map is the right
      // reading: the UI falls back to no icon, and the next fetch fills it in.
      icons: asIcons(row.icons),
      // Same narrowing as the icons, and the same reason for being nullable: a row written
      // before this column existed simply has no categories, and the next fetch fills it in.
      categories: asIcons(row.categories),
      // Null on rows written before this column existed, which reads as "no movement was
      // published" — the truth about those rows, and not the same claim as "it did not move".
      meta: asMeta(row.meta),
      // Not persisted. A restored set exists so a restart does not refetch immediately, and
      // the very next poll refreshes it; carrying the unique index through the database would
      // multiply the row size for a window measured in minutes. Uniques go unpriced until
      // then, which the unresolved log makes visible rather than silent.
      uniques: Object.create(null) as UniqueIndex,
    };
  }

  async save(set: PriceSet): Promise<void> {
    await this.#prisma.priceSet.create({
      data: {
        league: set.league,
        fetchedAt: set.fetchedAt,
        prices: set.prices as object,
        icons: set.icons as object,
        categories: set.categories as object,
        meta: set.meta as object,
      },
    });
    await this.#prune(set.league);
  }

  /**
   * One id's price across every retained set, oldest first.
   *
   * Read with `json_extract` rather than by loading each set and picking a key out of it: a set
   * is a few thousand entries and a couple of hundred kilobytes, and the answer is one number
   * from each. Pulling the whole column across for that would be forty-eight blobs to produce
   * forty-eight floats.
   *
   * `CAST(... AS REAL)` is not decoration. Without it Prisma infers the column type from the
   * first row and throws on a fractional value — which is most prices.
   */
  async history(league: string, id: string, limit = 500): Promise<PricePoint[]> {
    const rows = await this.#prisma.$queryRaw<Array<{ at: number | bigint; chaos: number | null; rate: number | null }>>`
      SELECT fetchedAt AS at,
             CAST(json_extract(prices, ${'$."' + id.replace(/"/g, '') + '"'}) AS REAL) AS chaos,
             CAST(json_extract(prices, '$.divine') AS REAL) AS rate
      FROM PriceSet
      WHERE league = ${league}
      ORDER BY fetchedAt DESC
      LIMIT ${Math.max(1, Math.min(limit, 2000))}`;

    return rows
      .filter((row) => row.chaos !== null && Number.isFinite(row.chaos))
      .map((row) => ({
        at: new Date(Number(row.at)).toISOString(),
        chaos: row.chaos as number,
        divineRate: row.rate ?? 0,
      }))
      // Newest-first in SQL so the limit keeps the recent end; oldest-first out, because that is
      // the direction a chart is drawn in.
      .reverse();
  }

  /** Drop everything past the retention window for this league. */
  async #prune(league: string): Promise<void> {
    if (this.#retention <= 0) return;
    const keep = await this.#prisma.priceSet.findMany({
      where: { league },
      orderBy: { fetchedAt: 'desc' },
      take: this.#retention,
      select: { id: true },
    });
    if (keep.length < this.#retention) return;
    await this.#prisma.priceSet.deleteMany({
      where: { league, id: { notIn: keep.map((row) => row.id) } },
    });
  }
}
