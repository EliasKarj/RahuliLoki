/**
 * Uniques, priced by what actually sets their price.
 *
 * Everything else in this app maps cleanly: a Chaos Orb is a Chaos Orb. A unique is not. The
 * same name can be four different items on the market:
 *
 *   Bronn's Lithe                       ~5c
 *   Bronn's Lithe, 6-linked            ~200c
 *   Bronn's Lithe, corrupted 6-linked  different again
 *
 * poe.ninja knows this and returns one line per combination, carrying `links` and `corrupted`
 * alongside the name. The previous behaviour — take the first line matching the name — picked
 * whichever combination poe.ninja happened to list first, which is why uniques were left out
 * of the default categories entirely.
 *
 * So the key is (name, links, corrupted), and the stash item's real socket layout and
 * corruption decide which line it matches.
 *
 * `variant` is the case this still cannot fully resolve. poe.ninja distinguishes e.g. a
 * pre-3.0 Shavronne's from a current one, and nothing in the stash payload says which the
 * player holds. Where variants collide the cheapest is used — see `pickCandidate`.
 */

export interface UniquePrice {
  name: string;
  /** 5 or 6; 0 for "links do not matter for this item", which is most of them. */
  links: number;
  corrupted: boolean;
  /** poe.ninja's variant label, when it gave one. Not matchable against stash data. */
  variant: string | null;
  chaos: number;
  icon: string | null;
}

/** All the lines poe.ninja returned for one name. */
export type UniqueIndex = Record<string, UniquePrice[]>;

export interface SocketLike {
  group?: unknown;
}

export interface UniqueItemLike {
  name?: string;
  corrupted?: boolean;
  sockets?: SocketLike[];
}

/**
 * The largest set of linked sockets on the item.
 *
 * GGG expresses links through `group`: sockets sharing a group number are linked to each other.
 * Anything under five is worth nothing extra on the market, so it normalises to 0 — the same
 * value poe.ninja uses for "links are not what prices this".
 */
export function linkCount(sockets: SocketLike[] | undefined): number {
  if (!Array.isArray(sockets) || sockets.length === 0) return 0;
  const groups = new Map<number, number>();
  for (const socket of sockets) {
    if (typeof socket?.group !== 'number') continue;
    groups.set(socket.group, (groups.get(socket.group) ?? 0) + 1);
  }
  let largest = 0;
  for (const size of groups.values()) largest = Math.max(largest, size);
  return largest >= 5 ? largest : 0;
}

/**
 * A display key that keeps the combinations apart in the breakdown.
 *
 * They have to be distinguishable: a chart that merges a 6-linked Bronn's with a plain one is
 * hiding the entire reason the number moved. The suffix is only added when it carries
 * information, so the ordinary case still reads as just the item's name.
 */
export function uniqueKey(name: string, links: number, corrupted: boolean): string {
  const parts = [name];
  if (links >= 5) parts.push(`${links}L`);
  if (corrupted) parts.push('corrupted');
  return parts.length === 1 ? name : `${parts[0]} (${parts.slice(1).join(', ')})`;
}

/**
 * Choose the line that prices this item.
 *
 * Exact (links, corrupted) first. Failing that, fall back along the axes that lose the least:
 * an unlinked match for a linked item understates rather than invents value, and a
 * corruption mismatch is a smaller error than pricing the item at zero.
 *
 * Where several lines still tie — the variant case — the cheapest wins. Both directions are
 * wrong, but overstating wealth is the one that shows up as profit that was never made.
 */
export function pickCandidate(
  candidates: UniquePrice[],
  links: number,
  corrupted: boolean,
): UniquePrice | null {
  if (candidates.length === 0) return null;

  const tiers = [
    candidates.filter((c) => c.links === links && c.corrupted === corrupted),
    candidates.filter((c) => c.links === links),
    candidates.filter((c) => c.links === 0 && c.corrupted === corrupted),
    candidates.filter((c) => c.links === 0),
    candidates,
  ];

  for (const tier of tiers) {
    if (tier.length === 0) continue;
    return tier.reduce((cheapest, current) => (current.chaos < cheapest.chaos ? current : cheapest));
  }
  return null;
}

interface UniqueLine {
  name?: unknown;
  chaosValue?: unknown;
  links?: unknown;
  corrupted?: unknown;
  variant?: unknown;
  icon?: unknown;
}

/**
 * Merge one unique itemoverview payload into the index.
 *
 * `iconFor` is injected rather than imported so the URL validation lives in exactly one place —
 * these URLs end up in an `<img src>` and must not be trusted straight from the payload.
 */
export function mergeUniqueOverview(
  payload: unknown,
  into: UniqueIndex,
  iconFor: (value: unknown) => string | null,
): number {
  const lines = (payload as { lines?: unknown })?.lines;
  if (!Array.isArray(lines)) return 0;

  let merged = 0;
  for (const raw of lines as UniqueLine[]) {
    const name = typeof raw?.name === 'string' && raw.name !== '' ? raw.name : null;
    const chaos =
      typeof raw?.chaosValue === 'number' && Number.isFinite(raw.chaosValue) && raw.chaosValue > 0
        ? raw.chaosValue
        : null;
    if (name === null || chaos === null) continue;

    const rawLinks = typeof raw?.links === 'number' && Number.isFinite(raw.links) ? raw.links : 0;
    const entry: UniquePrice = {
      name,
      links: rawLinks >= 5 ? rawLinks : 0,
      corrupted: raw?.corrupted === true,
      variant: typeof raw?.variant === 'string' && raw.variant !== '' ? raw.variant : null,
      chaos,
      icon: iconFor(raw?.icon),
    };

    const bucket = into[name];
    if (bucket === undefined) into[name] = [entry];
    else bucket.push(entry);
    merged += 1;
  }
  return merged;
}
