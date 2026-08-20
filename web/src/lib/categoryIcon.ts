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
 * ## Two kinds of entry, and why the difference is recorded
 *
 * `generic` art is art GGG drew to stand for a whole kind — the divination card back is one, and
 * it is honest in a way nothing else here is. `borrowed` art is one specific item's picture used
 * as a marker for its category, because no generic art was found: a Chaos Orb for currency, one
 * essence for essences. Every one of these was confirmed against the live CDN by
 * `probe.mjs --art`; the ones that 404 are simply absent rather than guessed at.
 *
 * The distinction does not survive onto the screen — both are drawn the same, dimmed — but it is
 * kept here because it is the thing that decides what to do next. A borrowed entry is a
 * placeholder waiting for real category art to turn up; a generic one is finished.
 */

interface CategoryArt {
  url: string;
  /**
   * `generic` is art for the kind. `borrowed` is one item's art standing in for its category,
   * which is weaker and is meant to be replaced if generic art is ever found.
   */
  kind: 'generic' | 'borrowed';
}

/** Category as poe.ninja names it → art on GGG's CDN, confirmed by probe.mjs --art. */
const CATEGORY_ICONS: Readonly<Record<string, CategoryArt>> = {
  // The card back, at the 1×1 inventory size a card occupies. The same image poe.ninja uses.
  DivinationCard: {
    url: 'https://web.poecdn.com/image/Art/2DItems/Divination/InventoryIcon.png?scale=1&w=1&h=1',
    kind: 'generic',
  },
  // A Chaos Orb. Not what most currency rows are, and drawn dimmed for exactly that reason.
  Currency: {
    url: 'https://web.poecdn.com/image/Art/2DItems/Currency/CurrencyRerollRare.png?scale=1&w=1&h=1',
    kind: 'borrowed',
  },
  // One Vaal fragment.
  Fragment: {
    url: 'https://web.poecdn.com/image/Art/2DItems/Maps/Vaal01.png?scale=1&w=1&h=1',
    kind: 'borrowed',
  },
  // Deafening Essence of Greed.
  Essence: {
    url: 'https://web.poecdn.com/image/Art/2DItems/Currency/Essence/Greed7.png?scale=1&w=1&h=1',
    kind: 'borrowed',
  },
  // Golden Oil.
  Oil: {
    url: 'https://web.poecdn.com/image/Art/2DItems/Currency/Oils/GoldenOil.png?scale=1&w=1&h=1',
    kind: 'borrowed',
  },
};

/**
 * The stand-in for this category, or undefined when there is none.
 *
 * Undefined rather than a placeholder image: a row whose category has no confirmed art should
 * keep the empty box, which reads as "no picture" rather than as a picture of something wrong.
 */
export function categoryIcon(category: string | null): string | undefined {
  // `hasOwn` rather than a plain lookup: these strings come out of poe.ninja's payload, and a
  // category called "constructor" would otherwise hand back a function off Object.prototype.
  if (category === null || !Object.hasOwn(CATEGORY_ICONS, category)) return undefined;
  return CATEGORY_ICONS[category]?.url;
}

/** Which categories are still standing in with another item's art. Read by the tests. */
export function borrowedCategories(): string[] {
  return Object.entries(CATEGORY_ICONS)
    .filter(([, art]) => art.kind === 'borrowed')
    .map(([category]) => category)
    .sort();
}
