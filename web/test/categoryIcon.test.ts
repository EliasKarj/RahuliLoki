/**
 * The stand-in art, and the two things it must not become.
 *
 * It must not claim to be the item's own picture, and it must not be a URL from somewhere other
 * than GGG's CDN — these go straight into an `<img src>`, and the page's CSP allows exactly two
 * hosts. A typo here would be invisible until the image silently failed to load.
 */

import { describe, expect, it } from 'vitest';
import { borrowedCategories, categoryIcon, donorIcons, fallbackIcon } from '../src/lib/categoryIcon.ts';

describe('categoryIcon', () => {
  it('has art for divination cards, which is the category with no per-item source', () => {
    expect(categoryIcon('DivinationCard')).toContain('web.poecdn.com');
  });

  it('serves everything from the CDN the page is allowed to load from', () => {
    // The CSP allows web.poecdn.com and poe.ninja. Anything else is a request the browser will
    // refuse, and the row would go back to being blank with no clue why.
    for (const category of ['DivinationCard', 'Currency', 'Fragment', 'Essence', 'Oil']) {
      const url = new URL(categoryIcon(category) as string);
      expect(url.protocol).toBe('https:');
      expect(url.hostname).toBe('web.poecdn.com');
    }
  });

  it('gives nothing rather than a placeholder for a category it does not know', () => {
    // An empty box reads as "no picture". A picture of the wrong kind of thing reads as a fact.
    // Scarab, Fossil, Tattoo and the rest 404 on every path tried, so they stay blank.
    expect(categoryIcon('Scarab')).toBeUndefined();
    expect(categoryIcon('Tattoo')).toBeUndefined();
    expect(categoryIcon(null)).toBeUndefined();
  });

  it('knows which of its entries are another item\'s art rather than the category\'s', () => {
    // Recorded so the placeholders can be told from the finished ones. Four of the five stand in
    // with a specific item's picture because no generic art for their kind was found: currency
    // shows a Chaos Orb, essences one essence. Only the card back is art for the kind itself.
    expect(borrowedCategories()).toEqual(['Currency', 'Essence', 'Fragment', 'Oil']);
    expect(borrowedCategories()).not.toContain('DivinationCard');
  });

  it('is not fooled by a category named like something on Object.prototype', () => {
    // The keys are category strings out of a remote payload.
    expect(categoryIcon('constructor')).toBeUndefined();
    expect(categoryIcon('toString')).toBeUndefined();
  });
});

/**
 * Artwork borrowed from the list itself, which is the fallback that costs nothing and guesses
 * nothing. Every item the player holds arrives with its real art from the stash, so a category
 * with one illustrated row can illustrate the rest of that category without a CDN path being
 * written down anywhere.
 */
describe('donorIcons', () => {
  const rows = [
    { id: 'deafening-essence-of-greed', category: 'Essence', icon: 'https://web.poecdn.com/greed.png' },
    { id: 'abrasive-catalyst', category: 'Currency', icon: null },
    { id: 'chaos-orb', category: 'Currency', icon: 'https://web.poecdn.com/chaos.png' },
    { id: 'screaming-essence-of-woe', category: 'Essence', icon: 'https://web.poecdn.com/woe.png' },
    { id: 'gilded-bestiary-scarab', category: 'Scarab', icon: null },
    { id: 'orphaned', category: null, icon: 'https://web.poecdn.com/orphan.png' },
  ];

  it('finds a picture for every category that has one anywhere in the list', () => {
    expect(donorIcons(rows)).toEqual({
      Essence: 'https://web.poecdn.com/greed.png',
      Currency: 'https://web.poecdn.com/chaos.png',
    });
  });

  it('offers nothing for a category where no row has art', () => {
    // Scarab has a row, but no artwork on it, so there is nothing to lend.
    expect(donorIcons(rows).Scarab).toBeUndefined();
  });

  it('picks by id, so the picture does not change when prices move', () => {
    // The obvious donor is "the most valuable" or "the first on screen", and both of those
    // reshuffle every time the market does. An icon that changes for no reason the reader can
    // see is worse than no icon.
    const reordered = [...rows].reverse();

    expect(donorIcons(reordered)).toEqual(donorIcons(rows));
  });

  it('ignores a row with no category, having nowhere to file it', () => {
    expect(Object.values(donorIcons(rows))).not.toContain('https://web.poecdn.com/orphan.png');
  });
});

describe('fallbackIcon', () => {
  const donors = { Currency: 'https://web.poecdn.com/chaos.png', DivinationCard: 'https://web.poecdn.com/doctor.png' };

  it('prefers a real row from the list over the hardcoded stand-in', () => {
    // The table's Currency entry is a Chaos Orb guessed at from a CDN path. A donor is art for
    // something actually priced in this league, which is the better of the two.
    expect(fallbackIcon('Currency', donors)).toBe('https://web.poecdn.com/chaos.png');
  });

  it('keeps the card back for divination cards, which no single card improves on', () => {
    // The one category where the generic art beats any member: the back is what every card
    // shares, and The Doctor's art would claim the row is The Doctor.
    expect(fallbackIcon('DivinationCard', donors)).toContain('Divination/InventoryIcon.png');
  });

  it('falls through to the table when the list has nothing to lend', () => {
    expect(fallbackIcon('Essence', {})).toContain('Greed7.png');
  });

  it('gives nothing when neither has anything', () => {
    expect(fallbackIcon('Tattoo', {})).toBeUndefined();
    expect(fallbackIcon(null, donors)).toBeUndefined();
  });
});

describe('fallbackIcon, on the rule rather than the category name', () => {
  it('lets a donor replace every borrowed entry, and no generic one', () => {
    // The preference is driven by what the table records about each entry, not by naming a
    // category in the code. Add a generic entry tomorrow and it wins without an edit here;
    // confirm real art for a borrowed one and it stops being overridable the same way.
    const donors = Object.fromEntries(
      [...borrowedCategories(), 'DivinationCard'].map((category) => [category, `https://web.poecdn.com/${category}.png`]),
    );

    for (const category of borrowedCategories()) {
      expect(fallbackIcon(category, donors)).toBe(`https://web.poecdn.com/${category}.png`);
    }
    expect(fallbackIcon('DivinationCard', donors)).toContain('Divination/InventoryIcon.png');
  });
});
