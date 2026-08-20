/**
 * What the icon cell actually renders, in the three states it has.
 *
 * The economy list is mostly rows with no artwork of their own, so the fallback is not an edge
 * case there — it is the common case, and getting it wrong means either a blank page or a page
 * that shows every divination card as though the card back were its own art. Rendered to markup
 * rather than asserted on the props, because the bug worth catching is a fallback that quietly
 * stops reaching the `src` attribute.
 */

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ItemIcon } from '../src/components/ItemIcon.tsx';

const render = (element: React.ReactElement) => renderToStaticMarkup(element);

describe('ItemIcon', () => {
  it('draws the item\'s own artwork when it has some', () => {
    const html = render(<ItemIcon src="https://web.poecdn.com/divine.png" fallback="https://web.poecdn.com/generic.png" />);

    expect(html).toContain('src="https://web.poecdn.com/divine.png"');
    expect(html).not.toContain('generic.png');
  });

  it('falls back to the category picture when the item has none', () => {
    const html = render(<ItemIcon fallback="https://web.poecdn.com/generic.png" />);

    expect(html).toContain('src="https://web.poecdn.com/generic.png"');
  });

  it('dims the fallback, because it is not this item\'s picture', () => {
    // A category marker drawn at full strength reads as the item's own art. The distinction has
    // to survive into the markup or it does not exist.
    const own = render(<ItemIcon src="https://web.poecdn.com/divine.png" />);
    const stand = render(<ItemIcon fallback="https://web.poecdn.com/generic.png" />);

    expect(stand).toContain('opacity-40');
    expect(own).not.toContain('opacity-40');
  });

  it('draws nothing at all when there is neither, keeping the column aligned', () => {
    const html = render(<ItemIcon />);

    expect(html).not.toContain('<img');
    // The box stays, so a table of mostly-iconless rows does not jag left and right.
    expect(html).toContain('h-5 w-5');
  });

  it('never sends a referrer, fallback or not', () => {
    // The CDN has no business knowing which dashboard page linked it, and the fallback is a
    // request to the same CDN.
    expect(render(<ItemIcon fallback="https://web.poecdn.com/generic.png" />)).toContain('referrerPolicy="no-referrer"');
  });
});
