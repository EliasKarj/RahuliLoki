/**
 * The only path from the dashboard to the desktop process.
 *
 * Four verbs, no generality. There is no "invoke any channel" escape hatch and no Node surface
 * exposed, so the worst a compromised renderer can do through this bridge is read non-secret
 * settings, write non-secret settings, and open or clear the login window — all things the
 * person sitting in front of it could do anyway.
 *
 * The credential deliberately has no getter. It goes from the login window to the settings file
 * to the server's environment without ever entering a renderer.
 *
 * CommonJS on purpose: Electron loads preload scripts as CJS.
 */

import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('whatRemains', {
  /** Settings minus the credential, plus `hasSession` and what is still missing. */
  readSettings: () => ipcRenderer.invoke('settings:read'),

  /** Persist settings and restart the server. POESESSID is ignored if present. */
  writeSettings: (patch: Record<string, unknown>) => ipcRenderer.invoke('settings:write', patch),

  /** Open GGG's real login page and capture the session from it. */
  logIn: () => ipcRenderer.invoke('session:login'),

  /** Forget the stored session and the login window's cookies. */
  logOut: () => ipcRenderer.invoke('session:forget'),

  /** Lets the dashboard know it is inside the app rather than a browser tab. */
  isDesktop: true,
});
