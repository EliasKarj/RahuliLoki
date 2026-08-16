/**
 * Turning an item's display name into the identifier poe.ninja prices it under.
 *
 * The old API keyed every line by display name — `"currencyTypeName": "Orb of Alteration"` —
 * so a stash item's name was the lookup key and no translation existed. The redesigned API
 * carries no names at all. A line is `{ "id": "alt", "primaryValue": 0.1238 }` and nothing in
 * the payload says what `alt` is; the website knows because the names are baked into its own
 * JavaScript, which is not something we can consume.
 *
 * So the mapping has to live here, and it has to run *from* the name *to* the id. The other
 * direction is not recoverable: `assassins-favour` cannot be turned back into "Assassin's
 * Favour" because nothing records where the apostrophe went.
 *
 * Two kinds of id are in the payload, and the split is historical rather than principled:
 *
 *   Slugs.  `accelerating-catalyst`, `awakeners-orb`, `eldritch-orb-of-annulment`. Derived
 *           from the display name by a rule, so `slugify` handles them and no table is needed.
 *
 *   Short codes.  `alt`, `alch`, `aug`, `gcp`, `chaos`. These are the trade site's currency
 *           abbreviations, kept for the currencies that predate the slug convention. No rule
 *           produces them — "Orb of Alteration" does not become "alt" by any transformation —
 *           so they need the table below.
 *
 * ## What happens when the table is wrong
 *
 * The table is written from the trade site's published abbreviations, and it is not verifiable
 * from the price payload itself, because the payload has no names to check against. That is an
 * uncomfortable place to be, so the failure is shaped to be loud rather than quiet:
 *
 *   A *missing* alias means the name slugifies to an id poe.ninja does not have, the lookup
 *   misses, and the item lands in the snapshot's `unresolved` list where the poller logs it.
 *   Visibly unpriced, never silently zero.
 *
 *   A *wrong* alias — one pointing at a real but different id — would be a silently wrong
 *   price, which is the failure this project treats as the serious one. Two things bound it:
 *   the abbreviations are stable and widely documented, and `verifyAliases` checks every alias
 *   it can against the names poe.ninja does supply in `core.items`, warning on a mismatch.
 *
 * `unmatchedIds` closes the loop from the other end: it reports the ids poe.ninja sent that
 * nothing in the stash resolved to, which is how a missing alias gets noticed and added rather
 * than sitting undetected for a league.
 */

/**
 * poe.ninja's slug rule, inferred from the ids it returns.
 *
 * Lowercase, apostrophes and commas dropped rather than replaced, everything else that is not
 * alphanumeric collapsed to a single hyphen. Checked against real ids in the tests:
 * "Awakener's Orb" → `awakeners-orb`, "Brush, Paint and Palette" → `brush-paint-and-palette`.
 */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/['’,.]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Display name → poe.ninja's short code, for the currencies that do not use slugs.
 *
 * These are the trade site's currency abbreviations. Only currencies that actually appear with
 * a short code belong here — anything that already slugifies correctly (`ancient-orb`,
 * `awakeners-orb`, every catalyst, every eldritch currency) must NOT be listed, because an
 * entry here overrides the slug and an unnecessary one can only do harm.
 */
export const SHORT_CODES: Readonly<Record<string, string>> = Object.freeze({
  'Chaos Orb': 'chaos',
  'Divine Orb': 'divine',
  'Exalted Orb': 'exalted',
  'Mirror of Kalandra': 'mirror',
  'Orb of Alchemy': 'alch',
  'Orb of Alteration': 'alt',
  'Orb of Annulment': 'annul',
  'Orb of Augmentation': 'aug',
  'Orb of Chance': 'chance',
  'Orb of Fusing': 'fusing',
  'Orb of Regret': 'regret',
  'Orb of Scouring': 'scour',
  'Orb of Transmutation': 'transmute',
  'Regal Orb': 'regal',
  'Blessed Orb': 'blessed',
  'Chromatic Orb': 'chrom',
  'Vaal Orb': 'vaal',
  "Jeweller's Orb": 'jewellers',
  "Gemcutter's Prism": 'gcp',
  "Glassblower's Bauble": 'bauble',
  "Cartographer's Chisel": 'chisel',
  "Armourer's Scrap": 'scrap',
  "Blacksmith's Whetstone": 'whetstone',
  'Scroll of Wisdom': 'wisdom',
  'Portal Scroll': 'portal',
  'Silver Coin': 'silver',
});

/** The identifier poe.ninja prices this display name under. */
export function ninjaId(name: string): string {
  const trimmed = name.trim();
  if (trimmed === '') return '';
  return SHORT_CODES[trimmed] ?? slugify(trimmed);
}

/**
 * Check the alias table against the few names poe.ninja still gives us.
 *
 * `core.items` names the pricing pair — chaos and divine — and nothing else, so this can only
 * ever verify a couple of entries. It is worth doing anyway: those two are the currencies every
 * other price is quoted in, and getting either wrong would be wrong across the whole chart
 * rather than in one row.
 *
 * Returns the disagreements. An empty array means everything checkable agreed.
 */
export function verifyAliases(
  coreItems: ReadonlyArray<{ id: string; name: string }>,
): Array<{ name: string; expected: string; actual: string }> {
  const problems: Array<{ name: string; expected: string; actual: string }> = [];
  for (const item of coreItems) {
    const expected = ninjaId(item.name);
    if (expected !== item.id) problems.push({ name: item.name, expected, actual: item.id });
  }
  return problems;
}
