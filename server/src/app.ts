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
import { registerAuth } from './lib/auth.ts';

export interface BuildOptions {
  /** Directory of the built SPA. Omit to run the API headless. */
  webDist?: string | null;
  logLevel?: string;
  logger?: boolean;
  /**
   * Where log lines go. Defaults to stdout.
   *
   * The packaged desktop application has no stdout worth writing to: it is a windowed program,
   * and on Windows a GUI process has no console attached at all, so every line would be
   * written into nothing. Pointing this at a file is what keeps the log readable after a
   * failure without opening a terminal window next to the app to hold it.
   */
  logDestination?: NodeJS.WritableStream;
}

/**
 * The SPA is one bundle, one stylesheet and one XHR target, all same-origin. Everything else
 * is denied outright, so an injected `<script src>` or a stray iframe has nowhere to point.
 *
 * `style-src` needs 'unsafe-inline': Recharts sizes and positions its SVG through inline style
 * attributes, and there is no nonce mechanism for those. Script execution stays locked down,
 * which is the half that matters.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  // Item icons are served off GGG's own CDN, which is where poe.ninja points at them. Widened
  // for images only — an <img> cannot execute, and the server-side icon parser already refuses
  // any URL that is not https on a poecdn.com host, so this is the second of two checks.
  "img-src 'self' data: https://web.poecdn.com",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

export async function buildApp(deps: ApiDeps, options: BuildOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger:
      options.logger === false
        ? false
        : {
            ...loggerOptions(options.logLevel ?? 'info'),
            ...(options.logDestination ? { stream: options.logDestination } : {}),
          },
    // Off unless the operator says a proxy is really in front. Trusting X-Forwarded-For
    // unconditionally means any client can write whatever it likes into the `remoteAddress`
    // field of every log line about it.
    trustProxy: deps.config.trustProxy,
    // The API takes no request bodies at all; POST /api/poll is a bare trigger. 16 KiB is
    // generous for "nothing" and stops a large upload from being buffered before it is refused.
    bodyLimit: 16 * 1024,
  });

  // Last line of defence: nothing leaves the process with a credential in it, even if some
  // upstream error message managed to carry one this far.
  app.setErrorHandler((error: FastifyError, request, reply) => {
    request.log.error({ err: error }, 'request failed');
    const status = error.statusCode ?? 500;
    reply.code(status).send({ error: scrub(status >= 500 ? 'internal server error' : error.message) });
  });

  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'no-referrer');
    reply.header('x-frame-options', 'DENY');
    reply.header('cross-origin-opener-policy', 'same-origin');
    reply.header('cross-origin-resource-policy', 'same-origin');
    reply.header('content-security-policy', CSP);
    // A wealth dashboard has nothing a shared cache or a search engine should keep.
    reply.header('cache-control', 'no-store');
    if (request.protocol === 'https') {
      reply.header('strict-transport-security', 'max-age=31536000; includeSubDomains');
    }
    return payload;
  });

  await app.register(
    async (api) => {
      // /health stays reachable without a token: a container orchestrator has to be able to
      // call it before anyone can hand it one. Its unauthenticated body says only that the
      // process is up — see routes/health.ts.
      registerAuth(
        api,
        { token: deps.config.authToken, allowedHosts: deps.config.allowedHosts },
        ['/api/health'],
      );
      await snapshotRoutes(api, deps);
      await healthRoutes(api, deps);
      await configRoutes(api, deps);
    },
    { prefix: '/api' },
  );

  if (options.webDist) {
    const { default: fastifyStatic } = await import('@fastify/static');
    await app.register(fastifyStatic, {
      root: options.webDist,
      wildcard: false,
      // Nothing under the bundle directory is meant to be browsed, and a listing is how a
      // path-traversal bug turns into an inventory of the filesystem.
      index: ['index.html'],
      list: false,
      dotfiles: 'deny',
    });

    // Single-page app: a request for a client route gets index.html and the router sorts it
    // out. A request for a missing *asset* must not — handing back HTML for a missing .js
    // turns a stale deploy into an inscrutable MIME-type error in the browser console
    // instead of an honest 404.
    app.setNotFoundHandler((request, reply) => {
      const path = request.url.split('?')[0] ?? '/';
      const looksLikeFile = /\.[a-z0-9]+$/i.test(path);
      const wantsHtml = (request.headers.accept ?? '').includes('text/html');

      if (request.method !== 'GET' || path.startsWith('/api') || looksLikeFile || !wantsHtml) {
        return reply.code(404).send({ error: 'not found' });
      }
      return reply.sendFile('index.html');
    });
  }

  return app;
}
