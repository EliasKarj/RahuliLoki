/**
 * Comparing two versions, which is the whole of an update check that can go wrong quietly.
 *
 * Getting this wrong in one direction nags forever about an update that is already installed;
 * in the other it stays silent through every release. Both look like "the check does not work",
 * and neither shows up until a version number crosses a boundary — 1.0.9 to 1.0.10 being the
 * classic one, where string comparison says the new one is older.
 *
 * So: numbers compared as numbers, and anything that is not a plain `major.minor.patch` is not
 * treated as newer. A tag nobody can parse is not a reason to tell someone to go and download
 * something.
 */

/** `v1.2.3` → `[1, 2, 3]`. Null for anything else, including prereleases. */
export function parseVersion(value: string): [number, number, number] | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(value.trim());
  if (match === null) return null;
  const parts = [Number(match[1]), Number(match[2]), Number(match[3])] as [number, number, number];
  return parts.every((part) => Number.isSafeInteger(part)) ? parts : null;
}

/**
 * Is `candidate` a release later than `current`?
 *
 * False whenever the answer is not clearly yes: an unparseable tag, a prerelease, the same
 * version, or an older one. The cost of a false yes is a person downloading what they already
 * have and concluding the app lies to them.
 */
export function isNewer(current: string, candidate: string): boolean {
  const a = parseVersion(current);
  const b = parseVersion(candidate);
  if (a === null || b === null) return false;

  for (let i = 0; i < 3; i += 1) {
    if ((b[i] as number) > (a[i] as number)) return true;
    if ((b[i] as number) < (a[i] as number)) return false;
  }
  return false;
}
