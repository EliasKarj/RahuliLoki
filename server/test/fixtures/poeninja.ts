/**
 * Recorded poe.ninja payloads, trimmed to a handful of lines each but keeping the exact shape
 * the live API returns — including the fields we ignore, so a parser that reads the wrong key
 * fails here rather than in production.
 */

export const currencyOverview = {
  lines: [
    {
      currencyTypeName: 'Divine Orb',
      pay: { id: 1, league_id: 1, pay_currency_id: 1, get_currency_id: 2, value: 0.0045 },
      receive: { id: 2, value: 215.5, count: 42 },
      chaosEquivalent: 218.4,
      detailsId: 'divine-orb',
    },
    {
      currencyTypeName: 'Orb of Alteration',
      chaosEquivalent: 0.12,
      detailsId: 'orb-of-alteration',
    },
    {
      currencyTypeName: 'Exalted Orb',
      chaosEquivalent: 42.6,
      detailsId: 'exalted-orb',
    },
    {
      currencyTypeName: 'Orb of Annulment',
      chaosEquivalent: 9.1,
      detailsId: 'orb-of-annulment',
    },
    // Lines with a null value do occur early in a league, before there is a market.
    { currencyTypeName: 'Mirror of Kalandra', chaosEquivalent: null, detailsId: 'mirror-of-kalandra' },
  ],
  currencyDetails: [
    { id: 1, name: 'Divine Orb', icon: 'https://web.poecdn.com/divine.png', tradeId: 'divine' },
  ],
};

export const fragmentOverview = {
  lines: [
    { currencyTypeName: 'Sacrifice at Dusk', chaosEquivalent: 3.4, detailsId: 'sacrifice-at-dusk' },
    { currencyTypeName: 'Fragment of the Phoenix', chaosEquivalent: 12.5, detailsId: 'phoenix' },
  ],
  currencyDetails: [],
};

export const divinationCardOverview = {
  lines: [
    {
      id: 900,
      name: 'The Doctor',
      icon: 'https://web.poecdn.com/doctor.png',
      stackSize: 8,
      chaosValue: 1450.5,
      divineValue: 6.64,
      count: 120,
      listingCount: 340,
    },
    {
      id: 901,
      name: 'Rain of Chaos',
      chaosValue: 0.3,
      divineValue: 0.001,
      count: 900,
      listingCount: 1200,
    },
  ],
};

export const scarabOverview = {
  lines: [
    { id: 700, name: 'Gilded Bestiary Scarab', chaosValue: 88.2, divineValue: 0.4 },
    { id: 701, name: 'Rusted Cartography Scarab', chaosValue: 1.1, divineValue: 0.005 },
  ],
};

/** poe.ninja answers 200 with an empty `lines` array for a league it has never heard of. */
export const emptyOverview = { lines: [] };

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
