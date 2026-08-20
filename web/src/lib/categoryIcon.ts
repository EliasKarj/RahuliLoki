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

/**
 * A picture per category, taken from the rows themselves.
 *
 * This is the better half of the fallback and it needs no table at all. The list on screen
 * already contains real artwork for every item the player holds — the app fills those in from
 * the stash — so a category with even one illustrated row has a picture available for the rest
 * of that category, at no cost and with no guessed CDN path behind it. A stash with essences in
 * it illustrates every essence row; a stash with scarabs illustrates every scarab row.
 *
 * The donor is the lowest id in the category that has art, rather than the most valuable or the
 * first on screen. Both of those move when prices move, and an icon that changes as the market
 * shifts is a distraction pretending to be information.
 */
export function donorIcons(
  rows: ReadonlyArray<{ id: string; category: string | null; icon: string | null }>,
): Record<string, string> {
  // Null-prototype: the keys are category strings out of a remote payload.
  const best = Object.create(null) as Record<string, { id: string; icon: string }>;

  for (const row of rows) {
    if (row.category === null || row.icon === null) continue;
    const held = best[row.category];
    if (held === undefined || row.id < held.id) best[row.category] = { id: row.id, icon: row.icon };
  }

  const out = Object.create(null) as Record<string, string>;
  for (const category of Object.keys(best)) out[category] = best[category]?.icon as string;
  return out;
}

/**
 * The picture to stand in for this category: a real row's art first, the table second.
 *
 * A donor beats the table even where the table has a generic entry, because a donor is art for
 * something that is genuinely in this category and in this league, while the table is a fixed
 * guess made somewhere else. The exception would be a category whose generic art is better than
 * any single member — divination cards, whose back is the whole point — and that is why the card
 * back is checked for first.
 */
export function fallbackIcon(
  category: string | null,
  donors: Record<string, string>,
): string | undefined {
  if (category === null) return undefined;

  // Art for the kind wins outright — the card back is what every card shares, and no single card
  // improves on it. Everything else in the table is one item's art guessed at from a CDN path,
  // and a donor beats that: it is art for something genuinely priced in this league, and it
  // needed no path written down anywhere.
  const table = Object.hasOwn(CATEGORY_ICONS, category) ? CATEGORY_ICONS[category] : undefined;
  if (table?.kind === 'generic') return table.url;
  if (Object.hasOwn(donors, category)) return donors[category];
  return table?.url;
}

/** Which categories are still standing in with another item's art. Read by the tests. */
export function borrowedCategories(): string[] {
  return Object.entries(CATEGORY_ICONS)
    .filter(([, art]) => art.kind === 'borrowed')
    .map(([category]) => category)
    .sort();
}
