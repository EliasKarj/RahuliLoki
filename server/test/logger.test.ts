import { afterEach, describe, expect, it } from 'vitest';
import { clearSecrets, describeError, loggerOptions, registerSecret, scrub } from '../src/lib/logger.ts';

const SESSION = 'e1b2c3d4e5f60718293a4b5c6d7e8f90';

afterEach(() => clearSecrets());

describe('scrub', () => {
  it('removes a registered secret from free text', () => {
    registerSecret(SESSION);
    expect(scrub(`cookie: POESESSID=${SESSION}`)).toBe('cookie: POESESSID=[redacted]');
  });

  it('removes every occurrence', () => {
    registerSecret(SESSION);
    expect(scrub(`${SESSION} and ${SESSION}`)).toBe('[redacted] and [redacted]');
  });

  it('leaves unrelated text alone', () => {
    registerSecret(SESSION);
    expect(scrub('GGG returned HTTP 503')).toBe('GGG returned HTTP 503');
  });

  it('ignores values too short to be a credential, which would blank out real text', () => {
    registerSecret('abc');
    expect(scrub('abc def')).toBe('abc def');
  });

  it('ignores a missing secret', () => {
    registerSecret(undefined);
    registerSecret(null);
    expect(scrub('nothing to do')).toBe('nothing to do');
  });
});

describe('describeError', () => {
  it('scrubs the message and the stack of a thrown error', () => {
    registerSecret(SESSION);
    const error = new Error(`request to https://ggg?sid=${SESSION} failed`);
    const described = describeError(error);

    expect(described.message).not.toContain(SESSION);
    expect(described.stack ?? '').not.toContain(SESSION);
    expect(described.name).toBe('Error');
  });

  it('handles a thrown non-error', () => {
    registerSecret(SESSION);
    expect(describeError(`boom ${SESSION}`).message).toBe('boom [redacted]');
  });
});

describe('loggerOptions', () => {
  it('redacts the cookie header pino would otherwise print in full', () => {
    const options = loggerOptions('info');
    expect(options.redact.paths).toContain('req.headers.cookie');
    expect(options.redact.censor).toBe('[redacted]');
    expect(options.level).toBe('info');
  });
});

describe('describeError', () => {
  it('follows the cause chain, which is where fetch hides the real reason', () => {
    // Every transport failure arrives as a bare "fetch failed". Without the cause, a DNS
    // failure, a refused connection and an expired certificate all read identically.
    const error = new TypeError('fetch failed', {
      cause: new Error('getaddrinfo ENOTFOUND poe.ninja'),
    });
    expect(describeError(error).message).toBe('fetch failed: getaddrinfo ENOTFOUND poe.ninja');
  });

  it('walks more than one link deep', () => {
    const root = new Error('connect ECONNREFUSED 1.2.3.4:443');
    const middle = new Error('socket failure', { cause: root });
    const outer = new TypeError('fetch failed', { cause: middle });
    expect(describeError(outer).message).toBe(
      'fetch failed: socket failure: connect ECONNREFUSED 1.2.3.4:443',
    );
  });

  it('does not repeat a cause that merely echoes its wrapper', () => {
    const error = new Error('same', { cause: new Error('same') });
    expect(describeError(error).message).toBe('same');
  });

  it('survives a circular cause chain', () => {
    const a = new Error('a') as Error & { cause?: unknown };
    const b = new Error('b', { cause: a });
    a.cause = b;
    expect(describeError(a).message).toBe('a: b');
  });

  it('describes a thrown plain object by its fields, not as [object Object]', () => {
    expect(describeError({ code: 'ENOTFOUND', hostname: 'poe.ninja' }).message).toBe(
      'code=ENOTFOUND hostname=poe.ninja',
    );
  });

  it('falls back to JSON for an object with no recognised fields', () => {
    expect(describeError({ weird: 1 }).message).toBe('{"weird":1}');
  });

  it('still handles primitives and null', () => {
    expect(describeError('plain string').message).toBe('plain string');
    expect(describeError(null).message).toBe('null');
    expect(describeError(undefined).message).toBe('undefined');
  });

  it('scrubs secrets out of a cause, not just the top-level message', () => {
    registerSecret('supersecretsession');
    const error = new Error('outer', { cause: new Error('cookie was supersecretsession') });
    expect(describeError(error).message).toBe('outer: cookie was [redacted]');
  });
});
