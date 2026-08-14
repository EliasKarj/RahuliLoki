/**
 * Fastify assembly. Kept separate from index.ts so tests can build an app around fake
 * dependencies and drive it with `app.inject()` — no listening socket, no database.
 */

import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import type { ApiDeps } from './routes/deps.ts';
import { snapshotRoutes } from './routes/snapshots.ts';
import { healthRoutes } from './routes/health.ts';
import { configRoutes } from './routes/config.ts';
import { loggerOptions, scrub } from './lib/logger.ts';

export interface BuildOptions {
  /** Directory of the built SPA. Omit to run the API headless. */
  webDist?: string | null;
  logLevel?: string;
  logger?: boolean;
}

export async function buildApp(deps: ApiDeps, options: BuildOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger === false ? false : loggerOptions(options.logLevel ?? 'info'),
    // Only this process should ever be in front of it, but if somebody puts it behind a
    // reverse proxy the logs should still show the real client.
    trustProxy: true,
  });

  // Last line of defence: nothing leaves the process with a credential in it, even if some
  // upstream error message managed to carry one this far.
  app.setErrorHandler((error: FastifyError, request, reply) => {
    request.log.error({ err: error }, 'request failed');
    const status = error.statusCode ?? 500;
    reply.code(status).send({ error: scrub(status >= 500 ? 'internal server error' : error.message) });
  });

  await app.register(
    async (api) => {
      await snapshotRoutes(api, deps);
      await healthRoutes(api, deps);
      await configRoutes(api, deps);
    },
    { prefix: '/api' },
  );

  if (options.webDist) {
    const { default: fastifyStatic } = await import('@fastify/static');
    await app.register(fastifyStatic, { root: options.webDist, wildcard: false });

    // Single-page app: anything that is not an API route and not a file on disk is a client
    // route, so hand back index.html and let the router deal with it.
    app.setNotFoundHandler((request, reply) => {
      if (request.method !== 'GET' || request.url.startsWith('/api')) {
        return reply.code(404).send({ error: 'not found' });
      }
      return reply.sendFile('index.html');
    });
  }

  return app;
}
