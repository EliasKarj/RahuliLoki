/**
 * The economy list.
 *
 * The thing worth testing here is not the arithmetic — it is that a name never claims more
 * certainty than it has. A slug reads back with its punctuation missing, and a row that said
 * "Awakener's Orb" when all it really knew was `awakeners-orb` would be inventing the
 * apostrophe.
 */

import { describe, expect, it } from 'vitest';
import {
  buildEconomy,
  namesFromBreakdown,
  reverseAliases,
  unslug,
} from '../src/services/economy.ts';

const prices = {
  divine: 217,
  'awakeners-orb': 42.5,
  alt: 0.12,
  gcp: 3,
  'the-doctor': 1450,
};

function build(known?: Map<string, string>) {
  return buildEconomy({
    prices,
    categories: { divine: 'Currency', alt: 'Currency', 'the-doctor': 'DivinationCard' },
    icons: { 'Divine Orb': 'https://web.poecdn.com/divine.png' },
    divineRate: 217,
    ...(known ? { known } : {}),
  });
}

describe('unslug', () => {
  it('reads a slug back as words', () => {
    expect(unslug('awakeners-orb')).toBe('Awakeners Orb');
    expect(unslug('the-doctor')).toBe('The Doctor');
  });

  it('leaves the small words the game leaves lowercase', () => {
    expect(unslug('brush-paint-and-palette')).toBe('Brush Paint and Palette');
    expect(unslug('orb-of-annulment')).toBe('Orb of Annulment');
  });

  it('does not capitalise a small word that starts the name', () => {
    expect(unslug('the-cloister')).toBe('The Cloister');
  });

  it('gives nothing back for nothing', () => {
    expect(unslug('')).toBe('');
    expect(unslug('---')).toBe('');
  });
});

describe('reverseAliases', () => {
  it('turns the short-code table over', () => {
    const aliases = reverseAliases();
    expect(aliases.get('gcp')).toBe("Gemcutter's Prism");
    expect(aliases.get('alt')).toBe('Orb of Alteration');
  });
});

describe('namesFromBreakdown', () => {
  it('keys the stash names by the id poe.ninja prices them under', () => {
    const known = namesFromBreakdown({
      Currency: { "Awakener's Orb": {}, 'Orb of Alteration': {} },
      Dump: { 'The Doctor': {} },
    });

    expect(known.get('awakeners-orb')).toBe("Awakener's Orb");
    expect(known.get('alt')).toBe('Orb of Alteration');
    expect(known.get('the-doctor')).toBe('The Doctor');
  });
});

describe('buildEconomy', () => {
  it('lists every priced id, most valuable first', () => {
    const rows = build();
    expect(rows.map((row) => row.id)).toEqual(['the-doctor', 'divine', 'awakeners-orb', 'gcp', 'alt']);
  });

  it('says where each name came from', () => {
    const rows = build();
    const byId = new Map(rows.map((row) => [row.id, row]));

    // From the alias table, so the apostrophe is real.
    expect(byId.get('gcp')).toMatchObject({ name: "Gemcutter's Prism", nameSource: 'alias' });
    // From the slug, so it is not — and the row says so rather than pretending.
    expect(byId.get('awakeners-orb')).toMatchObject({ name: 'Awakeners Orb', nameSource: 'slug' });
  });

  it('prefers a name the stash has proved over the slug reading of it', () => {
    const rows = build(new Map([['awakeners-orb', "Awakener's Orb"]]));
    const row = rows.find((entry) => entry.id === 'awakeners-orb');

    expect(row).toMatchObject({ name: "Awakener's Orb", nameSource: 'stash' });
  });

  it('carries the icon for a name it has one for, and null otherwise', () => {
    const rows = build();
    expect(rows.find((row) => row.id === 'divine')?.icon).toBe('https://web.poecdn.com/divine.png');
    expect(rows.find((row) => row.id === 'gcp')?.icon).toBeNull();
  });

  it('quotes each row in divine as well as chaos', () => {
    const row = build().find((entry) => entry.id === 'the-doctor');
    expect(row?.divine).toBeCloseTo(1450 / 217, 6);
  });

  it('leaves out a price that is not a usable number', () => {
    const rows = buildEconomy({
      prices: { good: 5, zero: 0, negative: -1, nonsense: Number.NaN },
      categories: {},
      icons: {},
      divineRate: 200,
    });

    expect(rows.map((row) => row.id)).toEqual(['good']);
  });

  it('does not divide by a divine rate it does not have', () => {
    const rows = buildEconomy({ prices: { alt: 1 }, categories: {}, icons: {}, divineRate: 0 });
    expect(rows[0]?.divine).toBe(0);
  });
});
