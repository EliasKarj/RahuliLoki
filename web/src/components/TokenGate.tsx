/**
 * The screen shown when the server is running with an AUTH_TOKEN and this tab does not have it.
 *
 * Deliberately not a login form: there are no accounts and no session to establish. It takes
 * the one shared token, keeps it for the tab, and gets out of the way. The distinction matters
 * for what it does *not* do — no cookie is set, so nothing here can be replayed by a cross-site
 * request later.
 */

import { useState, type FormEvent } from 'react';
import { setToken } from '../lib/api.ts';

export function TokenGate({ onUnlock, rejected }: { onUnlock: () => void; rejected: boolean }) {
  const [value, setValue] = useState('');

  function submit(event: FormEvent): void {
    event.preventDefault();
    if (value.trim() === '') return;
    setToken(value);
    setValue('');
    onUnlock();
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4">
      <h1 className="text-lg font-semibold tracking-tight text-ink-100">valuuttaloki</h1>
      <p className="mt-2 text-sm text-ink-400">
        This instance is protected by an API token. Paste the value of <code>AUTH_TOKEN</code> from
        the server&rsquo;s environment.
      </p>

      <form onSubmit={submit} className="mt-4 flex flex-col gap-3">
        <input
          type="password"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="AUTH_TOKEN"
          autoComplete="off"
          autoFocus
          aria-label="API token"
          className="rounded border border-ink-700 bg-ink-900 px-3 py-2 font-mono text-sm text-ink-100 outline-none focus:border-accent-600"
        />
        <button
          type="submit"
          className="rounded bg-accent-600 px-3 py-2 text-sm font-medium text-ink-950 hover:bg-accent-500 disabled:opacity-50"
          disabled={value.trim() === ''}
        >
          Unlock
        </button>
      </form>

      {rejected ? (
        <p className="mt-3 rounded border border-accent-600/50 bg-accent-600/10 px-3 py-2 text-xs text-accent-400">
          That token was rejected.
        </p>
      ) : null}

      <p className="mt-6 text-xs text-ink-500">
        Kept for this tab only, and sent as a bearer header — never as a cookie, and never in the
        URL.
      </p>
    </div>
  );
}
