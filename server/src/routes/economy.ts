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
}
