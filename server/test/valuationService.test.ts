import { describe, expect, it } from 'vitest';
import {
  priceKeyCandidates,
  resolvePriceKey,
  skipReason,
  stripNameMarkup,
  tabTotals,
  topItems,
  valueTabs,
  type ValuationInput,
} from '../src/services/valuationService.ts';
import { dumpTabResponse, mapTabResponse, tabListResponse } from './fixtures/stash.ts';

const prices: Record<string, number> = {
  'Chaos Orb': 1,
  'Divine Orb': 218.4,
  'Orb of Alteration': 0.12,
  'The Doctor': 1450.5,
  Headhunter: 5000,
  'Gilded Bestiary Scarab': 88.2,
  'Leather Belt': 0.5,
};

const tabs: ValuationInput[] = [
  { tab: { name: 'Currency' }, items: tabListResponse.items },
  { tab: { name: 'Dump' }, items: dumpTabResponse.items },
  { tab: { name: 'Maps' }, items: mapTabResponse.items },
];

const options = { prices, divineRate: 218.4, minItemChaos: 2 };

describe('stripNameMarkup', () => {
  it('removes the set markup GGG prefixes names with', () => {
    expect(stripNameMarkup('<<set:MS>><<set:M>><<set:S>>Divine Orb')).toBe('Divine Orb');
  });

  it('leaves a plain name alone', () => {
    expect(stripNameMarkup('Chaos Orb')).toBe('Chaos Orb');
  });
});

describe('priceKeyCandidates', () => {
  it('leads with the unique name so a Headhunter is not valued as its base', () => {
    const item = { name: 'Headhunter', typeLine: 'Leather Belt', baseType: 'Leather Belt', frameType: 3 };
    expect(priceKeyCandidates(item)[0]).toBe('Headhunter');
  });

  it('leads with the base type for stackable currency', () => {
    expect(priceKeyCandidates({ typeLine: 'Chaos Orb', baseType: 'Chaos Orb', frameType: 5 })).toEqual([
      'Chaos Orb',
    ]);
  });

  it('leads with the type line for a divination card', () => {
    expect(priceKeyCandidates({ typeLine: 'The Doctor', frameType: 6 })[0]).toBe('The Doctor');
  });
});

describe('skipReason', () => {
  it('skips gems, whose price depends on level and quality', () => {
    expect(skipReason({ typeLine: 'Awakened Multistrike Support', frameType: 4 })).toBe('gem');
  });

  it('skips maps, whose price depends on tier', () => {
    expect(skipReason({ typeLine: 'Beach Map', baseType: 'Beach Map', frameType: 0 })).toBe('map');
  });

  it('skips cluster jewels, whose price depends on the passives rolled', () => {
    expect(skipReason({ baseType: 'Large Cluster Jewel', frameType: 2 })).toBe('cluster-jewel');
  });

  it('skips unidentified uniques, which cannot be named yet', () => {
    expect(skipReason({ typeLine: 'Leather Belt', frameType: 3, identified: false })).toBe(
      'unidentified-unique',
    );
  });

  it('prices ordinary currency', () => {
    expect(skipReason({ typeLine: 'Chaos Orb', baseType: 'Chaos Orb', frameType: 5 })).toBeNull();
  });
});

describe('resolvePriceKey', () => {
  it('resolves through the markup prefix', () => {
    const item = { typeLine: '<<set:MS>><<set:M>><<set:S>>Divine Orb', baseType: 'Divine Orb', frameType: 5 };
    expect(resolvePriceKey(item, prices)).toBe('Divine Orb');
  });

  it('returns null rather than a wrong price when nothing matches', () => {
    expect(resolvePriceKey({ typeLine: 'Fractured Fossil Prototype', frameType: 0 }, prices)).toBeNull();
  });

  it('falls through to the base type when the unique itself is unpriced', () => {
    const item = { name: 'Some Unlisted Unique', baseType: 'Leather Belt', frameType: 3 };
    expect(resolvePriceKey(item, prices)).toBe('Leather Belt');
  });
});

describe('valueTabs', () => {
  it('multiplies price by stack size', () => {
    const result = valueTabs(tabs, options);
    expect(result.breakdown.Currency?.['Divine Orb']).toEqual({
      qty: 12,
      chaosEach: 218.4,
      chaosTotal: 2620.8,
    });
  });

  it('totals chaos across every tab', () => {
    const result = valueTabs(tabs, options);
    // 250 chaos + 12 divine + 900 alts + 2 Doctors + Headhunter + 3 scarabs.
    expect(result.totalChaos).toBeCloseTo(250 + 2620.8 + 108 + 2901 + 5000 + 264.6, 2);
  });

  it('derives the divine total from the rate at snapshot time', () => {
    const result = valueTabs(tabs, options);
    expect(result.totalDivine).toBeCloseTo(result.totalChaos / 218.4, 2);
  });

  it('reports zero divine rather than infinity when the rate is missing', () => {
    expect(valueTabs(tabs, { ...options, divineRate: 0 }).totalDivine).toBe(0);
  });

  it('keeps a big pile of cheap currency, which is real wealth', () => {
    // 900 alterations at 0.12 is 108 chaos, even though each one is under the threshold.
    expect(valueTabs(tabs, options).breakdown.Currency?.['Orb of Alteration']?.chaosTotal).toBe(108);
  });

  it('drops an aggregate below the threshold', () => {
    const result = valueTabs(
      [{ tab: { name: 'Currency' }, items: [{ typeLine: 'Orb of Alteration', baseType: 'Orb of Alteration', stackSize: 5, frameType: 5 }] }],
      options,
    );
    expect(result.breakdown.Currency).toEqual({});
    expect(result.droppedBelowThreshold).toBe(1);
    expect(result.droppedChaos).toBe(0.6);
  });

  it('aggregates split stacks before applying the threshold', () => {
    const split = Array.from({ length: 10 }, () => ({
      typeLine: 'Orb of Alteration',
      baseType: 'Orb of Alteration',
      stackSize: 5,
      frameType: 5,
    }));
    const result = valueTabs([{ tab: { name: 'Currency' }, items: split }], options);
    expect(result.breakdown.Currency?.['Orb of Alteration']?.qty).toBe(50);
    expect(result.droppedBelowThreshold).toBe(0);
  });

  it('counts units, so a stack of 250 chaos is 250 items', () => {
    const result = valueTabs([{ tab: { name: 'Currency' }, items: tabListResponse.items }], options);
    expect(result.itemCount).toBe(250 + 12 + 900);
  });

  it('skips gems and maps instead of mispricing them', () => {
    const result = valueTabs(tabs, options);
    expect(result.skipped).toBe(2);
    expect(result.breakdown.Maps).toEqual({});
  });

  it('reports every unresolved name so the gap is visible', () => {
    const result = valueTabs(tabs, options);
    expect(result.unresolved).toEqual([{ name: 'Fractured Fossil Prototype', count: 1 }]);
  });

  it('counts repeats of the same unresolved name together', () => {
    const items = Array.from({ length: 3 }, () => ({ typeLine: 'Mystery Item', frameType: 0 }));
    const result = valueTabs([{ tab: { name: 'Dump' }, items }], options);
    expect(result.unresolved).toEqual([{ name: 'Mystery Item', count: 3 }]);
  });

  it('keeps an empty tracked tab in the breakdown so the stacked area keeps its shape', () => {
    const result = valueTabs([{ tab: { name: 'Empty' }, items: [] }], options);
    expect(result.breakdown).toEqual({ Empty: {} });
  });

  it('treats a missing stack size as one item', () => {
    const result = valueTabs(
      [{ tab: { name: 'Dump' }, items: [{ name: 'Headhunter', baseType: 'Leather Belt', frameType: 3 }] }],
      options,
    );
    expect(result.breakdown.Dump?.Headhunter?.qty).toBe(1);
  });

  it('ignores a nonsensical stack size instead of producing NaN', () => {
    const result = valueTabs(
      [
        {
          tab: { name: 'Currency' },
          items: [{ typeLine: 'Chaos Orb', baseType: 'Chaos Orb', stackSize: Number.NaN, frameType: 5 }],
        },
      ],
      { ...options, minItemChaos: 0 },
    );
    expect(result.breakdown.Currency?.['Chaos Orb']?.qty).toBe(1);
    expect(result.totalChaos).toBe(1);
  });
});

describe('tabTotals', () => {
  it('sums each tab for the stacked area chart', () => {
    const { breakdown } = valueTabs(tabs, options);
    const totals = tabTotals(breakdown);
    expect(totals.Currency).toBeCloseTo(250 + 2620.8 + 108, 2);
    expect(totals.Maps).toBe(0);
  });
});

describe('topItems', () => {
  it('ranks the latest holdings by chaos value across tabs', () => {
    const { breakdown } = valueTabs(tabs, options);
    const rows = topItems(breakdown, 3);
    expect(rows.map((row) => row.name)).toEqual(['Headhunter', 'The Doctor', 'Divine Orb']);
    expect(rows[0]?.tab).toBe('Dump');
  });

  it('respects the limit', () => {
    const { breakdown } = valueTabs(tabs, options);
    expect(topItems(breakdown, 2)).toHaveLength(2);
  });
});
