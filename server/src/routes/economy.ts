/**
 * GET /api/economy — every item poe.ninja prices, not just the ones you hold.
 *
 * The dashboard answers "what do I own and what is it worth". This answers the other question a
 * player asks twenty times a league: "what is *that* worth right now" — for a thing they are
 * about to buy, sell, or decide not to pick up. The prices are already fetched and cached for
 * the valuation; nothing extra leaves the machine to serve this.
 *
 * The whole list goes in one response and the searching happens in the browser. A price set is
 * a few thousand rows, the client is on the same machine, and a search that filters as you type
 * is worth more here than a few hundred kilobytes saved once per visit to the tab.
 *
 * The names are the hard part and they are not all equally trustworthy — see
 * services/economy.ts. Every row carries the provenance of its own name so the interface can be
 * honest about which is which.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ApiDeps } from './deps.ts';
import { buildEconomy, namesFromBreakdown } from '../services/economy.ts';
import { dustFor } from '../services/dust.ts';
import { pickCandidate } from '../services/uniques.ts';

export async function economyRoutes(app: FastifyInstance, deps: ApiDeps): Promise<void> {
  app.get('/economy', async (request: FastifyRequest, reply: FastifyReply) => {
    const raw = request.query as Record<string, unknown>;
    const league =
      typeof raw.league === 'string' && raw.league.trim() !== '' ? raw.league.trim() : deps.config.league;

    const priceSet = deps.prices.cached;
    if (priceSet === null) {
      // Not an error: a fresh install has no prices until the first poll, and the page can say
      // so in a sentence. A 503 here would put a failure on screen for an ordinary early state.
      return reply.send({ league, fetchedAt: null, stale: true, divineRate: 0, count: 0, rows: [] });
    }

    // Names your own stash proves, which beat every other source. A league with no snapshots
    // yet simply contributes none, and the list falls back to aliases and slugs.
    const snapshot = await deps.store.latest(league);
    const known = snapshot === null ? undefined : namesFromBreakdown(snapshot.breakdown);

    const rows = buildEconomy({
      prices: priceSet.prices,
      categories: priceSet.categories,
      icons: priceSet.icons,
      divineRate: priceSet.divineRate,
      meta: priceSet.meta,
      ...(known ? { known } : {}),
    });

    return reply.send({
      league,
      fetchedAt: priceSet.fetchedAt.toISOString(),
      stale: deps.prices.isStale(),
      divineRate: priceSet.divineRate,
      count: rows.length,
      rows,
    });
  });

  /**
   * GET /api/price-history — what one item has cost, as this app watched it.
   *
   * Not poe.ninja's sparkline, which is a percentage series over a window it chooses. This is
   * the actual chaos value out of every price set still retained, which is `PRICE_SET_RETENTION`
   * fetches — two days at the defaults, and as long as you care to keep if you raise it.
   */
  app.get('/price-history', async (request: FastifyRequest, reply: FastifyReply) => {
    const raw = request.query as Record<string, unknown>;
    const id = typeof raw.id === 'string' ? raw.id.trim() : '';
    if (id === '') return reply.code(400).send({ error: 'id is required' });

    const league =
      typeof raw.league === 'string' && raw.league.trim() !== '' ? raw.league.trim() : deps.config.league;

    const points = await deps.priceHistory.history(league, id);
    return reply.send({ league, id, count: points.length, points });
  });

  /**
   * GET /api/uniques — the uniques a poll last saw, for the disenchanting bench.
   *
   * Item level and quality per item, which the snapshot breakdown does not keep, and a chaos
   * price out of the same variant index the wealth total is valued against — matched on the
   * item's own links, not on its name. One price path for uniques in the whole application, so
   * this view and the dashboard cannot disagree about what a thing is worth.
   *
   * `priceIsApproximate` says whether the match was exact. It usually is not, and for reasons
   * worth knowing rather than hiding: poe.ninja publishes no corruption on these lines, so a
   * corrupted item never matches exactly, and a unique it prices in several variants cannot be
   * pinned to one from stash data. See services/uniques.ts.
   */
  app.get('/uniques', async (request: FastifyRequest, reply: FastifyReply) => {
    const raw = request.query as Record<string, unknown>;
    const league =
      typeof raw.league === 'string' && raw.league.trim() !== '' ? raw.league.trim() : deps.config.league;

    const stored = await deps.uniques.latest(league);
    if (stored === null) {
      return reply.send({ league, capturedAt: null, count: 0, rows: [] });
    }

    const uniques = deps.prices.cached?.uniques ?? {};
    const rows = stored.holdings.map((holding) => {
      const picked = Object.hasOwn(uniques, holding.name)
        ? pickCandidate(uniques[holding.name] ?? [], holding.links, holding.corrupted)
        : null;
      const chaos = picked?.price.chaos ?? null;
      // Per item, not per row: the row may stand for twelve copies, but the decision at the
      // bench is about one of them and multiplying is the reader's business.
      const dust = dustFor(holding.name, {
        ilvl: holding.ilvl,
        quality: holding.quality,
        corrupted: holding.corrupted,
      });

      return {
        ...holding,
        chaos,
        /** True when the price is a stand-in: the exact combination was not on offer. */
        priceIsApproximate: picked !== null && !picked.exact,
        /** poe.ninja's label for the line that priced it, where it gave one. */
        variant: picked?.price.variant ?? null,
        dust: dust?.dust ?? null,
        /** True when the dust figure is a floor: corrupted, or an item level GGG did not send. */
        dustAtLeast: dust?.atLeast ?? false,
        goldCost: dust?.goldCost ?? null,
        slots: dust?.slots ?? null,
        // The column the whole view is for: how much dust a chaos of this item buys. Null when
        // either half is missing, rather than absent, so the client has one thing to test.
        dustPerChaos: dust !== null && chaos !== null && chaos > 0 ? dust.dust / chaos : null,
      };
    });

    return reply.send({
      league,
      capturedAt: stored.capturedAt.toISOString(),
      count: rows.length,
      rows,
    });
  });
}
