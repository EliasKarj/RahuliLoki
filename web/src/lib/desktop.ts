/**
 * The desktop bridge, as the dashboard sees it.
 *
 * The same bundle is served to a browser and to the Electron window, so everything here is
 * optional by construction: `bridge()` returns null in a browser and the setup screen simply
 * does not render. That keeps one build, one deployment story, and no "desktop variant" of the
 * SPA to drift out of sync.
 *
 * Mirrors desktop/src/preload.cts. There is no credential getter here because there is none
 * there — POESESSID travels from the login window to the settings file to the server's
 * environment and never enters a renderer.
 */

export interface DesktopSettings {
  accountName: string;
  league: string;
  pollCron: string;
  minItemChaos: number;
  trackedTabs: string[];
  pollInBackground: boolean;
  launchAtLogin: boolean;
  /** Whether the app asks GitHub about new releases. See lib/update.ts. */
  updateCheck: boolean;
  /** Whether a session is stored. The value itself is never exposed. */
  hasSession: boolean;
  /** What still has to be filled in before polling can run. */
  missing: string[];
}

export interface DesktopBridge {
  readSettings(): Promise<DesktopSettings>;
  writeSettings(patch: Partial<Omit<DesktopSettings, 'hasSession' | 'missing'>>): Promise<{ ok: boolean }>;
  logIn(): Promise<{ ok: boolean; cancelled: boolean }>;
  logOut(): Promise<{ ok: boolean }>;
  isDesktop: true;
}

declare global {
  interface Window {
    whatRemains?: DesktopBridge;
  }
}

/** The bridge when running inside the desktop shell, null in a browser. */
export function bridge(): DesktopBridge | null {
  return typeof window !== 'undefined' && window.whatRemains?.isDesktop === true
    ? window.whatRemains
    : null;
}
