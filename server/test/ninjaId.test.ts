import { describe, expect, it } from 'vitest';
import { SHORT_CODES, ninjaId, slugify, verifyAliases } from '../src/services/ninjaId.ts';

describe('slugify', () => {
  it('matches the ids poe.ninja actually returned', () => {
    // Every expectation here is transcribed from a real response, not invented. The rule was
    // inferred from these, so they are the specification rather than examples of it.
    expect(slugify('Abandoned Wealth')).toBe('abandoned-wealth');
    expect(slugify('A Chilling Wind')).toBe('a-chilling-wind');
    expect(slugify('Alone in the Darkness')).toBe('alone-in-the-darkness');
    expect(slugify("Awakener's Orb")).toBe('awakeners-orb');
    expect(slugify("Bowyer's Dream")).toBe('bowyers-dream');
    expect(slugify('Brush, Paint and Palette')).toBe('brush-paint-and-palette');
    expect(slugify('Accelerating Catalyst')).toBe('accelerating-catalyst');
    expect(slugify('Exceptional Eldritch Ichor')).toBe('exceptional-eldritch-ichor');
    expect(slugify('Eldritch Orb of Annulment')).toBe('eldritch-orb-of-annulment');
  });

  it('drops apostrophes rather than turning them into separators', () => {
    // The distinction that matters: "Assassin's" is one word, so `assassins`, not `assassin-s`.
    expect(slugify("Assassin's Favour")).toBe('assassins-favour');
    expect(slugify('Assassin’s Favour')).toBe('assassins-favour');
  });

  it('never leaves a leading or trailing separator', () => {
    expect(slugify('  The Doctor  ')).toBe('the-doctor');
    expect(slugify('!!!')).toBe('');
  });

  it('collapses runs of punctuation into one separator', () => {
    expect(slugify('Fragment of the Phoenix')).toBe('fragment-of-the-phoenix');
    expect(slugify('The Beast — Reborn')).toBe('the-beast-reborn');
  });
});

describe('ninjaId', () => {
  it('uses the short code for currencies that have one', () => {
    // No transformation produces "alt" from "Orb of Alteration"; only the table can.
    expect(ninjaId('Orb of Alteration')).toBe('alt');
    expect(ninjaId('Chaos Orb')).toBe('chaos');
    expect(ninjaId('Divine Orb')).toBe('divine');
    expect(ninjaId('Orb of Annulment')).toBe('annul');
    expect(ninjaId("Glassblower's Bauble")).toBe('bauble');
  });

  it('falls back to the slug for everything else', () => {
    expect(ninjaId('Ancient Orb')).toBe('ancient-orb');
    expect(ninjaId("Awakener's Orb")).toBe('awakeners-orb');
    expect(ninjaId('The Doctor')).toBe('the-doctor');
  });

  it('trims before deciding, so a stray space does not miss the table', () => {
    expect(ninjaId('  Chaos Orb ')).toBe('chaos');
  });

  it('returns an empty id for an empty name rather than a bare hyphen', () => {
    expect(ninjaId('')).toBe('');
    expect(ninjaId('   ')).toBe('');
  });
});

describe('SHORT_CODES', () => {
  it('never maps two names onto one id', () => {
    // A duplicate would mean one of the two currencies silently takes the other's price.
    const ids = Object.values(SHORT_CODES);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('contains no entry that slugify would already produce', () => {
    // An unnecessary alias can only do harm: it overrides a rule that was already correct.
    for (const [name, id] of Object.entries(SHORT_CODES)) {
      expect(slugify(name), `${name} does not need an alias`).not.toBe(id);
    }
  });
});

describe('verifyAliases', () => {
  it('agrees with the two items poe.ninja still names', () => {
    // The only check available against live data, and worth running: chaos and divine are what
    // every other price is quoted in, so an error there would be an error everywhere.
    expect(
      verifyAliases([
        { id: 'chaos', name: 'Chaos Orb' },
        { id: 'divine', name: 'Divine Orb' },
      ]),
    ).toEqual([]);
  });

  it('reports a disagreement instead of trusting the table', () => {
    expect(verifyAliases([{ id: 'chaosorb', name: 'Chaos Orb' }])).toEqual([
      { name: 'Chaos Orb', expected: 'chaos', actual: 'chaosorb' },
    ]);
  });
});
