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
import { describeError } from '../lib/logger.ts';

export async function configRoutes(app: FastifyInstance, deps: ApiDeps): Promise<void> {
  /**
   * Who GGG says the stored session belongs to.
   *
   * The one question that separates the two causes of a 403 from the stash endpoint, which are
   * otherwise identical from the outside: a session GGG will not accept, or a session it accepts
   * for a different account than POE_ACCOUNT_NAME names. This call needs no account name, so an
   * answer proves the session and names the account in the same breath.
   *
   * The name it returns is safe to show — it is the account's public handle, and the user just
   * signed in as it. The session itself is not in the response and must never be added to it.
   */
  app.get('/account', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const profile = await deps.profile();
      const configured = deps.config.accountName.trim();
      return reply.send({
        name: profile.name,
        configured: configured === '' ? null : configured,
        // The comparison the caller would otherwise have to make itself, and the whole reason
        // this endpoint exists. GGG is case-insensitive about the handle; the discriminator is
        // part of the name and is not optional.
        matches: configured !== '' && configured.toLowerCase() === profile.name.toLowerCase(),
      });
    } catch (error) {
      // 502: this is GGG's answer, not ours. The message is the actionable part — it already
      // says whether the session is the problem — so it is passed through rather than flattened.
      app.log.warn({ err: error }, 'could not read the GGG profile for the stored session');
      return reply.code(502).send({ error: describeError(error).message });
    }
  });

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
