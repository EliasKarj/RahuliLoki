/** An in-memory SnapshotStore. Same contract as the Prisma one, no database in the way. */

import { tabTotals, type Breakdown } from '../../src/services/valuationService.ts';
import type {
  CreateSnapshotInput,
  SnapshotMeta,
  SnapshotQuery,
  SnapshotStore,
  SnapshotWithBreakdown,
  SnapshotWithTabs,
} from '../../src/services/snapshotRepo.ts';

export class MemorySnapshotStore implements SnapshotStore {
  readonly rows: SnapshotWithBreakdown[] = [];
  #nextId = 1;
  /** Set to make create() throw, to exercise the "nothing was written" paths. */
  failOnCreate: Error | null = null;

  #filter(query: SnapshotQuery): SnapshotWithBreakdown[] {
    return this.rows
      .filter((row) => row.league === query.league)
      .filter((row) => (query.from ? row.takenAt >= query.from : true))
      .filter((row) => (query.to ? row.takenAt <= query.to : true))
      .sort((a, b) => a.takenAt.getTime() - b.takenAt.getTime())
      .slice(0, query.limit ?? Number.MAX_SAFE_INTEGER);
  }

  async list(query: SnapshotQuery): Promise<SnapshotMeta[]> {
    return this.#filter(query).map(({ breakdown: _breakdown, ...meta }) => meta);
  }

  async listFull(query: SnapshotQuery): Promise<SnapshotWithBreakdown[]> {
    return this.#filter(query);
  }

  async listTabTotals(query: SnapshotQuery): Promise<SnapshotWithTabs[]> {
    return this.#filter(query).map(({ breakdown, ...meta }) => ({ ...meta, tabs: tabTotals(breakdown) }));
  }

  async latest(league: string): Promise<SnapshotWithBreakdown | null> {
    const rows = this.rows
      .filter((row) => row.league === league)
      .sort((a, b) => b.takenAt.getTime() - a.takenAt.getTime());
    return rows[0] ?? null;
  }

  async bounds(
    query: SnapshotQuery,
  ): Promise<{ first: SnapshotWithBreakdown; last: SnapshotWithBreakdown } | null> {
    const rows = this.#filter({ ...query, limit: undefined });
    const first = rows[0];
    const last = rows[rows.length - 1];
    if (!first || !last || first.id === last.id) return null;
    return { first, last };
  }

  async create(input: CreateSnapshotInput): Promise<SnapshotMeta> {
    if (this.failOnCreate) throw this.failOnCreate;
    const row: SnapshotWithBreakdown = {
      id: this.#nextId,
      takenAt: input.takenAt ?? new Date(),
      league: input.league,
      totalChaos: input.totalChaos,
      totalDivine: input.totalDivine,
      divineRate: input.divineRate,
      itemCount: input.itemCount,
      priceSetAt: input.priceSetAt,
      breakdown: input.breakdown,
    };
    this.#nextId += 1;
    this.rows.push(row);
    const { breakdown: _breakdown, ...meta } = row;
    return meta;
  }

  async leagues(): Promise<string[]> {
    const seen = new Map<string, number>();
    for (const row of this.rows) {
      seen.set(row.league, Math.max(seen.get(row.league) ?? 0, row.takenAt.getTime()));
    }
    return [...seen.entries()].sort((a, b) => b[1] - a[1]).map(([league]) => league);
  }

  /** Test convenience: append a snapshot without going through a poll. */
  seed(input: Partial<CreateSnapshotInput> & { takenAt: Date; totalChaos: number }): void {
    const breakdown: Breakdown = input.breakdown ?? {};
    void this.create({
      league: input.league ?? 'Settlers',
      takenAt: input.takenAt,
      totalChaos: input.totalChaos,
      totalDivine: input.totalDivine ?? input.totalChaos / 200,
      divineRate: input.divineRate ?? 200,
      itemCount: input.itemCount ?? 0,
      priceSetAt: input.priceSetAt ?? input.takenAt,
      breakdown,
    });
  }
}
