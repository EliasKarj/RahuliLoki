/**
 * Whether a background refresh has anything to fetch.
 *
 * The dashboard used to re-download the whole series once a minute. Snapshots are append-only
 * and one arrives every ten minutes, so nine of every ten refreshes spent several megabytes —
 * on a league's worth of history, seven — to redraw exactly what was already on screen.
 *
 * `/api/health` answers in about a millisecond and names the last poll. Nothing else in the
 * dashboard can change without one, so it is the whole test: same poll, same data.
 */

export interface PollStamp {
  lastSuccessAt: string | null;
  totalPolls: number;
}

/**
 * A short string that changes when, and only when, a poll has finished.
 *
 * `totalPolls` is in it as well as the timestamp because a poll that failed still moves the
 * count, and a failure can change what the page shows — the error line, the halt state — even
 * though no new snapshot was written.
 */
export function pollStamp(poller: PollStamp): string {
  return `${poller.lastSuccessAt ?? ''}|${poller.totalPolls}`;
}

/**
 * Fetch the heavy endpoints, or make do with the health response just received?
 *
 * `force` covers the two cases where the question itself changed rather than the answer: the
 * first load of a league or range, and the refresh button. Neither can be answered from a stamp,
 * because the data on screen is not the data being asked for.
 */
export function shouldRefetch(force: boolean, built: string | null, stamp: string): boolean {
  return force || built === null || built !== stamp;
}
