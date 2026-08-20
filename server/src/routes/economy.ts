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
   * Item level and quality per item, which the snapshot breakdown does not keep, plus a chaos
   * price from poe.ninja's item endpoint where it has one.
   *
   * That price is **by name only**, and the response says so on every row. poe.ninja prices
   * several variants of one unique — six-linked, a particular roll — and the cheapest of them is
   * what `uniquePrices` carries, because a stash item this app has not matched to a variant
   * could be any of them. For a disenchanting decision that is the right ballpark: what goes to
   * the bench is the cheap end, where the variant barely moves the price. It is not good enough
   * for a net worth, which is why the wealth total still leaves uniques out.
   */
  app.get('/uniques', async (request: FastifyRequest, reply: FastifyReply) => {
    const raw = request.query as Record<string, unknown>;
    const league =
      typeof raw.league === 'string' && raw.league.trim() !== '' ? raw.league.trim() : deps.config.league;

    const stored = await deps.uniques.latest(league);
    if (stored === null) {
      return reply.send({ league, capturedAt: null, count: 0, rows: [] });
    }

    // Name-keyed, and not the `prices` map: that one is keyed by poe.ninja id and is what the
    // valuation reads. See PriceSet.uniquePrices for why the two are kept apart.
    const uniquePrices = deps.prices.cached?.uniquePrices ?? {};
    const rows = stored.holdings.map((holding) => {
      const chaos = uniquePrices[holding.name] ?? null;
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
        // A corrupted or linked item is where a name-level price stops being a ballpark. The
        // row carries the caveat so the table can mark it rather than quietly averaging it in.
        priceIsApproximate: chaos !== null,
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
