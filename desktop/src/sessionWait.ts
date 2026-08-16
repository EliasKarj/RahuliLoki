/**
 * Waiting for a login that has actually happened.
 *
 * ## The bug this replaces
 *
 * The login window used to resolve the moment a POESESSID cookie existed at all. That is not the
 * same thing as being logged in: pathofexile.com sets a POESESSID for anonymous visitors, before
 * anyone has typed a character. So the poll fired about half a second after the login page
 * loaded, took the anonymous cookie, closed the window and reported "Signed in."
 *
 * Everything downstream then looked correct and was not. The panel said a session was stored,
 * the value was a syntactically fine cookie, and GGG answered 403 to every stash request — with
 * a message that blamed an expired session and sent the user through login after login, each of
 * which "succeeded" the same wrong way.
 *
 * ## The rule
 *
 * A cookie is not a session until GGG says whose it is. `verify` asks — `/api/profile` needs the
 * session and nothing else — and only a cookie that comes back with an account name is accepted.
 * The window stays open until then, which is also what makes the flow feel right: it closes when
 * the login is done, not when a cookie appeared.
 *
 * ## Why this file imports nothing
 *
 * It is the part worth testing and Electron cannot be loaded in a test process. Everything here
 * is driven through injected callbacks; `login.ts` supplies the ones backed by a real window.
 */

export interface VerifiedSession {
  poesessid: string;
  /** Exactly as GGG spells it. Removes the need for anyone to type it correctly. */
  accountName: string;
}

export interface SessionWaitOptions {
  /** The POESESSID currently in the login window, or null when there is none. */
  readCookie: () => Promise<string | null>;
  /** Ask GGG who this session is. Resolves to the account name; rejects when GGG refuses. */
  verify: (poesessid: string) => Promise<string>;
  /** False once the user has closed the login window. */
  isOpen: () => boolean;
  wait: (ms: number) => Promise<void>;
  now: () => number;
  /** How often to look at the cookie. */
  pollMs?: number;
  /**
   * How long before an unchanged cookie is checked with GGG again.
   *
   * A changed value is the usual signal that a login completed, but it cannot be the only one:
   * nothing says GGG must issue a new cookie rather than elevate the one it already set. Without
   * a periodic recheck that case would hang forever on a session that had started working.
   */
  recheckMs?: number;
  /** Gives up rather than polling GGG for the rest of the process's life. */
  timeoutMs?: number;
}

/**
 * Poll until a cookie verifies, the window closes, or the wait times out.
 *
 * Returns null for every ending that is not a verified session — the caller cannot store
 * something this did not confirm, which is the whole point.
 */
export async function awaitVerifiedSession(
  options: SessionWaitOptions,
): Promise<VerifiedSession | null> {
  const pollMs = options.pollMs ?? 1000;
  const recheckMs = options.recheckMs ?? 4000;
  const timeoutMs = options.timeoutMs ?? 10 * 60_000;
  const startedAt = options.now();

  /** The last value handed to GGG, and when, so an unchanged cookie is not asked about twice a second. */
  let lastTried: string | null = null;
  let lastTriedAt = 0;

  const attempt = async (): Promise<VerifiedSession | null> => {
    const poesessid = await options.readCookie().catch(() => null);
    if (poesessid === null || poesessid === '') return null;

    const unchanged = poesessid === lastTried;
    if (unchanged && options.now() - lastTriedAt < recheckMs) return null;

    lastTried = poesessid;
    lastTriedAt = options.now();

    try {
      const accountName = await options.verify(poesessid);
      return { poesessid, accountName };
    } catch {
      // Expected, repeatedly: this is what the anonymous cookie does until a login happens.
      return null;
    }
  };

  while (options.isOpen() && options.now() - startedAt < timeoutMs) {
    const verified = await attempt();
    if (verified !== null) return verified;
    await options.wait(pollMs);
  }

  // One last look. The user may have closed the window in the same breath as finishing the
  // login, and the cookie that arrived a moment before that is a perfectly good session.
  return attempt();
}
