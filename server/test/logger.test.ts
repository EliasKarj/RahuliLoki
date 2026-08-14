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
