/**
 * Boot: read the environment, wire the services, start the scheduler, serve the SPA.
 *
 * The process is deliberately willing to start in a broken state. A missing POESESSID leaves
 * the API and the existing history perfectly usable, and /api/health says exactly what is
 * wrong. Refusing to boot would take the charts down over a credential the operator is
 * probably already in the middle of replacing.
 */

import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import cron from 'node-cron';
import { PrismaClient } from '@prisma/client';

import { buildApp } from './app.ts';
import { loadConfig } from './lib/config.ts';
import { describeError, registerSecret } from './lib/logger.ts';
import { RateLimiter } from './lib/rateLimiter.ts';
import { PriceService } from './services/priceService.ts';
import { StashService } from './services/stashService.ts';
import { PrismaPriceSetStore, PrismaSnapshotStore } from './services/snapshotRepo.ts';
import { PollRunner } from './jobs/pollJob.ts';
import type { ApiDeps } from './routes/deps.ts';

const here = dirname(fileURLToPath(import.meta.url));

/** The built SPA sits next to the built server in the container; in dev it may not exist. */
function findWebDist(configured: string | null): string | null {
  // `../public` is where the container copies it; `../../web/dist` is the workspace layout,
  // which resolves the same whether this file is running from src/ or from dist/.
  const candidates = configured
    ? [resolve(configured)]
    : [resolve(here, '../public'), resolve(here, '../../web/dist')];
  return candidates.find((candidate) => existsSync(resolve(candidate, 'index.html'))) ?? null;
}

async function main(): Promise<void> {
  const { config, missing, leagueDefaulted } = loadConfig();

  // Before anything can log, teach the logger what must never appear in its output.
  registerSecret(config.poesessid);

  const prisma = new PrismaClient();
  const store = new PrismaSnapshotStore(prisma);
  const priceStore = new PrismaPriceSetStore(prisma);
  const startedAt = new Date();
  const webDist = findWebDist(config.webDist);

  // The services need a logger, and the logger belongs to the app, so the app is built first
  // and reaches the services through getters. Nothing here is read before `listen()`.
  let limiter: RateLimiter;
  let prices: PriceService;
  let poller: PollRunner;

  const deps: ApiDeps = {
    config,
    missing,
    store,
    startedAt,
    get poller() {
      return poller;
    },
    get prices() {
      return prices;
    },
    rateLimit: () => limiter.view(),
  };

  const app = await buildApp(deps, { webDist, logLevel: config.logLevel });
  const log = app.log;

  limiter = new RateLimiter({ log });
  prices = new PriceService({
    league: config.league,
    currencyCategories: config.currencyCategories,
    itemCategories: config.itemCategories,
    ttlMs: config.priceTtlMs,
    store: priceStore,
    userAgent: config.userAgent,
    log,
  });
  const stash = new StashService({
    accountName: config.accountName,
    league: config.league,
    poesessid: config.poesessid,
    userAgent: config.userAgent,
    trackedTabs: config.trackedTabs,
    limiter,
    log,
  });
  poller = new PollRunner({
    league: config.league,
    minItemChaos: config.minItemChaos,
    prices,
    stash,
    store,
    log,
    disabledReason:
      missing.length > 0 ? `polling disabled: ${missing.join(', ')} not set in the environment` : null,
  });

  await prices.hydrate().catch((error: unknown) => {
    log.warn({ err: describeError(error) }, 'could not restore a price set from the database');
  });

  if (missing.length > 0) {
    log.warn({ missing }, 'poller is disabled until these are set; existing history is still served');
  }
  if (leagueDefaulted) {
    log.warn('POE_LEAGUE is unset — tracking Standard. Set it before the league starts.');
  }
  if (webDist === null) {
    log.warn('no built SPA found; serving the API only. Run `pnpm build` to bundle the frontend.');
  }

  const task = cron.schedule(config.pollCron, () => {
    void poller.tick().then((result) => {
      if (!result.ran) log.debug({ reason: result.reason }, 'scheduled poll skipped');
    });
  });

  await app.listen({ port: config.port, host: config.host });
  log.info(
    { league: config.league, cron: config.pollCron, webDist, port: config.port },
    'valuuttaloki is up',
  );

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info({ signal }, 'shutting down');
    task.stop();
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error: unknown) => {
  console.error('failed to start:', describeError(error));
  process.exit(1);
});
