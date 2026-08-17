/**
 * Poller state, from /api/health.
 *
 * A halted poller is the failure this app is most likely to actually hit — an expired
 * POESESSID, most often — and a chart that simply stops moving looks identical to a player who
 * stopped playing. So the state is stated in words at the top of the page, not inferred.
 */

import { useEffect, useRef, useState } from 'react';
import { api, type HealthResponse } from '../lib/api.ts';
import { formatAgo } from '../lib/format.ts';
import { nextPollLabel } from '../lib/schedule.ts';
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
  const [now, setNow] = useState(() => Date.now());

  const nextRunAt = health?.schedule.nextRunAt ?? null;
  const pollRunning = health?.poller.running ?? false;
  /** The deadline we have already asked the server about, so one lapse triggers one refresh. */
  const refreshedFor = useRef<string | null>(null);

  // A clock, not a data fetch: the deadline is fixed, only the distance to it changes. Ticking
  // locally keeps the countdown smooth without asking the server sixty times a minute, and the
  // timer only exists while there is something to count down to.
  useEffect(() => {
    if (nextRunAt === null || pollRunning) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [nextRunAt, pollRunning]);

  // When the countdown runs out, the poll it was counting to has started — but this page would
  // not learn that until its next slow refresh, and would sit on "due now" for up to a minute.
  // Asking once, at the moment it lapses, is what makes the transition to "polling now" look
  // like the thing that actually happened.
  useEffect(() => {
    if (nextRunAt === null || pollRunning) return;
    if (refreshedFor.current === nextRunAt) return;
    if (Date.parse(nextRunAt) > now) return;
    refreshedFor.current = nextRunAt;
    onPolled();
  }, [nextRunAt, pollRunning, now, onPolled]);

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

      <span
        title={
          health.schedule.nextRunAt === null
            ? `Schedule: ${health.schedule.cron}`
            : `Scheduled for ${new Date(health.schedule.nextRunAt).toLocaleTimeString()} (${health.schedule.cron})`
        }
        className="tabular-nums text-ink-200"
      >
        {nextPollLabel(
          {
            running: running,
            halted: health.poller.halted,
            disabledReason: health.poller.disabledReason,
            nextRunAt: health.schedule.nextRunAt,
          },
          now,
        )}
      </span>

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
