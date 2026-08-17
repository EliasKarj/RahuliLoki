import { describe, expect, it } from 'vitest';
import {
  HOURLY_STASH_BUDGET,
  INTERVAL_CHOICES,
  cronForMinutes,
  describeSchedule,
  fittingIntervalMinutes,
  formatCountdown,
  intervalWarning,
  minutesFromCron,
  nextPollLabel,
  requestsPerHour,
  type ScheduleView,
} from '../src/lib/schedule.ts';

const NOW = Date.parse('2026-01-01T12:00:00Z');

/** A scheduled, healthy poller. Each test overrides the one field it is about. */
function view(overrides: Partial<ScheduleView> = {}): ScheduleView {
  return {
    running: false,
    halted: false,
    disabledReason: null,
    nextRunAt: '2026-01-01T12:05:00Z',
    ...overrides,
  };
}

describe('formatCountdown', () => {
  it('reads m:ss under an hour', () => {
    expect(formatCountdown(4 * 60_000 + 7_000)).toBe('4:07');
    expect(formatCountdown(45_000)).toBe('0:45');
  });

  it('reads h:mm:ss at an hour and above', () => {
    expect(formatCountdown(3_600_000)).toBe('1:00:00');
    expect(formatCountdown(2 * 3_600_000 + 3 * 60_000 + 9_000)).toBe('2:03:09');
  });

  it('rounds up, so a partial second still shows as a second left', () => {
    // Rounding down would print 0:00 for a whole second before the poll runs, which reads as
    // "it should have happened by now" every single cycle.
    expect(formatCountdown(1)).toBe('0:01');
    expect(formatCountdown(1_400)).toBe('0:02');
  });

  it('never goes negative', () => {
    expect(formatCountdown(-5_000)).toBe('0:00');
  });

  it('says nothing rather than NaN', () => {
    expect(formatCountdown(Number.NaN)).toBe('—');
  });
});

describe('nextPollLabel', () => {
  it('counts down to the scheduled poll', () => {
    expect(nextPollLabel(view(), NOW)).toBe('next poll in 5:00');
  });

  it('says a poll is happening instead of counting to the next one', () => {
    expect(nextPollLabel(view({ running: true }), NOW)).toBe('polling now');
  });

  it('says the deadline has passed rather than counting into the negative', () => {
    // The page holds a health response up to a minute old, so a lapsed deadline is normal.
    expect(nextPollLabel(view({ nextRunAt: '2026-01-01T11:59:30Z' }), NOW)).toBe('due now');
  });

  it('distinguishes off from stopped from unscheduled', () => {
    expect(nextPollLabel(view({ disabledReason: 'POESESSID not set' }), NOW)).toBe(
      'automatic polling off',
    );
    expect(nextPollLabel(view({ halted: true, nextRunAt: null }), NOW)).toBe(
      'automatic polling stopped',
    );
    expect(nextPollLabel(view({ nextRunAt: null }), NOW)).toBe('no poll scheduled');
  });

  it('prefers the running poll over every other state', () => {
    // A poll that is running right now is the most useful thing to say, even while the poller
    // is otherwise in a bad way — otherwise the button says "polling…" and this says "stopped".
    expect(nextPollLabel(view({ running: true, halted: true, nextRunAt: null }), NOW)).toBe(
      'polling now',
    );
  });

  it('treats an unparseable time as no schedule rather than printing NaN', () => {
    expect(nextPollLabel(view({ nextRunAt: 'soon' }), NOW)).toBe('no poll scheduled');
  });
});

describe('cronForMinutes / minutesFromCron', () => {
  it('round-trips every interval the picker offers', () => {
    for (const minutes of INTERVAL_CHOICES) {
      expect(minutesFromCron(cronForMinutes(minutes))).toBe(minutes);
    }
  });

  it('writes an hourly interval as an hour field, not a 60-minute one', () => {
    // `*/60 * * * *` is not a schedule cron accepts — the minute field only goes to 59.
    expect(cronForMinutes(60)).toBe('0 */1 * * *');
    expect(cronForMinutes(120)).toBe('0 */2 * * *');
  });

  it('reads the plain hourly form too', () => {
    expect(minutesFromCron('0 * * * *')).toBe(60);
  });

  it('refuses to read an interval out of an expression that is not one', () => {
    // Rounding `30 4 * * 1` to "every 30 minutes" would misreport a weekly schedule and then
    // overwrite it the next time anything saved.
    expect(minutesFromCron('30 4 * * 1')).toBeNull();
    expect(minutesFromCron('*/10 * * * 1-5')).toBeNull();
    expect(minutesFromCron('*/0 * * * *')).toBeNull();
    expect(minutesFromCron('')).toBeNull();
  });
});

describe('describeSchedule', () => {
  it('says an interval in words', () => {
    expect(describeSchedule(cronForMinutes(10))).toBe('every 10 minutes');
    expect(describeSchedule(cronForMinutes(60))).toBe('every hour');
    expect(describeSchedule(cronForMinutes(120))).toBe('every 2 hours');
  });

  it('falls back to the expression itself when it is not a plain interval', () => {
    expect(describeSchedule('30 4 * * 1')).toBe('on the schedule 30 4 * * 1');
  });

  it('says something sensible before the config has loaded', () => {
    expect(describeSchedule(null)).toBe('on a schedule');
  });
});

describe('requestsPerHour', () => {
  it('counts one request per tab per poll', () => {
    // The first stash request returns the tab list with the items, so there is no extra call.
    expect(requestsPerHour(10, 19)).toBe(114);
    expect(requestsPerHour(5, 19)).toBe(228);
  });

  it('is zero for nonsense rather than Infinity', () => {
    expect(requestsPerHour(0, 19)).toBe(0);
    expect(requestsPerHour(5, 0)).toBe(0);
  });
});

describe('intervalWarning', () => {
  it('warns when the stash cannot be read that often inside GGG s budget', () => {
    const warning = intervalWarning(5, 19);
    expect(warning).toContain('228');
    expect(warning).toContain(String(HOURLY_STASH_BUDGET));
  });

  it('stays quiet when the interval fits', () => {
    expect(intervalWarning(10, 19)).toBeNull();
    // Exactly at the budget is fitting, not over it.
    expect(intervalWarning(5, 16)).toBeNull();
    expect(intervalWarning(5, 17)).not.toBeNull();
  });

  it('says nothing before a poll has counted the tabs', () => {
    expect(intervalWarning(5, null)).toBeNull();
  });
});

describe('fittingIntervalMinutes', () => {
  it('picks the shortest interval a stash of that size fits', () => {
    expect(fittingIntervalMinutes(19, INTERVAL_CHOICES)).toBe(10);
    expect(fittingIntervalMinutes(16, INTERVAL_CHOICES)).toBe(5);
    expect(fittingIntervalMinutes(120, INTERVAL_CHOICES)).toBe(60);
  });

  it('answers null when nothing on the menu fits', () => {
    expect(fittingIntervalMinutes(500, INTERVAL_CHOICES)).toBeNull();
    expect(fittingIntervalMinutes(0, INTERVAL_CHOICES)).toBeNull();
  });
});
