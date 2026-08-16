/**
 * Access control for the API.
 *
 * The spec lists multi-user accounts as a non-goal, and this is not that: there is one token,
 * shared, for the one person who runs the thing. It exists because the deployment story in
 * fly.toml puts the whole API on the public internet, where "single user" is a statement about
 * who *should* be reading it, not about who can.
 *
 * What an unauthenticated reader would otherwise get: the complete wealth history of a named
 * GGG account, the tab layout, and a POST /api/poll that spends that account's GGG rate-limit
 * budget on demand — the one resource the entire RateLimiter exists to protect.
 *
 * Three separate guards, because they stop three different things:
 *
 *   requireToken  a shared bearer token. Stops anyone who does not have it.
 *   originGuard   rejects cross-origin writes. Stops a page the operator happens to be
 *                 visiting from POSTing to the poller in their browser's name (CSRF) — which
 *                 needs no token at all, because the browser would attach it.
 *   hostGuard     rejects unexpected Host headers in token-less mode. Stops DNS rebinding,
 *                 where an attacker's domain resolves to 127.0.0.1 and their script becomes
 *                 same-origin with a service that trusted the loopback interface.
 */

import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

/** Shorter than this is not a secret, it is a speed bump. */
export const MIN_TOKEN_LENGTH = 16;

/**
 * Compare in constant time. Both sides are hashed first so that unequal lengths do not throw
 * and do not leak the true length through the comparison itself.
 */
export function tokenMatches(expected: string, presented: string | undefined | null): boolean {
  if (typeof presented !== 'string' || presented === '') return false;
  const a = createHash('sha256').update(expected, 'utf8').digest();
  const b = createHash('sha256').update(presented, 'utf8').digest();
  return timingSafeEqual(a, b);
}

/** `Authorization: Bearer <token>`, or `X-Auth-Token: <token>` for hand-rolled curl calls. */
export function presentedToken(headers: Record<string, unknown>): string | null {
  const auth = headers.authorization;
  if (typeof auth === 'string') {
    const match = /^Bearer\s+(.+)$/i.exec(auth.trim());
    if (match?.[1]) return match[1].trim();
  }
  const header = headers['x-auth-token'];
  if (typeof header === 'string' && header.trim() !== '') return header.trim();
  return null;
}

function hostnameOf(value: string | undefined): string | null {
  if (!value) return null;
  // Host is `name` or `name:port`, and may be a bracketed IPv6 literal.
  const trimmed = value.trim().toLowerCase();
  if (trimmed.startsWith('[')) return trimmed.slice(1, trimmed.indexOf(']'));
  const [name] = trimmed.split(':');
  return name ?? null;
}

/**
 * Names a client can legitimately put in a `Host` header when it reached this process over the
 * loopback interface. `0.0.0.0` is in here because `curl http://0.0.0.0:3000` sends it —
 * see `isLoopbackBind` for why that same string means the opposite as a bind address.
 */
const LOOPBACK_HOST_NAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0']);

/** Is this `Host` header value one that only a local client could have produced? */
export function isLoopbackHost(value: string | undefined): boolean {
  const name = hostnameOf(value);
  if (name === null) return false;
  return LOOPBACK_HOST_NAMES.has(name) || name.startsWith('127.');
}

/**
 * Is this bind address reachable *only* from this machine?
 *
 * Deliberately not `isLoopbackHost`. As a bind address `0.0.0.0` (and `::`, and the empty
 * string) means every interface — the widest possible exposure — while as a Host header it is
 * a local caller. Sharing one predicate between the two reads the wildcard bind as safe, which
 * is exactly backwards for the check that guards a public deployment.
 */
export function isLoopbackBind(value: string | undefined): boolean {
  // Not `hostnameOf`: that splits on ':' to strip a port, which mangles a bare IPv6 literal.
  // A bind address never carries a port, so it needs no stripping.
  const name = value?.trim().toLowerCase() ?? '';
  if (name === '') return false;
  if (name === '0.0.0.0' || name === '::' || name === '*') return false;
  return name === 'localhost' || name === '::1' || name === '[::1]' || name.startsWith('127.');
}

export interface AuthOptions {
  /** Null means the operator explicitly accepted an open API on a trusted interface. */
  token: string | null;
  /** Extra Host values accepted in token-less mode, beyond the loopback names. */
  allowedHosts: string[];
}

/**
 * A cross-origin write is never something this app initiates: the SPA is served from the same
 * origin as the API. Browsers always send `Origin` on POST, so a mismatch is a forgery.
 */
export function originAllowed(request: FastifyRequest): boolean {
  const origin = request.headers.origin;
  if (typeof origin !== 'string' || origin === '' || origin === 'null') return true;
  let originHost: string | null;
  try {
    originHost = new URL(origin).host.toLowerCase();
  } catch {
    return false;
  }
  const host = (request.headers.host ?? '').toLowerCase();
  return originHost === host;
}

export function hostAllowed(request: FastifyRequest, allowedHosts: string[]): boolean {
  const host = request.headers.host;
  if (isLoopbackHost(host)) return true;
  const name = hostnameOf(host);
  if (name === null) return false;
  return allowedHosts.some((allowed) => allowed.toLowerCase() === name);
}

/**
 * Install the guards on a scope. Registered as an `onRequest` hook so a rejected request never
 * reaches a handler, a database query, or the poller.
 *
 * `publicPaths` are exempt from the token only — the origin and host guards still apply. It
 * exists for /api/health, which a container orchestrator has to be able to reach before it can
 * be told a token, and which answers with nothing sensitive when unauthenticated.
 */
export function registerAuth(
  app: FastifyInstance,
  options: AuthOptions,
  publicPaths: string[] = [],
): void {
  const exempt = new Set(publicPaths);

  app.decorateRequest('authenticated', false);

  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.method !== 'GET' && request.method !== 'HEAD' && !originAllowed(request)) {
      return reply.code(403).send({ error: 'cross-origin request rejected' });
    }

    if (options.token === null) {
      // Token-less mode is only defensible on an interface the operator controls. Without this
      // check, an attacker's hostname pointed at 127.0.0.1 is same-origin with the dashboard.
      if (!hostAllowed(request, options.allowedHosts)) {
        return reply.code(403).send({ error: 'unexpected Host header' });
      }
      request.authenticated = true;
      return;
    }

    const authenticated = tokenMatches(options.token, presentedToken(request.headers));
    request.authenticated = authenticated;

    if (!authenticated) {
      const path = request.url.split('?')[0] ?? '';
      if (exempt.has(path)) return;
      return reply
        .code(401)
        .header('www-authenticate', 'Bearer realm="valuuttaloki"')
        .send({ error: 'authentication required' });
    }
  });
}

declare module 'fastify' {
  interface FastifyRequest {
    /** True when the request carried a valid token, or when no token is configured. */
    authenticated: boolean;
  }
}
