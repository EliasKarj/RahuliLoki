/**
 * The snapshot read API.
 *
 *   GET /api/snapshots         list; breakdown omitted unless ?full=1, per-tab sums on ?tabs=1
 *   GET /api/snapshots/latest  the newest snapshot, with its full breakdown and top items
 *   GET /api/stats             total gain, chaos-per-hour (active and wall-clock), best hour
 *
 * `league` defaults to the configured one. It is a query parameter rather than an assumption
 * because a league rollover leaves the previous league's series sitting in the same database,
 * and being able to look back at it is the point of keeping it.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ApiDeps } from './deps.ts';
import { computeStats } from '../lib/series.ts';
import { tabTotals, topItems } from '../services/valuationService.ts';
import type { SnapshotQuery } from '../services/snapshotRepo.ts';

/** Hard ceiling on a single response, whatever ?limit says. */
const MAX_LIMIT = 10_000;
/** Lower ceiling when the breakdown has to be read off disk to answer. */
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
  const heavy = full || tabs;

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
      topItems: topItems(snapshot.breakdown, 200),
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
    return reply.send({ league: query.league, ...stats });
  });
}
