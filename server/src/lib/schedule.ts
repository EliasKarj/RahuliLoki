/**
 * Which scheduled fire will actually poll.
 *
 * The scheduler fires on the cron expression, but a fire during a backoff is *skipped* rather
 * than delayed — so after a failed poll, "when does the timer next go off" and "when does the
 * stash next get read" are different questions. The dashboard counts down to the second one.
 *
 * The runs come from node-cron itself rather than a second parse of the expression here. A
 * countdown that disagrees with the timer it claims to be counting is worse than none.
 */
export function nextScheduledPoll(runs: readonly Date[], notBefore: number): string | null {
  for (const run of runs) {
    if (run.getTime() >= notBefore) return run.toISOString();
  }
  // The backoff outlasts every run we were given. Null — "no poll scheduled" — is the honest
  // answer; a time this cannot stand behind would count down to nothing happening.
  return null;
}
