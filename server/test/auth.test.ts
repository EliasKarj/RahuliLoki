/**
 * Access control, from three angles: the token itself, the guards that stand in front of it,
 * and the boot-time refusal that stops the whole question from arising in the first place.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { ConfigError, loadConfig, resolveAuth } from '../src/lib/config.ts';
import { clearSecrets } from '../src/lib/logger.ts';
import { isLoopbackBind, isLoopbackHost, presentedToken, tokenMatches } from '../src/lib/auth.ts';
import { makeApp } from './helpers/app.ts';

const TOKEN = 'a'.repeat(32);

afterEach(() => clearSecrets());

describe('tokenMatches', () => {
  it('accepts the exact token', () => {
    expect(tokenMatches(TOKEN, TOKEN)).toBe(true);
  });

  it('rejects a wrong token, a prefix of the right one, and nothing at all', () => {
    expect(tokenMatches(TOKEN, 'b'.repeat(32))).toBe(false);
    // Hashing both sides first is what keeps an unequal length from throwing here.
    expect(tokenMatches(TOKEN, 'a'.repeat(31))).toBe(false);
    expect(tokenMatches(TOKEN, '')).toBe(false);
    expect(tokenMatches(TOKEN, undefined)).toBe(false);
  });
});

describe('presentedToken', () => {
  it('reads a bearer header, case-insensitively', () => {
    expect(presentedToken({ authorization: `bearer ${TOKEN}` })).toBe(TOKEN);
    expect(presentedToken({ authorization: `Bearer   ${TOKEN}  ` })).toBe(TOKEN);
  });

  it('reads x-auth-token, for curl', () => {
    expect(presentedToken({ 'x-auth-token': TOKEN })).toBe(TOKEN);
  });

  it('is null when neither header carries one', () => {
    expect(presentedToken({})).toBeNull();
    expect(presentedToken({ authorization: 'Basic abc' })).toBeNull();
  });
});

describe('isLoopbackHost', () => {
  it('recognises the loopback names, with or without a port', () => {
    for (const host of ['localhost', 'localhost:3000', '127.0.0.1', '127.0.0.53:80', '[::1]:3000']) {
      expect(isLoopbackHost(host), host).toBe(true);
    }
  });

  it('does not mistake a public name for one', () => {
    for (const host of ['valuuttaloki.fly.dev', 'localhost.evil.com', '10.0.0.5']) {
      expect(isLoopbackHost(host), host).toBe(false);
    }
  });
});

describe('isLoopbackBind', () => {
  it('treats the wildcard addresses as the exposure they are', () => {
    // The distinction that matters: `Host: 0.0.0.0` is a local caller, but `HOST=0.0.0.0` is
    // "listen on every interface". Reading the second one as loopback would wave through
    // precisely the deployment this check exists to stop.
    for (const bind of ['0.0.0.0', '::', '*', '']) {
      expect(isLoopbackBind(bind), bind).toBe(false);
    }
    expect(isLoopbackHost('0.0.0.0')).toBe(true);
  });

  it('accepts the addresses that really are local-only', () => {
    for (const bind of ['127.0.0.1', 'localhost', '::1']) {
      expect(isLoopbackBind(bind), bind).toBe(true);
    }
  });

  it('rejects a LAN address', () => {
    expect(isLoopbackBind('192.168.1.10')).toBe(false);
  });
});

describe('resolveAuth', () => {
  it('refuses to serve an open API on a non-loopback bind', () => {
    expect(() => resolveAuth({} as NodeJS.ProcessEnv, '0.0.0.0')).toThrow(ConfigError);
    expect(() => resolveAuth({} as NodeJS.ProcessEnv, '0.0.0.0')).toThrow(/AUTH_TOKEN/);
  });

  it('allows an open API on loopback, which is the dev default', () => {
    expect(resolveAuth({} as NodeJS.ProcessEnv, '127.0.0.1').authToken).toBeNull();
  });

  it('allows a wide bind once a token is set', () => {
    const env = { AUTH_TOKEN: TOKEN } as NodeJS.ProcessEnv;
    expect(resolveAuth(env, '0.0.0.0').authToken).toBe(TOKEN);
  });

  it('allows a wide bind when the operator explicitly takes responsibility', () => {
    const env = { ALLOW_UNAUTHENTICATED: '1' } as NodeJS.ProcessEnv;
    expect(resolveAuth(env, '0.0.0.0').authToken).toBeNull();
  });

  it('rejects a token too short to be worth having', () => {
    expect(() => resolveAuth({ AUTH_TOKEN: 'hunter2' } as NodeJS.ProcessEnv, '0.0.0.0')).toThrow(
      /at least 16/,
    );
  });

  it('defaults HOST to loopback rather than every interface', () => {
    expect(loadConfig({} as NodeJS.ProcessEnv).config.host).toBe('127.0.0.1');
  });
});

describe('the API behind a token', () => {
  const env = { AUTH_TOKEN: TOKEN, ALLOWED_HOSTS: 'valuuttaloki.fly.dev' } as NodeJS.ProcessEnv;
  const auth = { authorization: `Bearer ${TOKEN}` };

  it('refuses to serve wealth data without one', async () => {
    const { app } = await makeApp({}, env);
    for (const url of ['/api/snapshots', '/api/snapshots/latest', '/api/stats', '/api/config']) {
      const response = await app.inject({ method: 'GET', url });
      expect(response.statusCode, url).toBe(401);
    }
  });

  it('refuses to spend the account rate-limit budget without one', async () => {
    const { app, poller } = await makeApp({}, env);
    const response = await app.inject({ method: 'POST', url: '/api/poll' });
    expect(response.statusCode).toBe(401);
    // The point of the guard: the poller was never asked to do anything.
    expect(poller.calls).toBe(0);
  });

  it('serves the same data once the token is presented', async () => {
    const { app } = await makeApp({}, env);
    const response = await app.inject({ method: 'GET', url: '/api/snapshots', headers: auth });
    expect(response.statusCode).toBe(200);
    expect(response.json().count).toBeGreaterThan(0);
  });

  it('accepts x-auth-token as well as a bearer header', async () => {
    const { app } = await makeApp({}, env);
    const response = await app.inject({
      method: 'GET',
      url: '/api/config',
      headers: { 'x-auth-token': TOKEN },
    });
    expect(response.statusCode).toBe(200);
  });

  it('rejects a near-miss token', async () => {
    const { app } = await makeApp({}, env);
    const response = await app.inject({
      method: 'GET',
      url: '/api/config',
      headers: { authorization: `Bearer ${'a'.repeat(31)}b` },
    });
    expect(response.statusCode).toBe(401);
  });

  it('answers health without a token, but says nothing about the account', async () => {
    const { app } = await makeApp({}, env);
    const response = await app.inject({ method: 'GET', url: '/api/health' });

    // 200 so a container healthcheck keeps working before anyone configures it with a token.
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toEqual({ status: 'up' });
    // None of the diagnostics an anonymous caller has no business seeing.
    expect(body.poller).toBeUndefined();
    expect(body.league).toBeUndefined();
    expect(body.rateLimit).toBeUndefined();
  });

  it('gives the full health picture to an authenticated caller', async () => {
    const { app } = await makeApp({}, env);
    const body = (await app.inject({ method: 'GET', url: '/api/health', headers: auth })).json();
    expect(body.league).toBe('Settlers');
    expect(body.poller.totalPolls).toBe(12);
    expect(body.rateLimit.buckets).toHaveLength(1);
  });

  it('never echoes the token back, even when a request fails', async () => {
    const { app } = await makeApp({}, env);
    const response = await app.inject({
      method: 'GET',
      url: '/api/snapshots?limit=nonsense',
      headers: auth,
    });
    expect(response.body).not.toContain(TOKEN);
  });
});

describe('the cross-origin guard', () => {
  const env = { AUTH_TOKEN: TOKEN } as NodeJS.ProcessEnv;
  const auth = { authorization: `Bearer ${TOKEN}` };

  it('rejects a write from another origin even with a valid token', async () => {
    // The shape of a CSRF attempt: the browser attaches the credential, the attacker picks
    // the target. The Origin header is the part they cannot forge.
    const { app } = await makeApp({}, env);
    const response = await app.inject({
      method: 'POST',
      url: '/api/poll',
      headers: { ...auth, origin: 'https://evil.example', host: 'localhost:3000' },
    });
    expect(response.statusCode).toBe(403);
  });

  it('allows a write from the page it serves', async () => {
    const { app, poller } = await makeApp({}, env);
    const response = await app.inject({
      method: 'POST',
      url: '/api/poll',
      headers: { ...auth, origin: 'http://localhost:3000', host: 'localhost:3000' },
    });
    // 202 rather than 403: the guard let it through and the poll started. What the poll then
    // does is not this guard's business — the route answers before the poll finishes.
    expect(response.statusCode).toBe(202);
    expect(poller.calls).toBe(1);
  });

  it('allows a write with no Origin header at all, which is what curl sends', async () => {
    const { app } = await makeApp({}, env);
    const response = await app.inject({ method: 'POST', url: '/api/poll', headers: auth });
    expect(response.statusCode).not.toBe(403);
  });
});

describe('the Host guard in token-less mode', () => {
  it('rejects a Host that is neither loopback nor allowed', async () => {
    // DNS rebinding: the attacker's name resolves to 127.0.0.1, so the browser considers
    // their script same-origin. The Host header still says what they asked for.
    const { app } = await makeApp({}, { ALLOW_UNAUTHENTICATED: '1' } as NodeJS.ProcessEnv);
    const response = await app.inject({
      method: 'GET',
      url: '/api/config',
      headers: { host: 'rebind.evil.example' },
    });
    expect(response.statusCode).toBe(403);
  });

  it('accepts loopback, and any host the operator listed', async () => {
    const { app } = await makeApp(
      {},
      { ALLOW_UNAUTHENTICATED: '1', ALLOWED_HOSTS: 'wealth.lan' } as NodeJS.ProcessEnv,
    );
    for (const host of ['localhost:3000', '127.0.0.1:3000', 'wealth.lan']) {
      const response = await app.inject({ method: 'GET', url: '/api/config', headers: { host } });
      expect(response.statusCode, host).toBe(200);
    }
  });
});

describe('response headers', () => {
  it('sets the headers that keep the dashboard out of frames, caches and sniffers', async () => {
    const { app } = await makeApp();
    const { headers } = await app.inject({ method: 'GET', url: '/api/config' });

    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['referrer-policy']).toBe('no-referrer');
    expect(headers['cache-control']).toBe('no-store');
    expect(String(headers['content-security-policy'])).toContain("frame-ancestors 'none'");
    expect(String(headers['content-security-policy'])).toContain("object-src 'none'");
  });
});
