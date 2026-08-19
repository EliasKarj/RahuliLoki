/**
 * "There is a newer version" — the dashboard half.
 *
 * The server does the asking (services/updateService.ts) and hands the answer to the page
 * through /api/health. All that is left here is the decision nobody thinks about until it goes
 * wrong: when to say it, and when to shut up about it.
 *
 * Shutting up matters more. An update notice is worth exactly one reading; after that it is a
 * bar of chrome permanently occupying the top of a page someone opens to look at numbers. So it
 * can be dismissed, the dismissal is remembered — and it is remembered *per version*, so
 * dismissing 1.1.0 says nothing about 1.2.0. A dismissal that outlived its release would be a
 * check that silently stopped working, which is the one failure this feature cannot notice
 * about itself.
 */

export interface UpdateInfo {
  current: string;
  latest: string | null;
  available: boolean;
  url: string | null;
  checkedAt: string | null;
}

/** Where the dismissal lives. Versioned key so an old value cannot mean something new. */
export const DISMISS_KEY = 'what-remains:update-dismissed';

/**
 * Show the notice?
 *
 * Requires somewhere to send the person as well as something to tell them: a notice about an
 * update with no link is an instruction to go and search for it.
 */
export function shouldShowUpdate(update: UpdateInfo | null | undefined, dismissed: string | null): boolean {
  if (!update || !update.available) return false;
  if (update.latest === null || update.url === null) return false;
  return dismissed !== update.latest;
}

/** Reading and writing the dismissal, tolerating a browser that refuses storage entirely. */
export function readDismissed(storage: Storage | null = safeStorage()): string | null {
  try {
    return storage?.getItem(DISMISS_KEY) ?? null;
  } catch {
    return null;
  }
}

export function writeDismissed(version: string, storage: Storage | null = safeStorage()): void {
  try {
    storage?.setItem(DISMISS_KEY, version);
  } catch {
    // Private browsing, a full quota, a locked-down profile. The notice comes back next load,
    // which is a worse experience than intended and a better one than a crash.
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** `v1.1.0` and `1.1.0` are the same release; only one of them is worth printing. */
export function displayVersion(version: string): string {
  return version.replace(/^v/, '');
}
