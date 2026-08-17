/**
 * Getting POESESSID without asking anyone to open devtools.
 *
 * This is the reason the desktop build exists. The web setup asks a person to log in, press F12,
 * find the cookie jar, and copy a value they have been told is as sensitive as their password.
 * That instruction is three steps of friction and one step of teaching a bad habit — anyone who
 * learns to fish POESESSID out of devtools on request is one convincing website away from
 * handing it to somebody else.
 *
 * Here the credential never passes through the user's hands. They log in to the real
 * pathofexile.com, in a real window, against GGG's real form — the same thing they would do in
 * a browser, including any two-factor step — and the cookie is read out of the session
 * afterwards by the process that needs it.
 *
 * The window is deliberately hostile territory, so it is treated as such:
 *   - its own session partition, so its cookies never touch anything else the app does;
 *   - no node integration, context isolation on, no preload — the page gets no bridge at all;
 *   - navigation confined to pathofexile.com, so a redirect cannot take the login flow
 *     somewhere else and keep the window's trust;
 *   - new windows and downloads refused outright.
 *
 * What counts as "logged in" is decided in sessionWait.ts, and it is not "a cookie exists" —
 * see the bug described there. The window stays open until GGG confirms whose session it is.
 */

import { BrowserWindow, session, type Session } from 'electron';
import { fetchProfile } from '@whatremains/server/dist/services/profileService.js';
import { awaitVerifiedSession } from './sessionWait.js';
import { allowedHost } from './loginHosts.js';

const LOGIN_URL = 'https://www.pathofexile.com/login';
const PARTITION = 'persist:poe-login';

async function readSessionCookie(target: Session): Promise<string | null> {
  const cookies = await target.cookies.get({ name: 'POESESSID' });
  const cookie = cookies.find((candidate) => candidate.value !== '');
  return cookie?.value ?? null;
}

export interface LoginResult {
  poesessid: string | null;
  /** The account GGG says the session belongs to. Null whenever `poesessid` is. */
  accountName: string | null;
  /** True when the window closed without a session GGG would accept. */
  cancelled: boolean;
}

/**
 * Open the login window and resolve once GGG confirms a session, or the window is closed.
 *
 * The cookie is polled rather than watched for a particular navigation: GGG's login can end on
 * any of several pages depending on two-factor settings and where the flow started, so no single
 * navigation marks the end of it. What does mark the end is GGG answering `/api/profile` with an
 * account name — see sessionWait.ts for why the mere presence of a cookie is not enough.
 */
export async function loginForSession(
  parent?: BrowserWindow,
  userAgent = 'what-remains (desktop)',
): Promise<LoginResult> {
  const loginSession = session.fromPartition(PARTITION);

  const window = new BrowserWindow({
    width: 520,
    height: 760,
    title: 'Log in to Path of Exile',
    ...(parent ? { parent, modal: true } : {}),
    autoHideMenuBar: true,
    webPreferences: {
      partition: PARTITION,
      // The page is remote and untrusted. It gets no Node, no preload, no shared session.
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webviewTag: false,
    },
  });

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  // Both events, not just the first. `will-navigate` covers what the page initiates; a server
  // sending a 302 only raises `will-redirect`, so guarding one and not the other means the
  // allowlist has a hole and the flow has a step it cannot explain.
  //
  // A refusal is logged. The silent version of this left a login window sitting on a page whose
  // buttons did nothing, with no hint anywhere that the app was the one saying no.
  const guard = (event: { preventDefault: () => void }, url: string): void => {
    if (allowedHost(url)) return;
    event.preventDefault();
    console.error(`login window refused to navigate to ${new URL(url).origin}`);
  };
  window.webContents.on('will-navigate', guard);
  window.webContents.on('will-redirect', guard);

  loginSession.on('will-download', (event) => event.preventDefault());

  let open = true;
  window.on('closed', () => {
    open = false;
  });

  // Loaded before the wait begins, not after: awaiting first would poll a window showing nothing.
  void window.loadURL(LOGIN_URL);

  try {
    const verified = await awaitVerifiedSession({
      readCookie: () => readSessionCookie(loginSession),
      // The check runs against the exact value that will be stored, out of the main process
      // rather than out of the window — the same request the server will make, so a session
      // that passes here cannot fail there for a reason this never saw.
      verify: async (poesessid) => (await fetchProfile({ poesessid, userAgent })).name,
      isOpen: () => open,
      wait: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
      now: Date.now,
    });

    if (verified === null) return { poesessid: null, accountName: null, cancelled: true };
    return { ...verified, cancelled: false };
  } finally {
    if (!window.isDestroyed()) window.destroy();
  }
}

/**
 * Forget the login window's cookies.
 *
 * Used when signing out. Clearing the partition is what makes the next login prompt for
 * credentials again instead of silently reusing the session that is being discarded.
 */
export async function clearLoginSession(): Promise<void> {
  await session.fromPartition(PARTITION).clearStorageData({ storages: ['cookies'] });
}
