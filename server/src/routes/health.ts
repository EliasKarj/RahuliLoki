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
import { describeError, scrub } from '../lib/logger.ts';

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
          ? { fetchedAt: null, entries: 0, divineRate: 0, stale: true, chaosIcon: null, divineIcon: null }
          : {
              fetchedAt: priceSet.fetchedAt.toISOString(),
              entries: Object.keys(priceSet.prices).length,
              divineRate: priceSet.divineRate,
              stale: deps.prices.isStale(),
              // The two orbs every figure in this app is quoted in. Served here because this is
              // already where the rate lives, and the header needs the icon for whichever unit
              // the rate put the number in.
              chaosIcon: priceSet.icons['Chaos Orb'] ?? null,
              divineIcon: priceSet.icons['Divine Orb'] ?? null,
            },
      missing: deps.missing,
    });
  });

  /**
   * Start a poll. Answers as soon as it has started, not when it has finished.
   *
   * A poll paces itself against GGG's rate limit, and the tightest bucket on the stash endpoint
   * refills slowly enough that one request every eighteen seconds is the honest rate. A stash
   * with twenty tabs is therefore several minutes of work — and this used to hold the HTTP
   * request open for all of it.
   *
   * Nothing survives that. The client gives up long before the poll does and reports a network
   * failure, so a poll that was running perfectly well looked like a broken server: "Failed to
   * fetch" on screen while the log quietly went on reading tabs.
   *
   * So the poll is started and the request returns 202. Progress and outcome live in
   * `/api/health`, which the dashboard already reads: `poller.running` says it is going,
   * `lastSuccessAt` and `lastError` say how it ended.
   */
  app.post('/poll', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const health = deps.poller.health;
      // Checked here rather than inferred from a rejection: once the poll is running, its
      // rejection arrives minutes later and cannot be an HTTP status on this request any more.
      if (health.disabledReason) {
        // Scrubbed like every other string this app echoes outward. The reason is built from
        // configuration and has no business carrying a credential, but "has no business" is not
        // a guarantee, and this is the cheapest place to make it one.
        return reply.code(503).send({ ok: false, error: scrub(health.disabledReason) });
      }
      if (health.running) {
        return reply.code(409).send({ ok: false, error: 'a poll is already running' });
      }

      // Deliberately not awaited. A failure is recorded in the poller's own health — that is
      // what its run loop exists to do — so there is nothing for this handler to report later.
      void deps.poller.runNow().catch(() => undefined);

      return reply.code(202).send({ ok: true, started: true });
    } catch (error) {
      if (error instanceof PollerBusyError) {
        return reply.code(409).send({ ok: false, error: error.message });
      }
      if (error instanceof PollerHaltedError) {
        return reply.code(503).send({ ok: false, error: error.message });
      }
      // A failed manual poll is a normal answer to "try it and tell me what breaks", not a
      // server fault: report what went wrong with the poll rather than a bare 500.
      app.log.error({ err: error }, 'manual poll failed');
      return reply.code(502).send({ ok: false, error: describeError(error).message });
    }
  });
}
