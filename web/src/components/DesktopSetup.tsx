/**
 * Account and settings, for the desktop build only.
 *
 * The web build asks people to open devtools and copy a session cookie. This asks them to log
 * in — that is the entire reason the desktop shell exists.
 *
 * Which is also why it used to be a full-width panel above the dashboard: it is the first thing
 * that matters on the first launch. It is the *last* thing that matters on every launch after
 * that, and a permanent box saying "signed in as Exile#1234" was pushing the numbers people
 * opened the app for below the fold. So it lives in the corner now: a small button that says
 * who is signed in, and everything else behind it.
 *
 * It still opens itself when something is missing. Hiding the setup screen from someone who has
 * not set anything up would be a worse trade than the space it costs.
 *
 * Renders nothing in a browser — `bridge()` is null there — so the same bundle serves both.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type League } from '../lib/api.ts';
import { bridge, type DesktopSettings } from '../lib/desktop.ts';
import {
  INTERVAL_CHOICES,
  cronForMinutes,
  intervalWarning,
  minutesFromCron,
} from '../lib/schedule.ts';

/** The value that turns the dropdown back into a text box, for private leagues. */
const OTHER = '\u0000other';

/** Temporary leagues first, then the permanent ones. Nobody sets up a tracker for Standard. */
function ordered(leagues: League[]): League[] {
  return [...leagues].sort((a, b) => {
    const temporary = Number(b.endAt !== null) - Number(a.endAt !== null);
    return temporary !== 0 ? temporary : a.id.localeCompare(b.id);
  });
}

export function DesktopSetup({ onChanged }: { onChanged: () => void }) {
  const desktop = bridge();
  const [settings, setSettings] = useState<DesktopSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  /**
   * Whether the operator has opened or closed it themselves. Null means they have not touched
   * it, and the answer comes from whether anything still needs setting up — so the panel is
   * open on a first launch and closed on every one after, without an effect racing the load.
   */
  const [manualOpen, setManualOpen] = useState<boolean | null>(null);
  const [leagues, setLeagues] = useState<League[] | null>(null);
  const [leagueSource, setLeagueSource] = useState<'ggg' | 'fallback' | null>(null);
  /** Set when the operator picked "Other", so the free-text box stays open while they type. */
  const [custom, setCustom] = useState(false);
  /** How many tabs the last poll read. Null until one has, which is the honest "I don't know". */
  const [tabCount, setTabCount] = useState<number | null>(null);
  const root = useRef<HTMLDivElement>(null);

  const configured = settings !== null && settings.missing.length === 0;
  const open = desktop !== null && settings !== null && (manualOpen ?? !configured);

  const refresh = useCallback(async () => {
    if (desktop === null) return;
    setSettings(await desktop.readSettings());
  }, [desktop]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (desktop === null) return;
    const controller = new AbortController();
    api
      .leagueList(controller.signal)
      .then((response) => {
        if (controller.signal.aborted) return;
        setLeagues(response.leagues);
        setLeagueSource(response.source);
      })
      // A failed request is not worth an error banner here: the server already falls back to
      // the permanent leagues, so this only fires if the server itself is unreachable — in
      // which case the dashboard behind this panel is saying so much more loudly.
      .catch(() => undefined);

    // The cost of an interval is one request per tab, so the warning under the picker needs to
    // know how many there are. The last snapshot counted them; before there is one, the picker
    // simply says less rather than guessing.
    api
      .latest(undefined, controller.signal)
      .then((response) => {
        if (!controller.signal.aborted) setTabCount(Object.keys(response.tabs).length);
      })
      .catch(() => undefined);

    return () => controller.abort();
  }, [desktop]);

  // A menu floating over the dashboard has to close the way every other menu does: a click
  // somewhere else, or Escape. Without it, the panel covers the numbers until you find the
  // button again — which is the problem moving it into the corner was meant to solve.
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent): void => {
      if (root.current !== null && !root.current.contains(event.target as Node)) {
        setManualOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setManualOpen(false);
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (desktop === null || settings === null) return null;

  /**
   * Run one action, then report what happened.
   *
   * An action that returns a string reports that instead of `note`, so a result only known once
   * the call has been made — the account name GGG answered with — can be said out loud.
   */
  const run = async (action: () => Promise<unknown>, note: string): Promise<void> => {
    setBusy(true);
    setMessage(null);
    // Acting inside the panel counts as opening it. Otherwise the first launch would slam it
    // shut at the worst moment: signing in is what fills the last missing setting, so the panel
    // would vanish along with whatever it was about to say about the attempt.
    setManualOpen(true);
    try {
      const result = await action();
      await refresh();
      onChanged();
      setMessage(typeof result === 'string' && result !== '' ? result : note);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const field =
    'w-full rounded border border-ink-700 bg-ink-900 px-2 py-1.5 text-sm text-ink-100 outline-none focus:border-accent-600';

  return (
    <div className="relative" ref={root}>
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setManualOpen(!open)}
        title={configured ? `${settings.accountName} · ${settings.league}` : 'Finish setting up'}
        className={
          configured
            ? 'flex items-center gap-2 rounded border border-ink-800 px-2 py-1 text-xs text-ink-300 transition-colors hover:border-ink-600 hover:text-ink-100'
            : 'flex items-center gap-2 rounded border border-accent-600/60 bg-accent-600/10 px-2 py-1 text-xs text-accent-400 transition-colors hover:bg-accent-600/20'
        }
      >
        {/* Signed in or not, in the smallest thing that can say it. The label alone cannot: an
            account name is stored long after the session behind it has expired. */}
        <span
          aria-hidden
          className={`h-1.5 w-1.5 rounded-full ${settings.hasSession ? 'bg-accent-500' : 'bg-ink-600'}`}
        />
        {configured ? settings.accountName || 'Account' : 'Set up'}
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Account and settings"
          className="absolute right-0 top-full z-30 mt-2 w-[22rem] space-y-4 rounded border border-ink-700 bg-ink-950 p-4 text-left shadow-2xl shadow-black/60"
        >
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-sm font-medium text-ink-100">
              {configured ? 'Account' : 'Set up valuuttaloki'}
            </h2>
            <button
              type="button"
              onClick={() => setManualOpen(false)}
              className="text-xs text-ink-400 transition-colors hover:text-ink-200"
            >
              Close
            </button>
          </div>

          {/* Who and which league first, the session below the hairline. The panel is titled
              "Account", and the account is what these two fields say; signing in is the action
              that backs them up rather than the thing being looked at. */}
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              const chosen = String(form.get('league') ?? '').trim();
              if (chosen === OTHER) {
                // They opened the dropdown, chose Other and submitted without typing.
                setCustom(true);
                setMessage('Type the league name, then save.');
                return;
              }
              void run(
                () =>
                  desktop.writeSettings({
                    accountName: String(form.get('accountName') ?? '').trim(),
                    league: chosen || 'Standard',
                  }),
                'Saved.',
              ).then(() => setCustom(false));
            }}
          >
            <label className="flex flex-col gap-1 text-xs text-ink-400">
              Account name
              <input
                name="accountName"
                defaultValue={settings.accountName}
                placeholder="Exile#1234"
                className={field}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-ink-400">
              League
              {leagues === null || custom ? (
                // Before the list arrives, and for private leagues GGG does not publish.
                <input
                  name="league"
                  defaultValue={settings.league}
                  autoFocus={custom}
                  placeholder="League name"
                  className={field}
                />
              ) : (
                <select
                  name="league"
                  defaultValue={settings.league}
                  onChange={(event) => {
                    if (event.target.value === OTHER) setCustom(true);
                  }}
                  className={field}
                >
                  {/* The configured league is always an option, even if GGG no longer lists
                      it — a finished league still has history worth reading. */}
                  {leagues.some((entry) => entry.id === settings.league) ? null : (
                    <option value={settings.league}>{settings.league}</option>
                  )}
                  {ordered(leagues).map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.id}
                      {entry.endAt === null ? '' : ' (temporary)'}
                    </option>
                  ))}
                  <option value={OTHER}>Other…</option>
                </select>
              )}
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                type="submit"
                disabled={busy}
                className="rounded border border-ink-700 px-3 py-1.5 text-sm text-ink-200 transition-colors hover:border-ink-600 disabled:opacity-50"
              >
                Save
              </button>
              {/* Typing the account name is a pure liability when the session already knows it.
                  This asks GGG and fills it in — and because the question needs no account name,
                  a failure here proves the session is the problem rather than the spelling. */}
              <button
                type="button"
                disabled={busy || !settings.hasSession}
                title={settings.hasSession ? undefined : 'Sign in first'}
                onClick={() =>
                  void run(async () => {
                    const account = await api.account();
                    if (account.matches) return `GGG confirms this session is ${account.name}.`;
                    await desktop.writeSettings({ accountName: account.name });
                    return `GGG says this session is ${account.name}. Saved.`;
                  }, 'Checked.')
                }
                className="rounded border border-ink-700 px-3 py-1.5 text-sm text-ink-200 transition-colors hover:border-ink-600 disabled:opacity-50"
              >
                Ask GGG
              </button>
            </div>
          </form>
          <p className="text-xs text-ink-500">
            The account name must match GGG exactly, including the #number. <b>Ask GGG</b> fills
            it in from the signed-in session, and tells you if the session itself is the problem.
            {leagueSource === 'fallback'
              ? ' League list unavailable — showing the permanent leagues; pick Other… for anything else.'
              : ''}
          </p>

          <div className="border-t border-ink-800 pt-4">
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
            </div>
            <p className="mt-2 text-xs text-ink-500">
              {settings.hasSession ? 'A session is stored. ' : 'No session yet. '}
              Opens GGG&rsquo;s real login page in its own window; your session never passes
              through this dashboard and is never shown on screen.
            </p>
          </div>

          {/* Third group: what the collector does, once there is an account for it to do it to. */}
          <div className="border-t border-ink-800 pt-4">
            <label className="flex flex-wrap items-center gap-2 text-xs text-ink-300">
              Read the stash every
              <select
                value={minutesFromCron(settings.pollCron) ?? ''}
                disabled={busy}
                onChange={(event) =>
                  void run(
                    () => desktop.writeSettings({ pollCron: cronForMinutes(Number(event.target.value)) }),
                    'Saved. The next poll follows the new interval.',
                  )
                }
                className="rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100"
              >
                {/* A hand-written POLL_CRON is shown as itself rather than rounded to the
                    nearest menu entry — and picking a menu entry then replaces it. */}
                {minutesFromCron(settings.pollCron) === null ? (
                  <option value="">{settings.pollCron}</option>
                ) : null}
                {INTERVAL_CHOICES.map((minutes) => (
                  <option key={minutes} value={minutes}>
                    {minutes < 60 ? `${minutes} minutes` : 'hour'}
                  </option>
                ))}
              </select>
            </label>
            {(() => {
              const minutes = minutesFromCron(settings.pollCron);
              const warning = minutes === null ? null : intervalWarning(minutes, tabCount);
              return warning === null ? null : (
                <p className="mt-1 text-xs text-accent-400">{warning}</p>
              );
            })()}
          </div>

          <div className="space-y-2 text-xs text-ink-300">
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
      ) : null}
    </div>
  );
}
