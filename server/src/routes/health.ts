/**
 * Poller-facing endpoints: what the last poll did, where we stand with GGG's rate limiter,
 * and a manual trigger for when you are debugging and do not want to wait ten minutes.
 *
 * /api/health always answers 200 while the process is up. `status` carries the verdict:
 * a halted poller is not something a container restart fixes, and flapping a health check
 * over an expired POESESSID would just restart-loop the container for a day.
 *
 * It is also the one endpoint reachable without a token, because Docker and Fly have to call
 * it before anyone can hand them one. So it answers in two registers: an unauthenticated
 * caller learns only that the process is serving, while an authenticated one also gets the
 * poller's error messages, the account's position in GGG's rate limiter and the price state.
 * Those are diagnostics about a named account; a liveness probe has no use for them.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ApiDeps } from './deps.ts';
import { PollerBusyError, PollerHaltedError } from '../jobs/pollJob.ts';
import { describeError } from '../lib/logger.ts';

export type HealthStatus = 'ok' | 'idle' | 'degraded' | 'halted' | 'unconfigured';

export function healthStatus(deps: ApiDeps): HealthStatus {
  if (deps.missing.length > 0) return 'unconfigured';
  const poller = deps.poller.health;
  if (poller.halted) return 'halted';
  if (poller.consecutiveFailures > 0) return 'degraded';
  if (poller.lastSuccessAt === null) return 'idle';
  return 'ok';
}

export async function healthRoutes(app: FastifyInstance, deps: ApiDeps): Promise<void> {
  app.get('/health', async (request: FastifyRequest, reply: FastifyReply) => {
    // Enough for `HEALTHCHECK` and Fly's http_service check — 200 means it is serving — and
    // nothing an anonymous caller can learn about the account from.
    if (!request.authenticated) {
      return reply.send({ status: 'up' });
    }

    const priceSet = deps.prices.cached;
    return reply.send({
      status: healthStatus(deps),
      league: deps.config.league,
      uptimeSeconds: Math.round((Date.now() - deps.startedAt.getTime()) / 1000),
      poller: deps.poller.health,
      rateLimit: deps.rateLimit(),
      prices:
        priceSet === null
          ? { fetchedAt: null, entries: 0, divineRate: 0, stale: true }
          : {
              fetchedAt: priceSet.fetchedAt.toISOString(),
              entries: Object.keys(priceSet.prices).length,
              divineRate: priceSet.divineRate,
              stale: deps.prices.isStale(),
            },
      missing: deps.missing,
    });
  });

  app.post('/poll', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const outcome = await deps.poller.runNow();
      const { snapshot, ...rest } = outcome;
      return reply.send({ ok: true, snapshot, ...rest });
    } catch (error) {
      if (error instanceof PollerBusyError) {
        return reply.code(409).send({ ok: false, error: error.message });
      }
      if (error instanceof PollerHaltedError) {
        return reply.code(503).send({ ok: false, error: error.message });
      }
      // A failed manual poll is a normal answer to "try it and tell me what breaks", not a
      // server fault: report what went wrong with the poll rather than a bare 500.
      app.log.error({ err: describeError(error) }, 'manual poll failed');
      return reply.code(502).send({ ok: false, error: describeError(error).message });
    }
  });
}
