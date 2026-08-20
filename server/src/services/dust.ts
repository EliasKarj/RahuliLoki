/**
 * Thaumaturgic Dust: how much an item is worth at the Kingsmarch bench.
 *
 * ## The formula
 *
 *   clamped   = clamp(ilvl, 65, 84)
 *   factors   = 100 + quality × 2 + influences × 50 + corruptionImplicits × 50
 *   dust      = round(baseDust × 125 × (20 − (84 − clamped)) × factors ÷ 100)
 *
 * Item level dominates it. The `(20 − (84 − ilvl))` term is 20 at level 84 and 1 at level 65,
 * so the same unique at the bottom of that range yields a twentieth of what it does at the top,
 * and below 65 it stops falling. Quality adds 2% each, so 20% quality is +40%.
 *
 * ## Where the numbers come from, and how far they are checked
 *
 * The table in data/dust.json is from deronek/poe-disenchant-tool, MIT licensed — see
 * data/NOTICE.md. It publishes two values per unique: dust at item level 84 with no quality,
 * and with 20% quality. It does not publish a base dust value, and it does not need to, because
 * the pair gives it away.
 *
 * A quality of 20 adds 40 to `factors`, so the ratio between the two columns is
 * `(F + 40) / F` for whatever inherent factor F that item carries. Solving for F:
 *
 *   F = 40 ÷ (q20 ÷ q0 − 1)
 *
 * Across all 1,103 rows that yields exactly four values — 100, 150, 200 and 400 — which are no
 * influence, one influence, two influences, and six units of influence or corruption. An item
 * whose dust is already boosted by its own influence is therefore not boosted twice, which a
 * naive multiplication of the published column would do.
 *
 * That is not a claim, it is a test: `dust.test.ts` runs every row of the table back through
 * this formula and requires both published columns to come out again. 1,102 of 1,103 reproduce
 * exactly; the last differs by one dust in six hundred and forty thousand, which is a rounding
 * artefact in the published data rather than a disagreement about the formula.
 *
 * ## What is not modelled
 *
 * Corruption. A corrupted item may carry implicits worth +50% each, and the stash payload says
 * an item is corrupted without saying how many it has. Rather than guess a number, corrupted
 * items are reported with the dust their inherent factor gives and flagged, so a figure that is
 * a floor is not mistaken for a total.
 */

import rawTable from '../data/dust.json' with { type: 'json' };

interface RawDustRow {
  /** Unique name. */
  n: string;
  /** Base type. */
  b: string;
  /** Dust at item level 84, no quality. */
  d84: number;
  /** Dust at item level 84, 20% quality. */
  d84q: number;
  /** Gold to disenchant. */
  g: number;
  /** Inventory slots. */
  s: number;
}

export interface DustEntry {
  name: string;
  baseType: string;
  /** Dust before any item-level or quality multiplier. Derived; see the module comment. */
  baseDust: number;
  /**
   * The multiplier the item carries by itself, as a percentage: 100 for an ordinary unique, 150
   * for one that is inherently influenced, and so on. Derived from the two published columns.
   */
  inherentFactors: number;
  goldCost: number;
  slots: number;
}

/** Item level below which dust stops falling, and above which it stops rising. */
export const ILVL_FLOOR = 65;
export const ILVL_CEILING = 84;

/**
 * The inherent factor an item carries, from its two published dust values.
 *
 * Returns 100 — an ordinary unique with nothing added — when the two values are equal or the
 * ratio is not usable. A wrong factor here would scale every figure for that item, so the
 * fallback is the neutral one rather than a guess.
 */
export function inherentFactorsFrom(dustAt84: number, dustAt84Q20: number): number {
  if (!(dustAt84 > 0) || !(dustAt84Q20 > 0)) return 100;
  const ratio = dustAt84Q20 / dustAt84;
  if (!(ratio > 1)) return 100;

  const factors = Math.round(40 / (ratio - 1));
  return Number.isFinite(factors) && factors >= 100 ? factors : 100;
}

function toEntry(row: RawDustRow): DustEntry {
  const inherentFactors = inherentFactorsFrom(row.d84, row.d84q);
  return {
    name: row.n,
    baseType: row.b,
    // At item level 84 the level term is 20, so the published value is base × 125 × 20 × F/100.
    baseDust: row.d84 / (125 * 20 * (inherentFactors / 100)),
    inherentFactors,
    goldCost: row.g,
    slots: row.s,
  };
}

/**
 * Every unique the table knows, by name.
 *
 * By name alone: the table has 1,103 rows and 1,103 distinct names, so a base type would
 * distinguish nothing and would only give the lookup another way to miss.
 */
export const DUST_TABLE: ReadonlyMap<string, DustEntry> = new Map(
  (rawTable as RawDustRow[]).map((row) => [row.n, toEntry(row)]),
);

export interface DustInput {
  /** Item level. Null when GGG sent none — see the return value. */
  ilvl: number | null;
  quality: number;
  /** Corrupted items may carry implicits this cannot count. See the module comment. */
  corrupted?: boolean;
}

export interface DustResult {
  dust: number;
  goldCost: number;
  slots: number;
  /**
   * True when the figure is a floor rather than a total: a corrupted item whose implicits, if
   * any, would each add 50% and are not in the payload.
   */
  atLeast: boolean;
}

/**
 * What this item yields at the bench, or null when the table has never heard of it.
 *
 * Null rather than zero, and null rather than an estimate. A unique added to the game after the
 * table was captured has no dust value here, and showing one anyway — from a neighbour, from an
 * average — would be a number with nothing behind it in the one column a decision is made from.
 */
export function dustFor(name: string, input: DustInput): DustResult | null {
  const entry = DUST_TABLE.get(name);
  if (entry === undefined) return null;

  // An item level GGG did not send is not an item level. The ceiling would flatter every such
  // row into the best case, so the floor is used: the number is then the least it can be, which
  // is the direction an unknown should err in when somebody is deciding what to destroy.
  const ilvl = input.ilvl ?? ILVL_FLOOR;
  const clamped = Math.min(Math.max(ilvl, ILVL_FLOOR), ILVL_CEILING);
  const quality = Number.isFinite(input.quality) ? Math.max(0, input.quality) : 0;

  const factors = entry.inherentFactors + quality * 2;
  const dust = Math.round(entry.baseDust * 125 * (20 - (ILVL_CEILING - clamped)) * (factors / 100));

  return {
    dust,
    goldCost: entry.goldCost,
    slots: entry.slots,
    atLeast: input.corrupted === true || input.ilvl === null,
  };
}
