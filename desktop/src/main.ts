/**
 * The desktop shell.
 *
 * It runs the same Fastify server the self-hosted build runs, in this process, on a port the
 * operating system picks, and points a window at it. Nothing about the application logic is
 * duplicated here — this file is the parts a browser tab cannot do: a real login window, a tray
 * icon, launch at login, and a database in the right per-user directory.
 *
 * The unattended-polling property is kept on purpose. Closing the window hides it to the tray
 * and the poller keeps running, because a wealth tracker that only records while you are looking
 * at it records the least interesting half of the day. Quitting is an explicit act from the
 * tray menu.
 */

import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, shell, Tray } from 'electron';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

import { migrate } from '@valuuttaloki/server/dist/lib/migrate.js';
import { startServer, type RunningServer } from '@valuuttaloki/server/dist/server.js';

import { loadSettings, missingFrom, saveSettings, toEnv, type Settings } from './settings.js';
import { clearLoginSession, loginForSession } from './login.js';

const here = dirname(fileURLToPath(import.meta.url));

let server: RunningServer | null = null;
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;

const userData = app.getPath('userData');
const databaseFile = join(userData, 'valuuttaloki.db');
// Migrations ship as SQL next to the server build; see server/src/lib/migrate.ts for why the
// Prisma CLI is not involved.
const migrationsDir = join(here, '..', '..', 'server', 'prisma', 'migrations');

/** Only one instance may own the database and the poller. A second launch focuses the first. */
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

app.on('second-instance', () => {
  showWindow();
});

async function restartServer(settings: Settings): Promise<void> {
  await server?.close();
  server = null;
  // Port 0: let the OS choose. A fixed port would collide with a self-hosted instance the same
  // person may already be running, and there is no reason for the shell to care which port.
  server = await startServer({ env: toEnv(settings, databaseFile), port: 0 });
}

function showWindow(): void {
  if (mainWindow === null || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    title: 'valuuttaloki',
    backgroundColor: '#12161c',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(here, 'preload.cjs'),
      // The window loads our own dashboard over loopback, but it is still a renderer: it gets
      // no Node, and talks to this process only through the narrow bridge in preload.
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
  });

  // Anything that is not our own dashboard opens in the real browser instead of inside the app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (server !== null && !url.startsWith(server.url)) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });

  mainWindow.on('close', (event) => {
    // Hide rather than quit, so the poller survives closing the window — which is the whole
    // reason to have a background process at all.
    const settings = loadSettings(userData);
    if (!quitting && settings.pollInBackground) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  if (server !== null) void mainWindow.loadURL(server.url);
}

function buildTray(): void {
  // A 1x1 transparent image is a deliberate placeholder: shipping a wrong-looking icon is worse
  // than shipping none, and the real asset belongs in a design pass, not in this file.
  const icon = nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  );
  tray = new Tray(icon);
  tray.setToolTip('valuuttaloki');
  refreshTray();
  tray.on('click', showWindow);
}

function refreshTray(): void {
  if (tray === null) return;
  const health = server?.poller.health;
  const status =
    server === null
      ? 'not running'
      : (server.missing.length > 0
        ? 'not configured'
        : health?.halted === true
          ? 'halted'
          : health?.lastSuccessAt === null
            ? 'waiting for the first snapshot'
            : `last snapshot ${new Date(health?.lastSuccessAt ?? '').toLocaleTimeString()}`);

  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: `valuuttaloki — ${status}`, enabled: false },
      { type: 'separator' },
      { label: 'Open', click: showWindow },
      {
        label: 'Poll now',
        enabled: server !== null && server.missing.length === 0,
        click: () => {
          void server?.poller.runNow().catch(() => undefined).then(refreshTray);
        },
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
}

// ── the bridge the setup screen uses ────────────────────────────────────────────
// Every channel here is a verb the renderer is allowed to ask for. There is no generic
// "read a file" or "run this" — a compromised renderer can do exactly these four things.

ipcMain.handle('settings:read', () => {
  const settings = loadSettings(userData);
  // The renderer never needs the credential, only whether one exists.
  const { poesessid, ...rest } = settings;
  return { ...rest, hasSession: poesessid !== '', missing: missingFrom(settings) };
});

ipcMain.handle('settings:write', async (_event, patch: Partial<Settings>) => {
  const settings = { ...loadSettings(userData), ...patch };
  // The credential is not settable through this channel; it only ever arrives from the login
  // window, so a renderer bug cannot plant one.
  settings.poesessid = loadSettings(userData).poesessid;
  saveSettings(userData, settings);
  await restartServer(settings);
  refreshTray();
  return { ok: true };
});

ipcMain.handle('session:login', async () => {
  const result = await loginForSession(mainWindow ?? undefined);
  if (result.poesessid === null) return { ok: false, cancelled: result.cancelled };

  const settings = { ...loadSettings(userData), poesessid: result.poesessid };
  saveSettings(userData, settings);
  await restartServer(settings);
  refreshTray();
  return { ok: true, cancelled: false };
});

ipcMain.handle('session:forget', async () => {
  await clearLoginSession();
  const settings = { ...loadSettings(userData), poesessid: '' };
  saveSettings(userData, settings);
  await restartServer(settings);
  refreshTray();
  return { ok: true };
});

// ── boot ────────────────────────────────────────────────────────────────────────

async function boot(): Promise<void> {
  const settings = loadSettings(userData);
  app.setLoginItemSettings({ openAtLogin: settings.launchAtLogin });

  try {
    const result = migrate(databaseFile, migrationsDir);
    if (result.applied.length > 0) {
      console.error(`applied ${result.applied.length} migration(s)`);
    }
  } catch (error) {
    dialog.showErrorBox(
      'valuuttaloki could not prepare its database',
      `${(error as Error).message}\n\nDatabase: ${databaseFile}`,
    );
    app.quit();
    return;
  }

  try {
    await restartServer(settings);
  } catch (error) {
    dialog.showErrorBox('valuuttaloki could not start', (error as Error).message);
    app.quit();
    return;
  }

  buildTray();
  createWindow();
  // Cheap, and it keeps the tray honest about a poller that halted hours ago.
  setInterval(refreshTray, 30_000);

  await maybeSmokeTest();
}

/**
 * A test seam, not a feature.
 *
 * `VALUUTTALOKI_SMOKE=<path>` waits for the dashboard to finish loading, writes a screenshot
 * there, and exits with a status that says whether the renderer logged any errors. It exists
 * because "the server returned 200" and "the window actually rendered" are different claims,
 * and only one of them can be read off a log.
 */
async function maybeSmokeTest(): Promise<void> {
  const target = process.env.VALUUTTALOKI_SMOKE;
  if (target === undefined || target === '' || mainWindow === null) return;

  const errors: string[] = [];
  mainWindow.webContents.on('console-message', (_event, level, message) => {
    // 3 is Electron's error level.
    if (level >= 3) errors.push(message);
  });

  await new Promise<void>((resolve) => {
    if (mainWindow === null) return resolve();
    mainWindow.webContents.once('did-finish-load', () => resolve());
    if (!mainWindow.webContents.isLoading()) resolve();
  });
  // The dashboard fetches after load; give it a moment to paint the result.
  await new Promise((resolve) => setTimeout(resolve, 2500));

  const image = await mainWindow.webContents.capturePage();
  const { writeFileSync } = await import('node:fs');
  writeFileSync(target, image.toPNG());

  console.error(`smoke: wrote ${target}; renderer errors: ${errors.length}`);
  for (const error of errors) console.error(`smoke: renderer error: ${error}`);

  quitting = true;
  app.exit(errors.length === 0 ? 0 : 1);
}

void app.whenReady().then(boot);

app.on('window-all-closed', () => {
  // Deliberately not quitting: the tray is the app now, and the poller is still working.
});

app.on('before-quit', () => {
  quitting = true;
});

app.on('will-quit', (event) => {
  if (server === null) return;
  event.preventDefault();
  const closing = server;
  server = null;
  void closing.close().finally(() => app.quit());
});
