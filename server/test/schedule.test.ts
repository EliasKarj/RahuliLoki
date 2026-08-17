import { describe, expect, it } from 'vitest';
import cron from 'node-cron';
import { nextScheduledPoll } from '../src/lib/schedule.ts';

const at = (iso: string): Date => new Date(iso);
const RUNS = [
  at('2026-01-01T12:10:00Z'),
  at('2026-01-01T12:20:00Z'),
  at('2026-01-01T12:30:00Z'),
];

describe('nextScheduledPoll', () => {
  it('takes the next fire when nothing is holding the poller back', () => {
    expect(nextScheduledPoll(RUNS, 0)).toBe('2026-01-01T12:10:00.000Z');
  });

  it('skips the fires a backoff will swallow', () => {
    // A tick during a backoff does not poll and does not queue: it is simply skipped. Counting
    // down to it would promise a poll that never happens.
    const notBefore = Date.parse('2026-01-01T12:21:00Z');
    expect(nextScheduledPoll(RUNS, notBefore)).toBe('2026-01-01T12:30:00.000Z');
  });

  it('counts a fire exactly at the end of the backoff', () => {
    const notBefore = Date.parse('2026-01-01T12:20:00Z');
    expect(nextScheduledPoll(RUNS, notBefore)).toBe('2026-01-01T12:20:00.000Z');
  });

  it('answers null rather than a time it cannot stand behind', () => {
    expect(nextScheduledPoll(RUNS, Date.parse('2026-01-02T00:00:00Z'))).toBeNull();
    expect(nextScheduledPoll([], 0)).toBeNull();
  });
});

describe('node-cron', () => {
  it('still answers what its own upcoming runs are', async () => {
    // The whole countdown rests on this: the times come from the scheduler holding the timer,
    // not from a second parse of the expression that could disagree with it. If a node-cron
    // upgrade drops or renames getNextRuns, this test says so rather than the dashboard
    // quietly counting down to nothing.
    const task = cron.schedule('*/10 * * * *', () => undefined, { noOverlap: true });
    try {
      const runs = task.getNextRuns(3);
      expect(runs).toHaveLength(3);
      expect(runs[0]).toBeInstanceOf(Date);
      // Ten minutes apart, in order.
      expect(runs[1]!.getTime() - runs[0]!.getTime()).toBe(600_000);
      expect(runs[0]!.getTime()).toBeGreaterThan(Date.now() - 60_000);
    } finally {
      await task.destroy();
    }
  });
});
