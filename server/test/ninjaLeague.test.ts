import { describe, expect, it } from 'vitest';
import { harvestLeagueNames, leagueParts, matchLeagueName } from '../src/services/ninjaLeague.ts';

describe('leagueParts', () => {
  it('strips GGG-style modifier words off the front', () => {
    expect(leagueParts('Hardcore Allflame')).toEqual({
      base: 'allflame',
      hardcore: true,
      ssf: false,
      ruthless: false,
    });
  });

  it('strips poe.ninja-style abbreviations off the end', () => {
    // The whole point of the base tier: "AllflameHC" and "Hardcore Allflame" are one league.
    expect(leagueParts('AllflameHC')).toEqual(leagueParts('Hardcore Allflame'));
  });

  it('reads both spellings of solo self-found', () => {
    expect(leagueParts('Allflame SSF').ssf).toBe(true);
    expect(leagueParts('Solo Self-Found').ssf).toBe(true);
  });

  it('peels off stacked abbreviations regardless of order', () => {
    const parts = leagueParts('AllflameHCSSF');
    expect(parts.base).toBe('allflame');
    expect(parts.hardcore).toBe(true);
    expect(parts.ssf).toBe(true);
  });

  it('ignores case and punctuation', () => {
    expect(leagueParts("Keepers of the Flame").base).toBe(leagueParts('keepersoftheflame').base);
  });
});

describe('harvestLeagueNames', () => {
  it('reads names out of the shape poe.ninja is believed to use', () => {
    const payload = {
      economyLeagues: [
        { name: 'Allflame', url: 'allflame', displayName: 'Allflame' },
        { name: 'AllflameHC', url: 'allflamehc' },
      ],
      oldEconomyLeagues: [{ name: 'Settlers' }],
    };
    expect(harvestLeagueNames(payload)).toContain('Allflame');
    expect(harvestLeagueNames(payload)).toContain('AllflameHC');
    expect(harvestLeagueNames(payload)).toContain('Settlers');
  });

  it('reads a shape it has never seen, because the endpoint is undocumented', () => {
    // Nesting, bare strings and a different key name all still yield candidates. If this ever
    // stops working the cost is a missed match, not a crash — which is why nothing here is
    // asserted against a schema.
    expect(harvestLeagueNames({ data: { pc: { leagues: ['Allflame', 'Standard'] } } })).toEqual([
      'Allflame',
      'Standard',
    ]);
  });

  it('skips anything that is plainly not a league name', () => {
    const names = harvestLeagueNames({
      lines: [
        { name: 'https://poe.ninja/allflame' },
        { name: '   ' },
        { name: 'x'.repeat(200) },
        { name: 'Standard' },
      ],
    });
    expect(names).toEqual(['Standard']);
  });

  it('survives a cycle without spinning', () => {
    const node: Record<string, unknown> = { name: 'Standard' };
    node.self = node;
    expect(harvestLeagueNames(node)).toEqual(['Standard']);
  });

  it('returns nothing rather than throwing on a payload that is not an object', () => {
    expect(harvestLeagueNames(null)).toEqual([]);
    expect(harvestLeagueNames('nope')).toEqual([]);
  });
});

describe('matchLeagueName', () => {
  it('prefers an exact match and does not look further', () => {
    expect(matchLeagueName('Standard', ['Standard', 'standard'])).toEqual({
      name: 'Standard',
      how: 'exact',
    });
  });

  it('falls back to case and then to punctuation', () => {
    expect(matchLeagueName('standard', ['Standard'])?.how).toBe('case');
    expect(matchLeagueName('Hardcore SSF', ['HardcoreSSF'])?.how).toBe('slug');
  });

  it("maps GGG's long name onto poe.ninja's short one", () => {
    // The case poe.ninja's own documentation describes: "Keepers of the Flame" is "Keepers".
    expect(matchLeagueName('Keepers of the Flame', ['Keepers', 'Standard'])).toEqual({
      name: 'Keepers',
      how: 'base',
    });
  });

  it("maps GGG's hardcore spelling onto poe.ninja's", () => {
    expect(matchLeagueName('Hardcore Allflame', ['Allflame', 'AllflameHC'])?.name).toBe(
      'AllflameHC',
    );
  });

  it('never crosses game modes, even when the base name matches', () => {
    // A silent wrong answer is worse than a loud 404: hardcore prices on a softcore stash
    // produce a wealth chart that is simply untrue and gives no sign of it.
    expect(matchLeagueName('Hardcore Allflame', ['Allflame'])).toBeNull();
    expect(matchLeagueName('Allflame', ['AllflameHC', 'AllflameSSF'])).toBeNull();
    expect(matchLeagueName('Allflame SSF', ['AllflameHC'])).toBeNull();
  });

  it('takes the longest candidate when several share a base', () => {
    expect(matchLeagueName('Allflame Ember', ['Allflame', 'Allflame Ember Event'])?.name).toBe(
      'Allflame Ember Event',
    );
  });

  it('refuses a base that merely overlaps rather than prefixes', () => {
    expect(matchLeagueName('Settlers', ['Kalguur'])).toBeNull();
  });

  it('returns null on an empty list rather than inventing a league', () => {
    expect(matchLeagueName('Allflame', [])).toBeNull();
    expect(matchLeagueName('   ', ['Standard'])).toBeNull();
  });
});
