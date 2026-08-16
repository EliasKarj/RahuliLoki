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

import type { PrismaClient } from '@prisma/client';
import type { Breakdown } from './valuationService.ts';
import { tabTotals } from './valuationService.ts';
import type { PriceSet, PriceSetStore } from './priceService.ts';

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

/** Prisma's Json columns come back as `unknown`; narrow once, here. */
function asBreakdown(value: unknown): Breakdown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Breakdown;
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

  async list(query: SnapshotQuery): Promise<SnapshotMeta[]> {
    return this.#prisma.snapshot.findMany({
      where: where(query),
      orderBy: { takenAt: 'asc' },
      ...(query.limit ? { take: query.limit } : {}),
      select: META_SELECT,
    });
  }

  async listFull(query: SnapshotQuery): Promise<SnapshotWithBreakdown[]> {
    const rows = await this.#prisma.snapshot.findMany({
      where: where(query),
      orderBy: { takenAt: 'asc' },
      ...(query.limit ? { take: query.limit } : {}),
    });
    return rows.map((row) => ({ ...row, breakdown: asBreakdown(row.breakdown) }));
  }

  async listTabTotals(query: SnapshotQuery): Promise<SnapshotWithTabs[]> {
    const rows = await this.listFull(query);
    return rows.map(({ breakdown, ...meta }) => ({ ...meta, tabs: tabTotals(breakdown) }));
  }

  async latest(league: string): Promise<SnapshotWithBreakdown | null> {
    const row = await this.#prisma.snapshot.findFirst({
      where: { league },
      orderBy: { takenAt: 'desc' },
    });
    return row === null ? null : { ...row, breakdown: asBreakdown(row.breakdown) };
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
      divineRate: prices['Divine Orb'] ?? 0,
    };
  }

  async save(set: PriceSet): Promise<void> {
    await this.#prisma.priceSet.create({
      data: { league: set.league, fetchedAt: set.fetchedAt, prices: set.prices as object },
    });
    await this.#prune(set.league);
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
