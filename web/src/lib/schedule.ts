/**
 * When the next automatic poll happens, said in words.
 *
 * The stash is read on a schedule — and by hand, with the button — but until now the only way to
 * know when the next automatic read was due was to read a cron expression in the footer and do
 * the arithmetic. A countdown answers the question people actually have: is it about to refresh
 * itself, or should I press the button?
 *
 * The deadline comes from the server, which asks the scheduler that actually holds the timer.
 * This module only turns it into a label, and everything here is pure so `now` can be a
 * parameter: a countdown whose only test is "look at it" is a countdown nobody can check.
 */

/** `m:ss` under an hour, `h:mm:ss` above it. Rounds up, so the last second reads `0:01`. */
export function formatCountdown(ms: number): string {
  if (!Number.isFinite(ms)) return '—';

  const seconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  const pad = (value: number): string => String(value).padStart(2, '0');

  if (minutes < 60) return `${minutes}:${pad(seconds % 60)}`;
  return `${Math.floor(minutes / 60)}:${pad(minutes % 60)}:${pad(seconds % 60)}`;
}

/** The intervals the desktop settings offer, in minutes. */
export const INTERVAL_CHOICES = [5, 10, 15, 30, 60] as const;

/**
 * A cron expression for an every-N-minutes schedule.
 *
 * The server keeps taking a full cron expression — it is the more capable thing, and someone
 * running the container may well want one every other hour. The desktop settings offer a menu
 * of minutes instead, because "every 5 minutes" is the question people are actually asking, and
 * a text box taking a raw cron expression invites a typo the app can only reject at boot.
 */
export function cronForMinutes(minutes: number): string {
  return minutes >= 60 ? `0 */${Math.round(minutes / 60)} * * *` : `*/${Math.round(minutes)} * * * *`;
}

/**
 * Read an interval back out of a cron expression, when it is one of ours.
 *
 * Null for anything else — an expression written by hand can say things a number of minutes
 * cannot, and quietly rounding `30 4 * * 1` to "every 30 minutes" would misreport it and then
 * overwrite it on the next save.
 */
export function minutesFromCron(cron: string): number | null {
  const minutely = /^\*\/(\d+) \* \* \* \*$/.exec(cron.trim());
  if (minutely) {
    const minutes = Number(minutely[1]);
    return minutes > 0 && minutes < 60 ? minutes : null;
  }
  const hourly = /^0 (?:\*|\*\/(\d+)) \* \* \*$/.exec(cron.trim());
  if (hourly) {
    const hours = hourly[1] === undefined ? 1 : Number(hourly[1]);
    return hours > 0 ? hours * 60 : null;
  }
  return null;
}

/**
 * A schedule in words: "every 10 minutes", or the raw expression when it is not an interval.
 *
 * A cron expression is a perfectly good way to write a schedule and a poor way to read one. The
 * empty state used to print the raw expression at someone waiting for their first snapshot,
 * which answers the question only if you already know the answer.
 */
export function describeSchedule(cron: string | null): string {
  if (cron === null) return 'on a schedule';
  const minutes = minutesFromCron(cron);
  if (minutes === null) return `on the schedule ${cron}`;
  if (minutes < 60) return `every ${minutes} minutes`;
  const hours = minutes / 60;
  return hours === 1 ? 'every hour' : `every ${hours} hours`;
}

/**
 * GGG's hourly budget on the stash endpoint.
 *
 * The policy the rate limiter reads back is `45:60:120,200:3600:3600`: two hundred requests an
 * hour. Hardcoded here only to size the warning under the interval picker — the pacing itself
 * comes from the headers, which are the authority.
 */
export const HOURLY_STASH_BUDGET = 200;

/**
 * What an hour of automatic polling costs GGG, in requests.
 *
 * One request per tab per poll: the first also returns the tab list, so there is no extra call
 * for it. This is why the interval and the size of the stash cannot be chosen separately.
 */
export function requestsPerHour(intervalMinutes: number, tabs: number): number {
  if (intervalMinutes <= 0 || tabs <= 0) return 0;
  return Math.round((60 / intervalMinutes) * tabs);
}

/** The shortest interval a stash of this size fits into GGG's hourly budget at. */
export function fittingIntervalMinutes(tabs: number, choices: readonly number[]): number | null {
  if (tabs <= 0) return null;
  return (
    [...choices]
      .sort((a, b) => a - b)
      .find((minutes) => requestsPerHour(minutes, tabs) <= HOURLY_STASH_BUDGET) ?? null
  );
}

/**
 * Why a chosen interval will not hold, in one sentence — or null when it will.
 *
 * Nothing breaks when the budget is exceeded: the limiter paces itself and polls simply take
 * longer, stretching past the interval until they overlap the next one. That is worth a warning
 * and not a refusal — it is the operator's stash and their call.
 */
export function intervalWarning(intervalMinutes: number, tabs: number | null): string | null {
  if (tabs === null || tabs <= 0) return null;
  const requests = requestsPerHour(intervalMinutes, tabs);
  if (requests <= HOURLY_STASH_BUDGET) return null;
  return (
    `${tabs} tabs every ${intervalMinutes} min is ${requests} requests an hour, over GGG's ` +
    `${HOURLY_STASH_BUDGET}. Polls will be paced out and start overlapping.`
  );
}

/** The parts of /api/health this answer depends on. */
export interface ScheduleView {
  running: boolean;
  halted: boolean;
  disabledReason: string | null;
  /** ISO time of the next scheduled poll, or null when none will run. */
  nextRunAt: string | null;
}

/**
 * What to print where the countdown goes.
 *
 * A missing deadline is not one case but several, and they mean different things to someone
 * waiting: polling is off because the app is unconfigured, polling has stopped because something
 * broke, or a poll is happening right now. Collapsing them into a blank space would leave the
 * most useful state — "it is running, that is why the number is gone" — looking like a bug.
 */
export function nextPollLabel(view: ScheduleView, now: number = Date.now()): string {
  if (view.running) return 'polling now';
  if (view.disabledReason !== null) return 'automatic polling off';
  if (view.halted) return 'automatic polling stopped';
  if (view.nextRunAt === null) return 'no poll scheduled';

  const due = Date.parse(view.nextRunAt);
  if (Number.isNaN(due)) return 'no poll scheduled';

  // The deadline can sit in the past for a moment: the page holds a health response from up to a
  // minute ago, and the poll it named has since started. "due now" is the honest reading of that
  // — the alternative is a countdown that runs negative or sticks at 0:00 pretending to wait.
  const remaining = due - now;
  return remaining <= 0 ? 'due now' : `next poll in ${formatCountdown(remaining)}`;
}
