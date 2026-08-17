/**
 * Desktop settings, stored where the operating system says application data goes.
 *
 * The server reads its configuration from the environment, and that stays true here — this
 * module's job is to turn a settings file into that environment. Keeping one configuration
 * path means the desktop build cannot drift from the server build in what it supports.
 *
 * POESESSID lives in this file. It is written with 0600 and the file sits in the per-user
 * application data directory, which is the same protection the .env gets. It is deliberately
 * not in the system keychain: that would be better, but it would also mean three
 * platform-specific implementations and a native dependency, and the honest comparison is
 * against a .env in the user's home directory rather than against perfection.
 */

import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface Settings {
  poesessid: string;
  accountName: string;
  league: string;
  pollCron: string;
  minItemChaos: number;
  trackedTabs: string[];
  /** Keep polling when the window is closed to the tray. Off means the app is a viewer. */
  pollInBackground: boolean;
  /** Start with the operating system. */
  launchAtLogin: boolean;
}

export const DEFAULTS: Settings = {
  poesessid: '',
  accountName: '',
  league: 'Standard',
  pollCron: '*/10 * * * *',
  minItemChaos: 2,
  trackedTabs: [],
  pollInBackground: true,
  launchAtLogin: false,
};

function settingsFile(userDataDir: string): string {
  return join(userDataDir, 'settings.json');
}

export function loadSettings(userDataDir: string): Settings {
  try {
    const raw = JSON.parse(readFileSync(settingsFile(userDataDir), 'utf8')) as Partial<Settings>;
    return {
      ...DEFAULTS,
      ...raw,
      // A hand-edited file should not be able to make the rest of the app deal with the wrong
      // type; every field is narrowed back to what it must be.
      poesessid: typeof raw.poesessid === 'string' ? raw.poesessid : '',
      accountName: typeof raw.accountName === 'string' ? raw.accountName : '',
      league: typeof raw.league === 'string' && raw.league !== '' ? raw.league : DEFAULTS.league,
      pollCron: typeof raw.pollCron === 'string' && raw.pollCron !== '' ? raw.pollCron : DEFAULTS.pollCron,
      minItemChaos: typeof raw.minItemChaos === 'number' ? raw.minItemChaos : DEFAULTS.minItemChaos,
      trackedTabs: Array.isArray(raw.trackedTabs)
        ? raw.trackedTabs.filter((tab): tab is string => typeof tab === 'string')
        : [],
      pollInBackground: raw.pollInBackground !== false,
      launchAtLogin: raw.launchAtLogin === true,
    };
  } catch {
    // Missing or unparseable. Defaults get the user to the setup screen, which is the right
    // place to be when there is no usable configuration.
    return { ...DEFAULTS };
  }
}

export function saveSettings(userDataDir: string, settings: Settings): void {
  const file = settingsFile(userDataDir);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
  // writeFileSync's mode only applies when creating the file; an existing one keeps its mode.
  chmodSync(file, 0o600);
}

/**
 * Turn settings into the environment the server expects.
 *
 * `HOST` is pinned to loopback and no AUTH_TOKEN is set: the server is bound to this machine
 * and reachable only by the window that started it, which is the one situation where the
 * server's own boot-time refusal agrees that a token is unnecessary.
 */
export function toEnv(settings: Settings, databaseFile: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    POESESSID: settings.poesessid,
    POE_ACCOUNT_NAME: settings.accountName,
    POE_LEAGUE: settings.league,
    POLL_CRON: settings.pollCron,
    MIN_ITEM_CHAOS: String(settings.minItemChaos),
    TRACKED_TABS: settings.trackedTabs.join(','),
    DATABASE_URL: `file:${databaseFile}`,
    HOST: '127.0.0.1',
    AUTH_TOKEN: '',
    ALLOW_UNAUTHENTICATED: '',
    LOG_LEVEL: process.env.WHAT_REMAINS_LOG_LEVEL ?? 'info',
    // Passed through so an operator can redirect it without rebuilding the app.
    ...(process.env.POE_NINJA_URL ? { POE_NINJA_URL: process.env.POE_NINJA_URL } : {}),
  };
}

/** What still has to be filled in before polling can run. Drives the setup screen. */
export function missingFrom(settings: Settings): string[] {
  const missing: string[] = [];
  if (settings.poesessid.trim() === '') missing.push('POESESSID');
  if (settings.accountName.trim() === '') missing.push('account name');
  return missing;
}
