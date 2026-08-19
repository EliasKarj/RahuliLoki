import { describe, expect, it } from 'vitest';
import { pollStamp, shouldRefetch } from '../src/lib/refresh.ts';

const poller = (lastSuccessAt: string | null, totalPolls: number) => ({ lastSuccessAt, totalPolls });

describe('pollStamp', () => {
  it('is the same string while nothing has polled', () => {
    expect(pollStamp(poller('2026-01-01T00:00:00Z', 4))).toBe(
      pollStamp(poller('2026-01-01T00:00:00Z', 4)),
    );
  });

  it('changes when a poll succeeds', () => {
    expect(pollStamp(poller('2026-01-01T00:00:00Z', 4))).not.toBe(
      pollStamp(poller('2026-01-01T00:10:00Z', 5)),
    );
  });

  it('changes when a poll fails, too', () => {
    // A failure writes no snapshot but does change what the page says: the error line, the halt
    // state, the countdown's reason. The timestamp alone would miss all of it.
    expect(pollStamp(poller('2026-01-01T00:00:00Z', 4))).not.toBe(
      pollStamp(poller('2026-01-01T00:00:00Z', 5)),
    );
  });

  it('has a stamp before anything has ever polled', () => {
    expect(pollStamp(poller(null, 0))).toBe('|0');
  });
});

describe('shouldRefetch', () => {
  it('skips the heavy fetches when the poll behind the view has not changed', () => {
    expect(shouldRefetch(false, 'a|1', 'a|1')).toBe(false);
  });

  it('fetches when a poll has happened since', () => {
    expect(shouldRefetch(false, 'a|1', 'b|2')).toBe(true);
  });

  it('always fetches when forced', () => {
    // A new league or range asks a different question; the answer on screen is not stale, it is
    // about something else.
    expect(shouldRefetch(true, 'a|1', 'a|1')).toBe(true);
  });

  it('fetches when there is nothing on screen yet', () => {
    expect(shouldRefetch(false, null, '|0')).toBe(true);
  });
});
