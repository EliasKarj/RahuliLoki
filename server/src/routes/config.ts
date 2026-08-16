/**
 * What the frontend is allowed to know about the configuration.
 *
 * POESESSID is not in this response and must never be added to it. The frontend needs the
 * league, the schedule and the thresholds so it can label the charts honestly; it has no use
 * for a credential.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ApiDeps } from './deps.ts';
import { publicConfig } from '../lib/config.ts';

export async function configRoutes(app: FastifyInstance, deps: ApiDeps): Promise<void> {
  /**
   * The leagues that currently exist, for the setup dropdown.
   *
   * Distinct from `/api/config`'s `leagues`, which is the leagues this database has history
   * for. One answers "what can I track", the other "what have I tracked".
   */
  app.get('/leagues', async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.send(await deps.leagues());
  });

  app.get('/config', async (_request: FastifyRequest, reply: FastifyReply) => {
    const leagues = await deps.store.leagues();
    return reply.send({
      ...publicConfig(deps.config, deps.missing),
      // Every league with history, so the UI can offer the previous one after a rollover.
      leagues: leagues.includes(deps.config.league) ? leagues : [deps.config.league, ...leagues],
    });
  });
}
