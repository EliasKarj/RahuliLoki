/**
 * Translating GGG's league name into the one poe.ninja indexes it under.
 *
 * These are two different vocabularies and nothing guarantees they agree. GGG's league list
 * gives the official name; poe.ninja indexes economies under its own, usually shorter label —
 * their own API documentation demonstrates `league=Keepers` for the league GGG calls "Keepers
 * of the Flame". Passing GGG's name straight through therefore produces a 404 that looks like
 * an outage and is really a vocabulary mismatch.
 *
 * The approach here is deliberately not "guess a shorter name and hope". It is:
 *
 *   1. Ask for the configured name first. When the two vocabularies do agree — which is the
 *      common case, and always the case for the permanent leagues — this costs nothing extra.
 *   2. Only after a 404, ask poe.ninja what it actually indexes and match against that.
 *   3. If nothing matches, say what poe.ninja does index rather than repeating the 404.
 *
 * `getindexstate` is poe.ninja's own listing endpoint and is not documented, so its exact shape
 * cannot be relied on. `harvestLeagueNames` therefore does not assume one: it walks the whole
 * payload and collects anything that looks like a league name, at any depth. A shape change
 * costs us the match, not a crash.
 *
 * The matching itself is conservative on purpose. Resolving to the *wrong* league is worse than
 * resolving to none: a 404 is loud, whereas hardcore prices quietly applied to a softcore stash
 * are wrong numbers in a chart nobody will question. So a candidate is only ever accepted when
 * its hardcore/SSF/ruthless modifiers are identical to the configured league's.
 */

/** How poe.ninja's own names differ from GGG's, reduced to something comparable. */
export interface LeagueParts {
  /** The league name with modifiers and punctuation removed: "Hardcore Allflame" → "allflame". */
  base: string;
  hardcore: boolean;
  ssf: boolean;
  ruthless: boolean;
}

/** Modifier words, longest first so "hardcore ssf" strips both rather than leaving a fragment. */
const MODIFIER_WORDS = [
  'hardcore',
  'ruthless',
  'solo self-found',
  'self-found',
  'ssf',
  'hc',
] as const;

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Split a league name into a base and its modifiers.
 *
 * Both vocabularies have to survive this: GGG writes "Hardcore Allflame" and "Solo Self-Found",
 * poe.ninja writes "AllflameHC" and "AllflameSSF". Words are matched as whole tokens, and the
 * abbreviations additionally as a suffix of the collapsed name — that suffix rule is what turns
 * poe.ninja's "AllflameHC" into the same base as GGG's "Hardcore Allflame".
 */
export function leagueParts(name: string): LeagueParts {
  const lower = name.toLowerCase();
  const tokens = lower.split(/[^a-z0-9]+/).filter((token) => token !== '');

  let hardcore = tokens.includes('hardcore') || tokens.includes('hc');
  let ssf = tokens.includes('ssf') || lower.includes('self-found') || lower.includes('self found');
  let ruthless = tokens.includes('ruthless');

  let base = lower;
  for (const word of MODIFIER_WORDS) {
    base = base.replace(new RegExp(`\\b${word.replace(/[-\s]/g, '[-\\s]')}\\b`, 'g'), ' ');
  }
  base = slug(base);

  // poe.ninja glues the abbreviation on: "AllflameHC", "AllflameSSF", "AllflameHCSSF". Peel
  // them off the end, repeatedly, so order does not matter.
  for (let changed = true; changed; ) {
    changed = false;
    if (base.endsWith('ssf')) {
      base = base.slice(0, -3);
      ssf = true;
      changed = true;
    } else if (base.endsWith('hc')) {
      base = base.slice(0, -2);
      hardcore = true;
      changed = true;
    } else if (base.endsWith('ruthless')) {
      base = base.slice(0, -8);
      ruthless = true;
      changed = true;
    }
  }

  return { base, hardcore, ssf, ruthless };
}

/** Same game mode? Never match across these — see the module comment. */
function sameModifiers(a: LeagueParts, b: LeagueParts): boolean {
  return a.hardcore === b.hardcore && a.ssf === b.ssf && a.ruthless === b.ruthless;
}

/**
 * Pull every plausible league name out of a `getindexstate` payload, whatever its shape.
 *
 * The endpoint is undocumented, so this reads it structurally rather than by schema: any object
 * carrying a string `name` (or `url`, which is poe.ninja's slug for the same thing) contributes
 * a candidate, at any nesting depth. Bare string arrays are read too, since a listing endpoint
 * plausibly returns those. Cycles and absurd depth are bounded.
 */
export function harvestLeagueNames(payload: unknown): string[] {
  const found: string[] = [];
  const seen = new Set<unknown>();

  const visit = (node: unknown, depth: number): void => {
    if (depth > 8 || node === null || typeof node !== 'object') return;
    if (seen.has(node)) return;
    seen.add(node);

    if (Array.isArray(node)) {
      for (const entry of node) {
        if (typeof entry === 'string') push(entry);
        else visit(entry, depth + 1);
      }
      return;
    }

    const record = node as Record<string, unknown>;
    for (const key of ['name', 'url', 'league', 'id']) {
      const value = record[key];
      if (typeof value === 'string') push(value);
    }
    for (const value of Object.values(record)) visit(value, depth + 1);
  };

  const push = (value: string): void => {
    const trimmed = value.trim();
    // A URL is a link, not a league name; `url` on poe.ninja's entries is a bare slug.
    if (trimmed === '' || trimmed.length > 64 || trimmed.includes('/')) return;
    if (!found.includes(trimmed)) found.push(trimmed);
  };

  visit(payload, 0);
  return found;
}

export interface LeagueMatch {
  /** The name to send to poe.ninja. */
  name: string;
  /** How it was found, for the log line. */
  how: 'exact' | 'case' | 'slug' | 'base';
}

/**
 * Pick the name poe.ninja knows this league by, or null when none of them fit.
 *
 * Four tiers, tightest first. `base` is the tier that does the real work — it is what maps GGG's
 * "Keepers of the Flame" onto poe.ninja's "Keepers" — and it is also the loosest, so it is
 * gated twice: identical modifiers, and one base must be a prefix of the other rather than
 * merely overlapping. On a tie the longest candidate wins, because a longer indexed name is the
 * more specific one and specificity is what keeps "Allflame" from swallowing "Allflame Event".
 */
export function matchLeagueName(configured: string, indexed: readonly string[]): LeagueMatch | null {
  const wanted = configured.trim();
  if (wanted === '') return null;

  const exact = indexed.find((name) => name === wanted);
  if (exact !== undefined) return { name: exact, how: 'exact' };

  const lower = wanted.toLowerCase();
  const byCase = indexed.find((name) => name.toLowerCase() === lower);
  if (byCase !== undefined) return { name: byCase, how: 'case' };

  const wantedSlug = slug(wanted);
  const bySlug = indexed.find((name) => slug(name) === wantedSlug);
  if (bySlug !== undefined) return { name: bySlug, how: 'slug' };

  const target = leagueParts(wanted);
  if (target.base === '') return null;

  let best: string | null = null;
  for (const name of indexed) {
    const parts = leagueParts(name);
    if (parts.base === '' || !sameModifiers(parts, target)) continue;
    if (!parts.base.startsWith(target.base) && !target.base.startsWith(parts.base)) continue;
    if (best === null || name.length > best.length) best = name;
  }

  return best === null ? null : { name: best, how: 'base' };
}
