/**
 * Logging to somewhere other than stdout.
 *
 * The packaged desktop application has no console to write to, so its log goes to a file. That
 * is a different destination, not a different set of rules: everything the redaction does on
 * the way to a terminal it has to do on the way to a file, which is a thing worth a test rather
 * than an assumption — a leaked POESESSID in a file is worse than one on a screen, because the
 * file is still there tomorrow.
 */

import { describe, expect, it } from 'vitest';
import { Writable } from 'node:stream';
import { registerSecret } from '../src/lib/logger.ts';
import { SESSION, makeApp } from './helpers/app.ts';

/** Collects everything written to it, as text. */
function capture(): { stream: Writable; text: () => string } {
  const chunks: string[] = [];
  return {
    stream: new Writable({
      write(chunk, _encoding, done) {
        chunks.push(String(chunk));
        done();
      },
    }),
    text: () => chunks.join(''),
  };
}

describe('logDestination', () => {
  it('writes the log to the stream it is given rather than stdout', async () => {
    const sink = capture();
    const { app } = await makeApp({}, {}, { logDestination: sink.stream });

    await app.inject({ method: 'GET', url: '/api/health' });
    await app.close();

    const lines = sink.text().trim().split('\n').map((line) => JSON.parse(line) as { msg?: string });
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.some((line) => line.msg === 'request completed')).toBe(true);
  });

  it('still redacts the session credential on the way to a file', async () => {
    registerSecret(SESSION);
    const sink = capture();
    const { app } = await makeApp({}, {}, { logDestination: sink.stream });

    // Both ways a credential reaches a log line: a field the redact paths name, and a message
    // that happens to carry the value inside prose. The stream sees neither.
    app.log.info({ poesessid: SESSION, req: { headers: { cookie: `POESESSID=${SESSION}` } } }, 'config');
    app.log.error(`upstream said: POESESSID=${SESSION} is not valid`);
    await app.close();

    expect(sink.text()).not.toContain(SESSION);
    expect(sink.text()).toContain('[redacted]');
  });
});
