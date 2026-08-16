import { describe, expect, it, vi } from 'vitest';
import { awaitVerifiedSession } from '../src/sessionWait.ts';

/**
 * A login window driven by a script of cookie values, one per poll.
 *
 * `verified` is the set of values GGG would accept. Everything else is refused, which is what
 * the anonymous cookie does for real.
 */
function probe(script: (string | null)[], verified: Record<string, string> = {}) {
  let tick = 0;
  let clock = 0;
  const asked: string[] = [];

  return {
    asked,
    polls: () => tick,
    options: {
      readCookie: async () => script[Math.min(tick, script.length - 1)] ?? null,
      verify: async (poesessid: string) => {
        asked.push(poesessid);
        const name = verified[poesessid];
        if (name === undefined) throw new Error('GGG does not accept this session');
        return name;
      },
      isOpen: () => tick < script.length,
      wait: async (ms: number) => {
        tick += 1;
        clock += ms;
      },
      now: () => clock,
    },
  };
}

describe('awaitVerifiedSession', () => {
  it('refuses the anonymous cookie the login page sets before anyone types', async () => {
    // The bug this exists to prevent. pathofexile.com sets a POESESSID immediately, so "a cookie
    // exists" fired half a second in, stored a session that was never logged in, and every stash
    // request afterwards came back 403 blaming an expired session.
    const subject = probe(['anon', 'anon', 'anon']);
    expect(await awaitVerifiedSession(subject.options)).toBeNull();
  });

  it('accepts the cookie GGG issues once the login completes', async () => {
    const subject = probe(['anon', 'anon', 'real', 'real'], { real: 'Exile#1234' });
    expect(await awaitVerifiedSession(subject.options)).toEqual({
      poesessid: 'real',
      accountName: 'Exile#1234',
    });
  });

  it('returns the account name, so nobody has to type it', async () => {
    const subject = probe(['real'], { real: 'elkkukkeli#6495' });
    expect((await awaitVerifiedSession(subject.options))?.accountName).toBe('elkkukkeli#6495');
  });

  it('does not ask GGG about an unchanged cookie on every poll', async () => {
    // The window can be open for a minute while someone finds their password and does 2FA.
    // Polling GGG twice a second through all of it would be rude and pointless.
    const subject = probe(Array.from({ length: 8 }, () => 'anon'));
    await awaitVerifiedSession({ ...subject.options, pollMs: 1000, recheckMs: 4000 });

    // Once at the start, then once per recheck window — not once per poll.
    expect(subject.asked.length).toBeLessThanOrEqual(4);
    expect(subject.asked.length).toBeGreaterThan(1);
  });

  it('rechecks an unchanged cookie, in case GGG elevated it in place', async () => {
    // Nothing promises GGG issues a *new* cookie on login rather than upgrading the one it set.
    // Keying only on a changed value would hang forever on a session that had started working.
    let accepted = false;
    const asked: string[] = [];
    let tick = 0;
    let clock = 0;

    const result = await awaitVerifiedSession({
      readCookie: async () => 'same-value-throughout',
      verify: async (poesessid) => {
        asked.push(poesessid);
        if (!accepted) throw new Error('not yet');
        return 'Exile#1234';
      },
      isOpen: () => tick < 10,
      wait: async (ms) => {
        tick += 1;
        clock += ms;
        if (tick === 5) accepted = true;
      },
      now: () => clock,
      pollMs: 1000,
      recheckMs: 2000,
    });

    expect(result).toEqual({ poesessid: 'same-value-throughout', accountName: 'Exile#1234' });
    expect(asked.length).toBeGreaterThan(1);
  });

  it('checks once more after the window closes', async () => {
    // Someone can finish the login and close the window in the same breath. The cookie that
    // arrived a moment earlier is a perfectly good session and must not be thrown away.
    let tick = 0;
    const result = await awaitVerifiedSession({
      readCookie: async () => (tick === 0 ? 'anon' : 'real'),
      verify: async (poesessid) => {
        if (poesessid !== 'real') throw new Error('nope');
        return 'Exile#1234';
      },
      // Closed after the very first poll.
      isOpen: () => tick < 1,
      wait: async () => {
        tick += 1;
      },
      now: () => 0,
    });

    expect(result?.poesessid).toBe('real');
  });

  it('gives up rather than polling GGG forever', async () => {
    let clock = 0;
    const verify = vi.fn(async () => {
      throw new Error('never');
    });

    const result = await awaitVerifiedSession({
      readCookie: async () => 'anon',
      verify,
      // The window is never closed; only the timeout can end this.
      isOpen: () => true,
      wait: async (ms) => {
        clock += ms;
      },
      now: () => clock,
      pollMs: 1000,
      recheckMs: 1000,
      timeoutMs: 10_000,
    });

    expect(result).toBeNull();
    expect(clock).toBeGreaterThanOrEqual(10_000);
  });

  it('keeps waiting when the cookie cannot be read at all', async () => {
    // A window that has not finished loading has no cookie jar to speak of. That is a reason to
    // wait, not to report a cancelled login.
    let tick = 0;
    const result = await awaitVerifiedSession({
      readCookie: async () => {
        if (tick < 2) throw new Error('no session yet');
        return 'real';
      },
      verify: async () => 'Exile#1234',
      isOpen: () => tick < 4,
      wait: async () => {
        tick += 1;
      },
      now: () => 0,
    });

    expect(result?.accountName).toBe('Exile#1234');
  });

  it('treats an empty cookie value as no cookie', async () => {
    const subject = probe(['', '', ''], { '': 'should never happen' });
    expect(await awaitVerifiedSession(subject.options)).toBeNull();
    expect(subject.asked).toEqual([]);
  });
});
