/**
 * Uniques. The whole point of this module is that a name is not a price, so most of these
 * tests are about the same name resolving to different numbers.
 */

import { describe, expect, it } from 'vitest';
import {
  linkCount,
  mergeUniqueOverview,
  pickCandidate,
  uniqueKey,
  type UniqueIndex,
  type UniquePrice,
} from '../src/services/uniques.ts';
import { iconUrl } from '../src/services/priceService.ts';
import { resolveUnique, valueTabs } from '../src/services/valuationService.ts';
import { uniqueArmourOverview } from './fixtures/poeninja.ts';

function index(): UniqueIndex {
  const into: UniqueIndex = Object.create(null) as UniqueIndex;
  mergeUniqueOverview(uniqueArmourOverview, into, iconUrl);
  return into;
}

/** GGG's socket shape: sockets sharing a `group` are linked to each other. */
function sockets(...groups: number[]) {
  return groups.map((group) => ({ group }));
}

describe('linkCount', () => {
  it('counts the largest linked group', () => {
    expect(linkCount(sockets(0, 0, 0, 0, 0, 0))).toBe(6);
    expect(linkCount(sockets(0, 0, 0, 0, 0, 1))).toBe(5);
  });

  it('reports anything under five as zero, because the market does not pay for it', () => {
    expect(linkCount(sockets(0, 0, 0, 0, 1, 1))).toBe(0);
    expect(linkCount(sockets(0, 1, 2))).toBe(0);
    expect(linkCount([])).toBe(0);
    expect(linkCount(undefined)).toBe(0);
  });

  it('ignores sockets with no usable group rather than counting them', () => {
    expect(linkCount([{ group: 0 }, { group: 0 }, { group: null }, { group: '0' }])).toBe(0);
  });
});

describe('uniqueKey', () => {
  it('leaves the ordinary case reading as just the name', () => {
    expect(uniqueKey('Headhunter', 0, false)).toBe('Headhunter');
  });

  it('spells out what makes this copy worth a different number', () => {
    expect(uniqueKey("Bronn's Lithe", 6, false)).toBe("Bronn's Lithe (6L)");
    expect(uniqueKey("Bronn's Lithe", 0, true)).toBe("Bronn's Lithe (corrupted)");
    expect(uniqueKey("Bronn's Lithe", 6, true)).toBe("Bronn's Lithe (6L, corrupted)");
  });
});

describe('mergeUniqueOverview', () => {
  it('keeps every line for a name instead of letting the first win', () => {
    expect(index()["Bronn's Lithe"]).toHaveLength(4);
  });

  it('normalises links under five to zero, matching poe.ninja', () => {
    const into: UniqueIndex = Object.create(null) as UniqueIndex;
    mergeUniqueOverview({ lines: [{ name: 'X', chaosValue: 1, links: 3 }] }, into, iconUrl);
    expect(into['X']?.[0]?.links).toBe(0);
  });

  it('drops a line with no usable price', () => {
    const into: UniqueIndex = Object.create(null) as UniqueIndex;
    mergeUniqueOverview({ lines: [{ name: 'X', chaosValue: null }] }, into, iconUrl);
    expect(into['X']).toBeUndefined();
  });

  it('validates icons through the same rule as everything else', () => {
    const into: UniqueIndex = Object.create(null) as UniqueIndex;
    mergeUniqueOverview(
      { lines: [{ name: 'X', chaosValue: 1, icon: 'javascript:alert(1)' }] },
      into,
      iconUrl,
    );
    expect(into['X']?.[0]?.icon).toBeNull();
  });
});

describe('pickCandidate', () => {
  const bronns = () => index()["Bronn's Lithe"] as UniquePrice[];

  it('matches links and corruption exactly when it can', () => {
    expect(pickCandidate(bronns(), 6, false)?.chaos).toBe(210.5);
    expect(pickCandidate(bronns(), 5, false)?.chaos).toBe(41);
    expect(pickCandidate(bronns(), 0, false)?.chaos).toBe(5.2);
    expect(pickCandidate(bronns(), 6, true)?.chaos).toBe(180);
  });

  it('falls back to the unlinked line rather than pricing at zero', () => {
    // No 5-link corrupted line exists; the 5-link one is the closer answer than nothing.
    expect(pickCandidate(bronns(), 5, true)?.chaos).toBe(41);
  });

  it('takes the cheapest when only an untellable variant separates the lines', () => {
    // Nothing in a stash payload says which Shavronne's this is. Overstating wealth shows up
    // as profit that was never made, so the low one wins.
    const shavs = index()["Shavronne's Wrappings"] as UniquePrice[];
    expect(pickCandidate(shavs, 0, false)?.chaos).toBe(30);
  });

  it('is null for a name with no lines', () => {
    expect(pickCandidate([], 6, false)).toBeNull();
  });
});

describe('resolveUnique', () => {
  const uniques = index();

  it('prices a 6-linked copy as a 6-linked copy', () => {
    const resolved = resolveUnique(
      { name: "Bronn's Lithe", frameType: 3, sockets: sockets(0, 0, 0, 0, 0, 0) },
      uniques,
    );
    expect(resolved).toEqual({ key: "Bronn's Lithe (6L)", chaos: 210.5 });
  });

  it('prices the same name unlinked as the far cheaper item it is', () => {
    const resolved = resolveUnique(
      { name: "Bronn's Lithe", frameType: 3, sockets: sockets(0, 1, 2, 3) },
      uniques,
    );
    expect(resolved).toEqual({ key: "Bronn's Lithe", chaos: 5.2 });
  });

  it('separates a corrupted copy from an uncorrupted one', () => {
    const resolved = resolveUnique(
      { name: "Bronn's Lithe", frameType: 3, corrupted: true, sockets: sockets(0, 0, 0, 0, 0, 0) },
      uniques,
    );
    expect(resolved).toEqual({ key: "Bronn's Lithe (6L, corrupted)", chaos: 180 });
  });

  it('strips GGG name markup before looking the name up', () => {
    const resolved = resolveUnique({ name: '<<set:MS>><<set:M>>Headhunter', frameType: 3 }, uniques);
    expect(resolved?.chaos).toBe(12500);
  });

  it('leaves non-uniques alone', () => {
    expect(resolveUnique({ name: 'Headhunter', frameType: 0 }, uniques)).toBeNull();
  });

  it('is null for a unique poe.ninja has never listed', () => {
    expect(resolveUnique({ name: 'Some Fated Thing', frameType: 3 }, uniques)).toBeNull();
  });
});

describe('valueTabs with uniques', () => {
  const options = { prices: { 'Chaos Orb': 1 }, divineRate: 200, minItemChaos: 2, uniques: index() };

  it('values the two Bronn\'s copies separately rather than as one line', () => {
    const result = valueTabs(
      [
        {
          tab: { name: 'Gear' },
          items: [
            { name: "Bronn's Lithe", frameType: 3, sockets: sockets(0, 0, 0, 0, 0, 0) },
            { name: "Bronn's Lithe", frameType: 3, sockets: sockets(0, 1, 2) },
          ],
        },
      ],
      options,
    );

    expect(result.breakdown['Gear']?.["Bronn's Lithe (6L)"]?.chaosTotal).toBe(210.5);
    expect(result.breakdown['Gear']?.["Bronn's Lithe"]?.chaosTotal).toBe(5.2);
    expect(result.totalChaos).toBe(215.7);
  });

  it('still refuses an unidentified unique, whose name says nothing about its worth', () => {
    const result = valueTabs(
      [
        {
          tab: { name: 'Gear' },
          items: [{ name: "Bronn's Lithe", frameType: 3, identified: false }],
        },
      ],
      options,
    );
    expect(result.skipped).toBe(1);
    expect(result.totalChaos).toBe(0);
  });

  it('reports a unique with no poe.ninja line as unresolved rather than as zero', () => {
    const result = valueTabs(
      [{ tab: { name: 'Gear' }, items: [{ name: 'Some Fated Thing', frameType: 3 }] }],
      options,
    );
    expect(result.unresolved).toEqual([{ name: 'Some Fated Thing', count: 1 }]);
  });

  it('prices uniques by name alone when no index is supplied, as before', () => {
    // Still the fallback path, now keyed through the id the flat map uses. It only fires when
    // the operator has opted uniques back in: the default leaves them unpriced, because without
    // `links` and `corrupted` the name does not say which variant this is.
    const result = valueTabs(
      [{ tab: { name: 'Gear' }, items: [{ name: 'Headhunter', frameType: 3 }] }],
      { prices: { headhunter: 9 }, divineRate: 200, minItemChaos: 2 },
    );
    expect(result.breakdown['Gear']?.['Headhunter']?.chaosTotal).toBe(9);
  });
});
