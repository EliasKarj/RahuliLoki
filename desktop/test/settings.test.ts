/**
 * Settings, and the environment they become.
 *
 * The failure this guards against is quiet in both directions: a setting whose default flips
 * when a field is missing from an older settings.json, and a setting the server never hears
 * about because nothing maps it into the environment. Neither shows up as an error — the app
 * simply does something other than what the checkbox says.
 */

import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULTS, loadSettings, saveSettings, toEnv } from '../src/settings.ts';

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'what-remains-settings-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('the update check setting', () => {
  it('is on by default', () => {
    expect(DEFAULTS.updateCheck).toBe(true);
  });

  it('stays on for a settings file written before the setting existed', () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ league: 'Settlers' }));

    expect(loadSettings(dir).updateCheck).toBe(true);
  });

  it('round-trips when switched off', () => {
    const dir = tempDir();
    saveSettings(dir, { ...DEFAULTS, updateCheck: false });

    expect(loadSettings(dir).updateCheck).toBe(false);
  });

  it('reaches the server as UPDATE_CHECK', () => {
    expect(toEnv({ ...DEFAULTS, updateCheck: true }, '/tmp/x.db').UPDATE_CHECK).toBe('on');
    expect(toEnv({ ...DEFAULTS, updateCheck: false }, '/tmp/x.db').UPDATE_CHECK).toBe('off');
  });
});

describe('toEnv', () => {
  it('pins the server to loopback with no token, which is the one safe tokenless bind', () => {
    const env = toEnv({ ...DEFAULTS, accountName: 'Exile#1234' }, '/tmp/x.db');

    expect(env.HOST).toBe('127.0.0.1');
    expect(env.AUTH_TOKEN).toBe('');
    expect(env.ALLOW_UNAUTHENTICATED).toBe('');
  });
});

describe('the settings file', () => {
  it('is written for its owner only', () => {
    const dir = tempDir();
    saveSettings(dir, { ...DEFAULTS, poesessid: 'a'.repeat(32) });

    // The credential is in this file; the permissions are the whole of its protection.
    const { mode } = statSync(join(dir, 'settings.json'));
    expect(mode & 0o777).toBe(0o600);
    expect(readFileSync(join(dir, 'settings.json'), 'utf8')).toContain('aaaa');
  });
});
