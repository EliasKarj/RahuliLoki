/**
 * Setup, for the desktop build only.
 *
 * The web build asks people to open devtools and copy a session cookie. This asks them to log
 * in. That is the entire reason the desktop shell exists, so the button that does it is the
 * first thing on the screen and the rest of the panel stays out of the way until it is done.
 *
 * Renders nothing in a browser — `bridge()` is null there — so the same bundle serves both.
 */

import { useCallback, useEffect, useState } from 'react';
import { bridge, type DesktopSettings } from '../lib/desktop.ts';

export function DesktopSetup({ onChanged }: { onChanged: () => void }) {
  const desktop = bridge();
  const [settings, setSettings] = useState<DesktopSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const refresh = useCallback(async () => {
    if (desktop === null) return;
    setSettings(await desktop.readSettings());
  }, [desktop]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (desktop === null || settings === null) return null;

  const configured = settings.missing.length === 0;
  // Once everything is set, collapse to a single line. A setup panel that never goes away is
  // just clutter on every launch afterwards.
  const showBody = expanded || !configured;

  const run = async (action: () => Promise<unknown>, note: string): Promise<void> => {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      await refresh();
      onChanged();
      setMessage(note);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded border border-ink-800 bg-ink-900/40 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium text-ink-100">
          {configured ? 'Account' : 'Set up valuuttaloki'}
        </h2>
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="text-xs text-ink-400 transition-colors hover:text-ink-200"
        >
          {showBody ? 'Hide' : 'Settings'}
        </button>
      </div>

      {!showBody ? (
        <p className="mt-1 text-xs text-ink-400">
          {settings.accountName || 'unnamed account'} · {settings.league}
          {settings.hasSession ? ' · signed in' : ''}
        </p>
      ) : (
        <div className="mt-3 space-y-4">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={busy}
                onClick={() => void run(() => desktop.logIn(), 'Signed in.')}
                className="rounded bg-accent-600 px-3 py-1.5 text-sm font-medium text-ink-950 transition-colors hover:bg-accent-500 disabled:opacity-50"
              >
                {settings.hasSession ? 'Sign in again' : 'Sign in to Path of Exile'}
              </button>
              {settings.hasSession ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void run(() => desktop.logOut(), 'Session forgotten.')}
                  className="text-xs text-ink-400 transition-colors hover:text-ink-200"
                >
                  Sign out
                </button>
              ) : null}
              <span className="text-xs text-ink-500">
                {settings.hasSession ? 'A session is stored.' : 'No session yet.'}
              </span>
            </div>
            <p className="mt-2 text-xs text-ink-500">
              Opens GGG&rsquo;s real login page in its own window. Your session never passes
              through this dashboard and is never shown on screen.
            </p>
          </div>

          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              void run(
                () =>
                  desktop.writeSettings({
                    accountName: String(form.get('accountName') ?? '').trim(),
                    league: String(form.get('league') ?? '').trim() || 'Standard',
                  }),
                'Saved.',
              );
            }}
          >
            <label className="flex flex-col gap-1 text-xs text-ink-400">
              Account name
              <input
                name="accountName"
                defaultValue={settings.accountName}
                placeholder="Exile#1234"
                className="w-48 rounded border border-ink-700 bg-ink-900 px-2 py-1.5 text-sm text-ink-100 outline-none focus:border-accent-600"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-ink-400">
              League
              <input
                name="league"
                defaultValue={settings.league}
                className="w-40 rounded border border-ink-700 bg-ink-900 px-2 py-1.5 text-sm text-ink-100 outline-none focus:border-accent-600"
              />
            </label>
            <button
              type="submit"
              disabled={busy}
              className="rounded border border-ink-700 px-3 py-1.5 text-sm text-ink-200 transition-colors hover:border-ink-600 disabled:opacity-50"
            >
              Save
            </button>
          </form>
          <p className="-mt-2 text-xs text-ink-500">
            The account name must match GGG exactly, including the #number.
          </p>

          <div className="flex flex-wrap gap-4 text-xs text-ink-300">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={settings.pollInBackground}
                disabled={busy}
                onChange={(event) =>
                  void run(
                    () => desktop.writeSettings({ pollInBackground: event.target.checked }),
                    'Saved.',
                  )
                }
              />
              Keep collecting when the window is closed
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={settings.launchAtLogin}
                disabled={busy}
                onChange={(event) =>
                  void run(
                    () => desktop.writeSettings({ launchAtLogin: event.target.checked }),
                    'Saved.',
                  )
                }
              />
              Start with my computer
            </label>
          </div>

          {settings.missing.length > 0 ? (
            <p className="text-xs text-accent-400">Still needed: {settings.missing.join(', ')}</p>
          ) : null}
          {message !== null ? <p className="text-xs text-ink-400">{message}</p> : null}
        </div>
      )}
    </section>
  );
}
