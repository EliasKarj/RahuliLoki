/**
 * Recorded poe.ninja payloads, trimmed to a handful of lines each but keeping the exact shape
 * the live API returns — including the fields we ignore, so a parser that reads the wrong key
 * fails here rather than in production.
 *
 * These are transcribed from real responses of the redesigned API at
 * `/poe1/api/economy/exchange/current/overview`. The old `/api/data/` endpoints these replaced
 * keyed every line by display name; nothing here does, which is the whole reason the valuation
 * path had to change. The mix of short codes (`alt`, `chaos`) and slugs (`ancient-orb`) in the
 * currency fixture is not tidied up — it is exactly what the live API sends, and it is the case
 * the alias table exists to handle.
 */

const CHAOS_IMAGE =
  '/gen/image/WzI1LDE0LHsiZiI6IjJESXRlbXMvQ3VycmVuY3kvQ3VycmVuY3lSZXJvbGxSYXJlIiwic2NhbGUiOjF9XQ/46a2347805/CurrencyRerollRare.png';
const DIVINE_IMAGE =
  '/gen/image/WzI1LDE0LHsiZiI6IjJESXRlbXMvQ3VycmVuY3kvQ3VycmVuY3lNb2RWYWx1ZXMiLCJzY2FsZSI6MX1d/ec48896769/CurrencyModValues.png';

/** The pricing pair. Present on every overview, and the only items the API still names. */
export const core = {
  items: [
    {
      id: 'chaos',
      name: 'Chaos Orb',
      image: CHAOS_IMAGE,
      category: 'Currency',
      detailsId: 'chaos-orb',
    },
    {
      id: 'divine',
      name: 'Divine Orb',
      image: DIVINE_IMAGE,
      category: 'Currency',
      detailsId: 'divine-orb',
    },
  ],
  // Divine per chaos — the inverse of the rate this app reports.
  rates: { divine: 0.00508 },
  primary: 'chaos',
  secondary: 'divine',
};

export const currencyOverview = {
  core,
  lines: [
    {
      id: 'chaos',
      primaryValue: 1,
      volumePrimaryValue: 19156804,
      maxVolumeCurrency: 'divine',
      maxVolumeRate: 196.9,
      sparkline: { totalChange: 7.14, data: [2.59, 6.65, 7.14] },
    },
    { id: 'divine', primaryValue: 196.9, volumePrimaryValue: 19156804, maxVolumeCurrency: 'chaos' },
    // A short code no rule produces from "Orb of Alteration".
    { id: 'alt', primaryValue: 0.1238, volumePrimaryValue: 97366 },
    { id: 'exalted', primaryValue: 1.63 },
    { id: 'annul', primaryValue: 11.14 },
    // A slug, in the same payload as the short codes above.
    { id: 'ancient-orb', primaryValue: 8.27 },
    { id: 'awakeners-orb', primaryValue: 453.8 },
    // Lines with no usable value do occur early in a league, before there is a market.
    { id: 'mirror', primaryValue: null },
  ],
};

export const fragmentOverview = {
  core,
  lines: [
    { id: 'sacrifice-at-dusk', primaryValue: 3.4 },
    { id: 'fragment-of-the-phoenix', primaryValue: 12.5 },
  ],
};

export const divinationCardOverview = {
  core,
  lines: [
    {
      id: 'the-doctor',
      primaryValue: 1450.5,
      volumePrimaryValue: 120,
      maxVolumeCurrency: 'divine',
      sparkline: { totalChange: -6.25, data: [-7.92, -6.25] },
    },
    { id: 'rain-of-chaos', primaryValue: 0.3 },
    // Apostrophe dropped rather than hyphenated — the rule `slugify` has to match.
    { id: 'assassins-favour', primaryValue: 1 },
    { id: 'brush-paint-and-palette', primaryValue: 8.23 },
  ],
};

export const scarabOverview = {
  core,
  lines: [
    { id: 'gilded-bestiary-scarab', primaryValue: 88.2 },
    { id: 'rusted-cartography-scarab', primaryValue: 1.1 },
  ],
};

/**
 * A unique overview. The point of this fixture is the same name appearing several times with
 * different `links` and `corrupted` — which is exactly why uniques cannot be keyed by name.
 */
export const uniqueArmourOverview = {
  lines: [
    {
      id: 100,
      name: "Bronn's Lithe",
      baseType: 'Cutthroat\'s Garb',
      icon: 'https://web.poecdn.com/bronns.png',
      links: 0,
      chaosValue: 5.2,
      variant: null,
    },
    { id: 101, name: "Bronn's Lithe", links: 5, chaosValue: 41, icon: 'https://web.poecdn.com/bronns.png' },
    { id: 102, name: "Bronn's Lithe", links: 6, chaosValue: 210.5, icon: 'https://web.poecdn.com/bronns.png' },
    {
      id: 103,
      name: "Bronn's Lithe",
      links: 6,
      corrupted: true,
      chaosValue: 180,
      icon: 'https://web.poecdn.com/bronns.png',
    },
    // No links anywhere on it; a belt cannot have any.
    { id: 110, name: 'Headhunter', links: 0, chaosValue: 12500, icon: 'https://web.poecdn.com/hh.png' },
    // Two variants of one name, indistinguishable from stash data. The cheaper must win.
    { id: 120, name: "Shavronne's Wrappings", links: 0, variant: 'Pre 3.0.0', chaosValue: 900 },
    { id: 121, name: "Shavronne's Wrappings", links: 0, variant: 'Current', chaosValue: 30 },
  ],
};

/** poe.ninja answers 200 with an empty `lines` array for a category it has no data for. */
export const emptyOverview = { core, lines: [] };

/** No `core` at all — the shape a response takes if poe.ninja changes its mind again. */
export const bareOverview = { lines: [{ id: 'chaos', primaryValue: 1 }] };

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
