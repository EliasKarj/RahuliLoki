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
 */

import { BrowserWindow, session, type Session } from 'electron';

const LOGIN_URL = 'https://www.pathofexile.com/login';
const PARTITION = 'persist:poe-login';

/** Hosts the login flow is allowed to visit. GGG uses a few subdomains for the login itself. */
function allowedHost(url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url);
    if (protocol !== 'https:') return false;
    return hostname === 'pathofexile.com' || hostname.endsWith('.pathofexile.com');
  } catch {
    return false;
  }
}

async function readSessionCookie(target: Session): Promise<string | null> {
  const cookies = await target.cookies.get({ name: 'POESESSID' });
  const cookie = cookies.find((candidate) => candidate.value !== '');
  return cookie?.value ?? null;
}

export interface LoginResult {
  poesessid: string | null;
  /** True when the user closed the window rather than completing a login. */
  cancelled: boolean;
}

/**
 * Open the login window and resolve once a POESESSID exists, or the window is closed.
 *
 * The cookie is polled rather than watched for a particular navigation: GGG's login can end on
 * any of several pages depending on two-factor settings and where the flow started, and
 * "the cookie is now set" is the condition that actually matters regardless of the route taken.
 */
export function loginForSession(parent?: BrowserWindow): Promise<LoginResult> {
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
  window.webContents.on('will-navigate', (event, url) => {
    if (!allowedHost(url)) event.preventDefault();
  });
  loginSession.on('will-download', (event) => event.preventDefault());

  return new Promise<LoginResult>((resolve) => {
    let settled = false;
    const finish = (result: LoginResult): void => {
      if (settled) return;
      settled = true;
      clearInterval(timer);
      if (!window.isDestroyed()) window.destroy();
      resolve(result);
    };

    const timer = setInterval(() => {
      void readSessionCookie(loginSession).then((value) => {
        if (value !== null) finish({ poesessid: value, cancelled: false });
      });
    }, 500);

    window.on('closed', () => {
      // A closed window is not necessarily a cancellation: the cookie may have landed in the
      // same tick the user closed it. Check once more before giving up.
      void readSessionCookie(loginSession).then((value) => {
        finish({ poesessid: value, cancelled: value === null });
      });
    });

    void window.loadURL(LOGIN_URL);
  });
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
