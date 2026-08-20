/**
 * Reading uniques for the disenchanting bench.
 *
 * The interesting cases are all about *not* inventing anything: quality that is a rendered
 * string rather than a number, an item level GGG did not send, and an unidentified unique that
 * has no name to look anything up by.
 */

import { describe, expect, it } from 'vitest';
import { dustFor } from '../src/services/dust.ts';
import { qualityOf, uniqueHoldings } from '../src/services/kingsmarch.ts';
import type { StashItem, TabContents } from '../src/services/stashService.ts';

const UNIQUE = 3;

function unique(over: Partial<StashItem> = {}): StashItem {
  return {
    frameType: UNIQUE,
    identified: true,
    name: 'Tabula Rasa',
    baseType: 'Simple Robe',
    ilvl: 68,
    ...over,
  };
}

function tab(name: string, items: StashItem[]): TabContents {
  return { tab: { name, index: 0, id: name, type: 'PremiumStash' }, items };
}

describe('qualityOf', () => {
  it('reads the number out of the rendered string', () => {
    expect(qualityOf(unique({ properties: [{ name: 'Quality', values: [['+20%', 1]] }] }))).toBe(20);
    expect(qualityOf(unique({ properties: [{ name: 'Quality', values: [['+7%', 1]] }] }))).toBe(7);
  });

  it('is zero when there is no quality, rather than null or a guess', () => {
    expect(qualityOf(unique())).toBe(0);
    expect(qualityOf(unique({ properties: [{ name: 'Map Tier', values: [['16', 0]] }] }))).toBe(0);
  });

  it('refuses anything it cannot parse', () => {
    // A display list is display formatting, not a data structure. Everything here is a shape
    // GGG could plausibly send, and none of it should become a number.
    expect(qualityOf(unique({ properties: [{ name: 'Quality', values: 'nope' }] }))).toBe(0);
    expect(qualityOf(unique({ properties: [{ name: 'Quality', values: [] }] }))).toBe(0);
    expect(qualityOf(unique({ properties: [{ name: 'Quality', values: [[null, 1]] }] }))).toBe(0);
    expect(qualityOf(unique({ properties: [{ name: 'Quality', values: [['++%', 1]] }] }))).toBe(0);
  });
});

describe('uniqueHoldings', () => {
  it('keeps what dust reads and where the item is', () => {
    const rows = uniqueHoldings([
      tab('Uniques', [unique({ properties: [{ name: 'Quality', values: [['+20%', 1]] }], corrupted: true })]),
    ]);

    expect(rows).toEqual([
      {
        name: 'Tabula Rasa',
        baseType: 'Simple Robe',
        tab: 'Uniques',
        ilvl: 68,
        quality: 20,
        corrupted: true,
        links: 0,
        icon: null,
        count: 1,
      },
    ]);
  });

  it('reads the largest linked group, because that is what the price turns on', () => {
    // GGG expresses links through `group`: sockets sharing a number are linked. Four in a row
    // is worth nothing extra on the market and normalises to 0, the same as poe.ninja's own
    // "links do not price this" — so a four-link and a plain item are one row here.
    const six = [0, 0, 0, 0, 0, 0].map((group) => ({ group }));
    const four = [0, 0, 0, 0].map((group) => ({ group }));

    expect(uniqueHoldings([tab('Uniques', [unique({ sockets: six })])])[0]?.links).toBe(6);
    expect(uniqueHoldings([tab('Uniques', [unique({ sockets: four })])])[0]?.links).toBe(0);
  });

  it('keeps a six-link apart from a plain one, because they are not the same decision', () => {
    const six = [0, 0, 0, 0, 0, 0].map((group) => ({ group }));
    const rows = uniqueHoldings([tab('Uniques', [unique(), unique({ sockets: six })])]);

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.links).sort()).toEqual([0, 6]);
  });

  it('groups copies that are identical to the bench', () => {
    const rows = uniqueHoldings([tab('Uniques', [unique(), unique(), unique()])]);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.count).toBe(3);
  });

  it('keeps copies apart when anything dust reads differs', () => {
    const rows = uniqueHoldings([
      tab('Uniques', [
        unique({ ilvl: 68 }),
        unique({ ilvl: 84 }),
        unique({ ilvl: 68, properties: [{ name: 'Quality', values: [['+20%', 1]] }] }),
        unique({ ilvl: 68, corrupted: true }),
      ]),
    ]);

    // Four different decisions at the bench, however identical they look on a wealth chart.
    expect(rows).toHaveLength(4);
    expect(rows.every((row) => row.count === 1)).toBe(true);
  });

  it('counts the same unique in two tabs separately, because it is in two places', () => {
    const rows = uniqueHoldings([tab('Uniques', [unique()]), tab('Dump', [unique()])]);

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.tab).sort()).toEqual(['Dump', 'Uniques']);
  });

  it('leaves out everything that is not an identified unique', () => {
    const rows = uniqueHoldings([
      tab('Mixed', [
        unique({ frameType: 0, name: 'Chaos Orb' }),
        unique({ identified: false, name: undefined }),
        // Unidentified uniques do carry a frameType, and nothing else to go on.
        unique({ identified: false }),
        unique(),
      ]),
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe('Tabula Rasa');
  });

  it('strips GGG\'s localisation markup, because every lookup after this is by name', () => {
    // What the stash actually sends for a unique. Carried through, it makes the dust table and
    // the price map miss on every single item — the whole view empty, and nothing to say why.
    const rows = uniqueHoldings([
      tab('Dump', [
        unique({ name: '<<set:MS>><<set:M>><<set:S>>Headhunter', baseType: '<<set:M>>Leather Belt' }),
      ]),
    ]);

    expect(rows[0]?.name).toBe('Headhunter');
    expect(rows[0]?.baseType).toBe('Leather Belt');
    expect(dustFor(rows[0]?.name ?? '', { ilvl: 84, quality: 0 })).not.toBeNull();
  });

  it('folds the marked-up name and the bare one into one row, being the same item', () => {
    const rows = uniqueHoldings([
      tab('Dump', [unique(), unique({ name: '<<set:MS>><<set:M>><<set:S>>Tabula Rasa' })]),
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.count).toBe(2);
  });

  it('reports a missing item level as missing rather than as zero', () => {
    // Zero is a real item level. "GGG did not say" is not, and a dust figure computed from a
    // level that was never sent would be a number with nothing behind it.
    const rows = uniqueHoldings([tab('Uniques', [unique({ ilvl: undefined })])]);

    expect(rows[0]?.ilvl).toBeNull();
  });

  it('puts the piles first', () => {
    const rows = uniqueHoldings([
      tab('Uniques', [unique({ name: 'Goldrim' }), unique(), unique(), unique()]),
    ]);

    expect(rows.map((row) => [row.name, row.count])).toEqual([
      ['Tabula Rasa', 3],
      ['Goldrim', 1],
    ]);
  });
});
