/**
 * The snapshot read API.
 *
 *   GET /api/snapshots         list; breakdown omitted unless ?full=1, per-tab sums on ?tabs=1
 *   GET /api/snapshots/latest  the newest snapshot, with its full breakdown and top items
 *   GET /api/stats             total gain, chaos-per-hour (active and wall-clock), best hour
 *   GET /api/changes           what moved between the ends of the range, per item
 *   GET /api/item-history      one item's quantity and value across the range
 *
 * `league` defaults to the configured one. It is a query parameter rather than an assumption
 * because a league rollover leaves the previous league's series sitting in the same database,
 * and being able to look back at it is the point of keeping it.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ApiDeps } from './deps.ts';
import { computeStats } from '../lib/series.ts';
import { diffBreakdowns, itemHistory } from '../lib/changes.ts';
import { tabTotals, topItems } from '../services/valuationService.ts';
import type { SnapshotQuery } from '../services/snapshotRepo.ts';

/** Hard ceiling on a single response, whatever ?limit says. */
const MAX_LIMIT = 10_000;
/**
 * Lower ceiling when the breakdown has to be read off disk to answer.
 *
 * Only `?full=1` does now. `?tabs=1` used to: it read every breakdown in the range to add up
 * per-tab sums, which is why it shared this cap. The sums are a column now, so that query is as
 * light as the plain listing and is capped with it — which also means the per-tab chart covers
 * five times the history it used to.
 */
const MAX_HEAVY_LIMIT = 2_000;

export class QueryError extends Error {}

function bool(value: unknown): boolean {
  return value === '1' || value === 'true' || value === true;
}

function date(value: unknown, field: string): Date | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) {
    throw new QueryError(`${field} is not a date: "${String(value)}"`);
  }
  return parsed;
}

export interface ParsedQuery extends SnapshotQuery {
  full: boolean;
  tabs: boolean;
}

/** Parse and bound the shared query string. Exported so the edge cases can be tested directly. */
export function parseQuery(raw: Record<string, unknown>, defaultLeague: string): ParsedQuery {
  const full = bool(raw.full);
  const tabs = bool(raw.tabs);
  const heavy = full;

  let limit = heavy ? MAX_HEAVY_LIMIT : MAX_LIMIT;
  if (raw.limit !== undefined && raw.limit !== '') {
    const parsed = Number(raw.limit);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new QueryError(`limit must be a positive integer, got "${String(raw.limit)}"`);
    }
    limit = Math.min(parsed, limit);
  }

  const from = date(raw.from, 'from');
  const to = date(raw.to, 'to');
  if (from && to && from > to) throw new QueryError('from is later than to');

  const league = typeof raw.league === 'string' && raw.league.trim() !== '' ? raw.league.trim() : defaultLeague;

  return { league, ...(from ? { from } : {}), ...(to ? { to } : {}), limit, full, tabs };
}

function badRequest(reply: FastifyReply, error: unknown): FastifyReply {
  if (error instanceof QueryError) return reply.code(400).send({ error: error.message });
  throw error;
}

export async function snapshotRoutes(app: FastifyInstance, deps: ApiDeps): Promise<void> {
  app.get('/snapshots', async (request: FastifyRequest, reply: FastifyReply) => {
    let query: ParsedQuery;
    try {
      query = parseQuery(request.query as Record<string, unknown>, deps.config.league);
    } catch (error) {
      return badRequest(reply, error);
    }

    const { full, tabs, ...storeQuery } = query;

    if (full) {
      const snapshots = await deps.store.listFull(storeQuery);
      return reply.send({ league: query.league, count: snapshots.length, snapshots });
    }
    if (tabs) {
      const snapshots = await deps.store.listTabTotals(storeQuery);
      return reply.send({ league: query.league, count: snapshots.length, snapshots });
    }
    const snapshots = await deps.store.list(storeQuery);
    return reply.send({ league: query.league, count: snapshots.length, snapshots });
  });

  app.get('/snapshots/latest', async (request: FastifyRequest, reply: FastifyReply) => {
    const raw = request.query as Record<string, unknown>;
    const league =
      typeof raw.league === 'string' && raw.league.trim() !== '' ? raw.league.trim() : deps.config.league;

    const snapshot = await deps.store.latest(league);
    if (snapshot === null) {
      return reply.code(404).send({ error: `no snapshots yet for league "${league}"` });
    }

    return reply.send({
      snapshot,
      tabs: tabTotals(snapshot.breakdown),
      // Icons are joined in from the current price set, the only place they are stored.
      // Raised from 200 now that the table is searchable and folds tabs together: a cap that
      // small hid most of a stash from the search box, which is the one place someone goes when
      // they want to know whether they still have a thing.
      topItems: topItems(
        snapshot.breakdown,
        2000,
        deps.prices.cached?.icons ?? {},
        deps.prices.cached?.categories ?? {},
      ),
    });
  });

  /**
   * What changed between the ends of the range.
   *
   * Two snapshots, not a running total: the question this answers is "what happened over this
   * stretch", and summing every ten-minute step would just reproduce the c/h chart.
   */
  app.get('/changes', async (request: FastifyRequest, reply: FastifyReply) => {
    let query: ParsedQuery;
    try {
      query = parseQuery(request.query as Record<string, unknown>, deps.config.league);
    } catch (error) {
      return badRequest(reply, error);
    }

    const raw = request.query as Record<string, unknown>;
    const minChaos = raw.minChaos === undefined ? 1 : Number(raw.minChaos);
    if (!Number.isFinite(minChaos) || minChaos < 0) {
      return badRequest(reply, new QueryError(`minChaos must be a non-negative number`));
    }

    const { full: _full, tabs: _tabs, ...storeQuery } = query;
    const ends = await deps.store.bounds(storeQuery);
    if (ends === null) {
      // One snapshot cannot be a diff, and saying so beats an empty list that reads like
      // "nothing happened".
      return reply.send({
        league: query.league,
        from: null,
        to: null,
        changes: [],
        gainedChaos: 0,
        lostChaos: 0,
        netChaos: 0,
        reason: 'need at least two snapshots in this range',
      });
    }

    const summary = diffBreakdowns(ends.first.breakdown, ends.last.breakdown, minChaos);
    const icons = deps.prices.cached?.icons ?? {};

    return reply.send({
      league: query.league,
      from: ends.first.takenAt.toISOString(),
      to: ends.last.takenAt.toISOString(),
      /**
       * True when uniques entered the total somewhere inside this range.
       *
       * Every unique the player already owned then appears as an item that arrived, worth its
       * full price, and the net for the range is inflated by all of it. None of that is a gain
       * and the view has to say so, because the numbers themselves cannot.
       */
      uniquesArrived: !ends.first.pricedUniques && ends.last.pricedUniques,
      ...summary,
      changes: summary.changes.slice(0, 200).map((change) => {
        const icon = Object.hasOwn(icons, change.name) ? icons[change.name] : undefined;
        return { ...change, ...(icon === undefined ? {} : { icon }) };
      }),
    });
  });

  /**
   * One item's quantity and value over the range.
   *
   * This is the expensive endpoint: answering it means reading every breakdown in the range,
   * which is the column deliberately left out of every other list response. `parseQuery` is
   * given `full` so the heavy limit applies, and the range is what bounds the cost — a
   * league-wide query on a busy stash is thousands of blobs.
   */
  app.get('/item-history', async (request: FastifyRequest, reply: FastifyReply) => {
    const raw = request.query as Record<string, unknown>;
    const name = typeof raw.name === 'string' ? raw.name.trim() : '';
    if (name === '') {
      return badRequest(reply, new QueryError('name is required'));
    }

    let query: ParsedQuery;
    try {
      query = parseQuery({ ...raw, full: '1' }, deps.config.league);
    } catch (error) {
      return badRequest(reply, error);
    }

    const { full: _full, tabs: _tabs, ...storeQuery } = query;
    const points = await deps.store.itemSeries(storeQuery, name);
    const icons = deps.prices.cached?.icons ?? {};
    const icon = Object.hasOwn(icons, name) ? icons[name] : undefined;

    return reply.send({
      league: query.league,
      name,
      ...(icon === undefined ? {} : { icon }),
      points: itemHistory(points),
    });
  });

  app.get('/stats', async (request: FastifyRequest, reply: FastifyReply) => {
    let query: ParsedQuery;
    try {
      query = parseQuery(request.query as Record<string, unknown>, deps.config.league);
    } catch (error) {
      return badRequest(reply, error);
    }

    const { full: _full, tabs: _tabs, ...storeQuery } = query;
    const snapshots = await deps.store.list(storeQuery);
    const stats = computeStats(snapshots);

    // The same boundary the changes view reports, and it matters more here: gain, chaos an
    // hour and "best hour" are all differences between totals, and the one interval where
    // uniques arrived contributes a jump nobody earned. Left in the numbers rather than
    // silently smoothed away — smoothing would be this code deciding what the player did — but
    // said out loud so the figure is read as what it is.
    const uniquesArrived =
      snapshots.length > 1 &&
      snapshots.some((snapshot) => !snapshot.pricedUniques) &&
      snapshots.some((snapshot) => snapshot.pricedUniques);

    return reply.send({ league: query.league, uniquesArrived, ...stats });
  });
}
