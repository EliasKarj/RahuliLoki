/**
 * The picture a whole category shares, for rows that have no picture of their own.
 *
 * ## Why this exists
 *
 * poe.ninja's price payload carries no artwork. The app fills icons in from your own stash, so
 * an item you hold has its real art and an item you have only ever seen a price for has none —
 * which, in the economy list, is most of the page. Two endpoints and a `core.items` scan were
 * checked for a per-item source and all three came back empty; see docs/data.md.
 *
 * These are the fallbacks: GGG's own generic inventory art, served by path rather than by hash,
 * which is why they can be written down at all. They say *what kind of thing* a row is, not
 * which thing — every divination card gets the same card back.
 *
 * ## Why it is a display fallback and not a stored icon
 *
 * The row still says `icon: null`, and this is applied when drawing it. Writing a generic URL
 * into the icons map would make the data claim the item has that artwork, which it does not, and
 * it would then be indistinguishable from a real icon everywhere downstream — including in the
 * database, where it would outlive whatever this file says today.
 *
 * ## Adding to it
 *
 * One entry, because one is what has been confirmed against the live CDN. The rest of the paths
 * are guessable and guessing is how the last three attempts at this went wrong — `probe.mjs
 * --art` asks the CDN which candidates actually resolve, and entries earn their place by
 * appearing in that output.
 */

/** Category as poe.ninja names it → generic art on GGG's CDN. */
const CATEGORY_ICONS: Readonly<Record<string, string>> = {
  // The card back, at the 1×1 inventory size a card occupies. Same image poe.ninja itself uses.
  DivinationCard: 'https://web.poecdn.com/image/Art/2DItems/Divination/InventoryIcon.png?scale=1&w=1&h=1',
};

/**
 * The stand-in for this category, or undefined when there is none.
 *
 * Undefined rather than a placeholder image: a row with no known category should keep the empty
 * box it has now, which reads as "no picture" rather than as a picture of something wrong.
 */
export function categoryIcon(category: string | null): string | undefined {
  // `hasOwn` rather than a plain lookup: these strings come out of poe.ninja's payload, and a
  // category called "constructor" would otherwise hand back a function off Object.prototype.
  if (category === null || !Object.hasOwn(CATEGORY_ICONS, category)) return undefined;
  return CATEGORY_ICONS[category];
}
