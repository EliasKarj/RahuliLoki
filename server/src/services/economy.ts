/**
 * Everything poe.ninja prices, as a list a person can search.
 *
 * ## The problem this has to solve first: the payload has no names
 *
 * A price line is `{ "id": "alt", "primaryValue": 0.1238 }`. poe.ninja names exactly two items
 * in `core.items` — chaos and divine, the pricing pair — and the website knows the rest because
 * they are baked into its own JavaScript. So a list of "all the items" is, in the raw data, a
 * list of identifiers.
 *
 * Three sources of a name, in descending order of how much they can be trusted:
 *
 *   Stash.  The names in your own snapshots are real, and `ninjaId()` maps each one to the id
 *           poe.ninja prices it under. Every item you have ever held is therefore named exactly
 *           as the game names it.
 *
 *   Alias.  The short-code table in ninjaId.ts is written from display names, so reversing it
 *           gives real names for `alt`, `gcp`, `chisel` and the rest of the abbreviations.
 *
 *   Slug.   Everything else. `awakeners-orb` reads back as "Awakeners Orb" — right words, lost
 *           apostrophe, because the slug rule drops punctuation and nothing records where it
 *           went. Recognisable and searchable, which is what a search needs; not authoritative,
 *           which is why every row says which of the three it came from.
 *
 * Nothing is invented. An id that yields no readable name at all is listed under the id itself
 * rather than under a guess.
 */

import { SHORT_CODES, ninjaId } from './ninjaId.ts';
import type { LineMeta } from './ninjaPayload.ts';

export type NameSource = 'stash' | 'alias' | 'slug';

export interface EconomyRow {
  /** poe.ninja's own identifier. Unique, and the thing the price is actually keyed by. */
  id: string;
  name: string;
  /** Where the name came from — see the module comment. Shown so a guess reads as a guess. */
  nameSource: NameSource;
  /** The poe.ninja `type` the line arrived under, when one was recorded. */
  category: string | null;
  chaos: number;
  /** Convenience for the client, which would otherwise divide in three places. */
  divine: number;
  icon: string | null;
  /**
   * What the price has been doing, as poe.ninja publishes it. Null when it publishes nothing —
   * which is not the same claim as "it has not moved", and is why this is nullable rather than
   * a zero.
   */
  change: number | null;
  volume: number | null;
  /** poe.ninja's own series, percentages from its own start. Empty when it published none. */
  sparkline: number[];
}

/** Short code → display name. The table is written the other way round; this turns it over. */
export function reverseAliases(): Map<string, string> {
  const out = new Map<string, string>();
  for (const [name, code] of Object.entries(SHORT_CODES)) {
    // First name wins: two names mapping to one code would be a bug in the table, and picking
    // the earlier one at least makes it deterministic.
    if (!out.has(code)) out.set(code, name);
  }
  return out;
}

/**
 * `awakeners-orb` → `Awakeners Orb`.
 *
 * Title case over the words, with the small words left lowercase inside the name the way the
 * game writes them — "Orb of Alteration", not "Orb Of Alteration". The apostrophe is gone for
 * good; see the module comment.
 */
const SMALL_WORDS = new Set(['of', 'the', 'and', 'at', 'in', 'to', 'a', 'an']);

export function unslug(id: string): string {
  const words = id.split('-').filter((word) => word !== '');
  if (words.length === 0) return '';
  return words
    .map((word, index) =>
      index > 0 && SMALL_WORDS.has(word) ? word : word.charAt(0).toUpperCase() + word.slice(1),
    )
    .join(' ');
}

/**
 * The names your own stash proves, keyed by the id poe.ninja prices them under.
 *
 * The breakdown is `tab → name → entry`, and the same item in three tabs is three occurrences
 * of one name, which is why this is a set rather than a count.
 */
export function namesFromBreakdown(breakdown: Record<string, Record<string, unknown>>): Map<string, string> {
  const out = new Map<string, string>();
  for (const items of Object.values(breakdown)) {
    for (const name of Object.keys(items)) {
      const id = ninjaId(name);
      if (id !== '' && !out.has(id)) out.set(id, name);
    }
  }
  return out;
}

export interface EconomyInput {
  prices: Record<string, number>;
  categories: Record<string, string>;
  /** Icons are keyed by display name, which is why they are looked up after the name is known. */
  icons: Record<string, string>;
  divineRate: number;
  /** Names proved by the stash — see namesFromBreakdown. */
  known?: Map<string, string>;
  /** Movement per id, as recorded at fetch time. Missing ids simply have none. */
  meta?: Record<string, LineMeta>;
}

/** One row per priced id, most valuable first. */
export function buildEconomy(input: EconomyInput): EconomyRow[] {
  const aliases = reverseAliases();
  const known = input.known ?? new Map<string, string>();
  const rows: EconomyRow[] = [];

  for (const [id, chaos] of Object.entries(input.prices)) {
    if (!Number.isFinite(chaos) || chaos <= 0) continue;

    const fromStash = known.get(id);
    const fromAlias = aliases.get(id);
    const name = fromStash ?? fromAlias ?? unslug(id);
    const nameSource: NameSource =
      fromStash !== undefined ? 'stash' : fromAlias !== undefined ? 'alias' : 'slug';

    const meta = input.meta?.[id];

    rows.push({
      id,
      // An id that reads back as nothing at all is listed as itself rather than as an empty row.
      name: name === '' ? id : name,
      nameSource,
      category: input.categories[id] ?? null,
      chaos,
      divine: input.divineRate > 0 ? chaos / input.divineRate : 0,
      icon: input.icons[name] ?? null,
      change: meta?.change ?? null,
      volume: meta?.volume ?? null,
      sparkline: meta?.sparkline ?? [],
    });
  }

  return rows.sort((a, b) => b.chaos - a.chaos || a.name.localeCompare(b.name));
}

/**
 * Case- and punctuation-insensitive search over the name, the id and the category.
 *
 * The id is searchable on purpose: it is what poe.ninja and the trade site call the thing, and
 * somebody who knows an item as `gcp` should not have to guess that this app calls it
 * "Gemcutter's Prism".
 */
export function searchEconomy(rows: EconomyRow[], query: string): EconomyRow[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return rows;
  const bare = needle.replace(/[^a-z0-9 ]/g, '');

  return rows.filter((row) => {
    const haystack = `${row.name} ${row.id} ${row.category ?? ''}`.toLowerCase();
    return haystack.includes(needle) || haystack.replace(/[^a-z0-9 ]/g, '').includes(bare);
  });
}
