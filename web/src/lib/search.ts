/**
 * The one way this app decides whether a typed query matches a row.
 *
 * There were three: the item table's, the economy table's, and a copy on the server that
 * nothing called. They agreed on the idea — ignore case, ignore punctuation — and disagreed on
 * the detail, because two of them stripped punctuation from the text being searched but not
 * from the thing being typed. So "assassins" found *Assassin's Favour* and "assassin's" found
 * nothing, in a box whose whole promise is that you need not remember the apostrophe.
 *
 * Both sides are normalised here, which is the only version of "punctuation-insensitive" that
 * is true in both directions.
 */

/** Lowercase, and everything that is not a letter, a digit or a space removed. */
function bare(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9 ]/g, '');
}

/**
 * Does `haystack` contain `needle`, ignoring case and punctuation?
 *
 * An empty query matches everything: an empty search box is not a filter.
 */
export function looseIncludes(haystack: string, needle: string): boolean {
  const wanted = needle.trim();
  if (wanted === '') return true;
  return haystack.toLowerCase().includes(wanted.toLowerCase()) || bare(haystack).includes(bare(wanted));
}
