/**
 * Poller state, from /api/health.
 *
 * A halted poller is the failure this app is most likely to actually hit — an expired
 * POESESSID, most often — and a chart that simply stops moving looks identical to a player who
 * stopped playing. So the state is stated in words at the top of the page, not inferred.
 */

import { useState } from 'react';
import { api, type HealthResponse } from '../lib/api.ts';
import { formatAgo } from '../lib/format.ts';
import { Pill } from './ui.tsx';

const LABELS: Record<HealthResponse['status'], { tone: 'ok' | 'warn' | 'muted'; text: string }> = {
  ok: { tone: 'ok', text: 'polling' },
  idle: { tone: 'muted', text: 'waiting for the first poll' },
  degraded: { tone: 'warn', text: 'last poll failed' },
  halted: { tone: 'warn', text: 'halted' },
  unconfigured: { tone: 'warn', text: 'not configured' },
};

export function PollerStatus({ health, onPolled }: { health: HealthResponse | null; onPolled: () => void }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (health === null) {
    return <div className="text-xs text-ink-400">Contacting the server…</div>;
  }

  const label = LABELS[health.status];
  const bucket = health.rateLimit.buckets[0];

  // A poll is running when this button started one *or* when the server says so — a scheduled
  // tick counts too, and it is the server's answer that outlives a page reload.
  const running = busy || health.poller.running;

  const poll = async (): Promise<void> => {
    setBusy(true);
    setMessage(null);
    try {
      // Returns as soon as the poll has started, not when it has finished. Reading a stash is
      // minutes of paced requests; waiting here is what made a healthy poll read as a network
      // error on screen. The outcome arrives through /api/health instead.
      await api.poll();
      setMessage('Polling. A full stash takes a few minutes — this page updates itself.');
      onPolled();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-ink-400">
      <Pill tone={label.tone}>{label.text}</Pill>

      <span>
        last poll <span className="text-ink-200">{formatAgo(health.poller.lastSuccessAt)}</span>
      </span>

      {health.prices.fetchedAt ? (
        <span>
          prices <span className="text-ink-200">{formatAgo(health.prices.fetchedAt)}</span>
          {health.prices.stale ? ' (stale)' : ''}
        </span>
      ) : null}

      {bucket ? (
        <span title="Requests left in GGG's tightest rate-limit bucket">
          rate limit{' '}
          <span className="text-ink-200">
            {bucket.remaining}/{bucket.limit.hits} per {bucket.limit.periodSeconds}s
          </span>
        </span>
      ) : null}

      <button
        type="button"
        onClick={() => void poll()}
        disabled={running || health.status === 'unconfigured'}
        className="rounded border border-ink-700 px-2 py-1 text-ink-300 transition-colors hover:border-ink-600 hover:text-ink-100 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {running ? 'polling…' : 'poll now'}
      </button>

      {health.poller.haltReason ? (
        <span className="w-full text-accent-400">{health.poller.haltReason}</span>
      ) : health.poller.disabledReason ? (
        <span className="w-full text-accent-400">{health.poller.disabledReason}</span>
      ) : health.poller.lastError ? (
        <span className="w-full text-accent-400">last error: {health.poller.lastError}</span>
      ) : null}

      {message ? <span className="w-full text-ink-300">{message}</span> : null}
    </div>
  );
}
