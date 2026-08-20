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
}
