/**
 * The stand-in art, and the two things it must not become.
 *
 * It must not claim to be the item's own picture, and it must not be a URL from somewhere other
 * than GGG's CDN — these go straight into an `<img src>`, and the page's CSP allows exactly two
 * hosts. A typo here would be invisible until the image silently failed to load.
 */

import { describe, expect, it } from 'vitest';
import { categoryIcon } from '../src/lib/categoryIcon.ts';

describe('categoryIcon', () => {
  it('has art for divination cards, which is the category with no per-item source', () => {
    expect(categoryIcon('DivinationCard')).toContain('web.poecdn.com');
  });

  it('serves everything from the CDN the page is allowed to load from', () => {
    // The CSP allows web.poecdn.com and poe.ninja. Anything else is a request the browser will
    // refuse, and the row would go back to being blank with no clue why.
    for (const category of ['DivinationCard']) {
      const url = new URL(categoryIcon(category) as string);
      expect(url.protocol).toBe('https:');
      expect(url.hostname).toBe('web.poecdn.com');
    }
  });

  it('gives nothing rather than a placeholder for a category it does not know', () => {
    // An empty box reads as "no picture". A picture of the wrong kind of thing reads as a fact.
    expect(categoryIcon('Scarab')).toBeUndefined();
    expect(categoryIcon('Currency')).toBeUndefined();
    expect(categoryIcon(null)).toBeUndefined();
  });

  it('is not fooled by a category named like something on Object.prototype', () => {
    // The keys are category strings out of a remote payload.
    expect(categoryIcon('constructor')).toBeUndefined();
    expect(categoryIcon('toString')).toBeUndefined();
  });
});
