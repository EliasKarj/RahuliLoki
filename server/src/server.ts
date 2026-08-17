/**
 * Starting What Remains, as a function.
 *
 * `index.ts` used to own all of this, which was fine while the only way to run the app was
 * `node dist/index.js`. The desktop shell needs the same server inside its own process, on a
 * port the operating system picks, shut down cleanly when the window closes — none of which a
 * script that ends in `process.exit` can offer.
 *
 * So the wiring lives here and returns a handle. `index.ts` is now just the command-line
 * wrapper around it, and the desktop main process is another caller with different options.
 */

import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import cron from 'node-cron';
import { PrismaClient } from '../generated/prisma/index.js';

import { buildApp } from './app.ts';
import { loadConfig, type AppConfig } from './lib/config.ts';
import { describeError, registerSecret } from './lib/logger.ts';
import { RateLimiter } from './lib/rateLimiter.ts';
import { nextScheduledPoll } from './lib/schedule.ts';
import { PriceService } from './services/priceService.ts';
import { StashService } from './services/stashService.ts';
import { PrismaPriceSetStore, PrismaSnapshotStore } from './services/snapshotRepo.ts';
import { LeagueService } from './services/leagueService.ts';
import { fetchProfile } from './services/profileService.ts';
import { PollRunner } from './jobs/pollJob.ts';
import type { ApiDeps } from './routes/deps.ts';

const here = dirname(fileURLToPath(import.meta.url));

/** The built SPA sits next to the built server in the container; in dev it may not exist. */
export function findWebDist(configured: string | null): string | null {
  // `../public` is where the container copies it; `../../web/dist` is the workspace layout,
  // which resolves the same whether this file is running from src/ or from dist/.
  const candidates = configured
    ? [resolve(configured)]
    : [resolve(here, '../public'), resolve(here, '../../web/dist')];
  return candidates.find((candidate) => existsSync(resolve(candidate, 'index.html'))) ?? null;
}

export interface StartOptions {
  /** Environment to read configuration from. Defaults to the real one. */
  env?: NodeJS.ProcessEnv;
  /** Overrides the configured port. 0 asks the OS for a free one — what the desktop app uses. */
  port?: number;
  /** Overrides SPA discovery. */
  webDist?: string | null;
}

export interface RunningServer {
  /** Where it is actually listening, with the real port when 0 was requested. */
  url: string;
  port: number;
  config: AppConfig;
  /** Non-fatal reasons the poller cannot run. */
  missing: string[];
  poller: PollRunner;
  /** Stops the scheduler, the HTTP server and the database connection, in that order. */
  close(): Promise<void>;
}

/**
 * Wire everything and listen.
 *
 * Throws if configuration is unusable — including the deliberate refusal to serve an
 * unauthenticated API on a non-loopback bind. Callers decide what to do about that; the CLI
 * prints and exits, the desktop shell shows a dialog.
 */
export async function startServer(options: StartOptions = {}): Promise<RunningServer> {
  const { config, missing, leagueDefaulted } = loadConfig(options.env ?? process.env);

  // Before anything can log, teach the logger what must never appear in its output.
  registerSecret(config.poesessid);
  registerSecret(config.authToken);

  // Explicit rather than implicit: see AppConfig.databaseUrl. Passing undefined keeps Prisma's
  // own environment lookup, which is what the CLI and the container rely on.
  const prisma =
    config.databaseUrl === undefined
      ? new PrismaClient()
      : new PrismaClient({ datasourceUrl: config.databaseUrl });
  const store = new PrismaSnapshotStore(prisma);
  const priceStore = new PrismaPriceSetStore(prisma, config.priceSetRetention);
  const startedAt = new Date();
  const webDist = options.webDist === undefined ? findWebDist(config.webDist) : options.webDist;

  // The services need a logger, and the logger belongs to the app, so the app is built first
  // and reaches the services through getters. Nothing here is read before `listen()`.
  let limiter: RateLimiter;
  let prices: PriceService;
  let poller: PollRunner;
  let leagues: LeagueService;

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
    nextPollAt: () => nextPollAt(),
    leagues: () => leagues.list(),
    profile: () =>
      fetchProfile({
        poesessid: config.poesessid,
        userAgent: config.userAgent,
        timeoutMs: config.requestTimeoutMs,
      }),
  };

  const app = await buildApp(deps, { webDist, logLevel: config.logLevel });
  const log = app.log;

  limiter = new RateLimiter({ log, timeoutMs: config.requestTimeoutMs });
  leagues = new LeagueService({
    userAgent: config.userAgent,
    knownLeagues: () => store.leagues(),
    timeoutMs: config.requestTimeoutMs,
    log,
  });
  prices = new PriceService({
    league: config.league,
    currencyCategories: config.currencyCategories,
    itemCategories: config.itemCategories,
    uniqueCategories: config.uniqueCategories,
    ttlMs: config.priceTtlMs,
    store: priceStore,
    userAgent: config.userAgent,
    timeoutMs: config.requestTimeoutMs,
    baseUrl: config.poeNinjaUrl,
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
    log.warn({ err: error }, 'could not restore a price set from the database');
  });

  if (missing.length > 0) {
    log.warn({ missing }, 'poller is disabled until these are set; existing history is still served');
  }
  if (leagueDefaulted) {
    log.warn('POE_LEAGUE is unset — tracking Standard. Set it before the league starts.');
  }
  if (config.authToken === null) {
    // Reachable only via a loopback bind or an explicit ALLOW_UNAUTHENTICATED — loadConfig
    // refuses anything else. Still worth saying out loud once per boot, because "I put it
    // behind Tailscale" and "I forgot" produce identical configuration.
    log.warn(
      { host: config.host, allowedHosts: config.allowedHosts },
      'no AUTH_TOKEN: anyone who can reach this port can read the wealth history and trigger polls',
    );
  }
  if (webDist === null) {
    log.warn('no built SPA found; serving the API only. Run `pnpm build` to bundle the frontend.');
  }

  /**
   * When the stash is next read automatically, for the dashboard's countdown.
   *
   * Nothing is scheduled while the poller is unconfigured or halted, and a backoff makes the
   * next fire and the next poll different times — see `nextScheduledPoll`. Twenty runs is far
   * more than a backoff can outlast at any sane schedule.
   */
  const nextPollAt = (): string | null => {
    if (missing.length > 0) return null;
    const health = poller.health;
    if (health.halted) return null;

    const notBefore = health.nextAttemptAfter === null ? 0 : Date.parse(health.nextAttemptAfter);
    return nextScheduledPoll(task.getNextRuns(20), notBefore);
  };

  const task = cron.schedule(config.pollCron, () => {
    void poller.tick().then((result) => {
      if (!result.ran) log.debug({ reason: result.reason }, 'scheduled poll skipped');
    });
  });

  const port = options.port ?? config.port;
  await app.listen({ port, host: config.host });

  // With port 0 the OS chose; ask what it chose rather than reporting the request.
  const address = app.server.address() as AddressInfo | null;
  const boundPort = address?.port ?? port;

  log.info(
    { league: config.league, cron: config.pollCron, webDist, port: boundPort },
    'What Remains is up',
  );

  let closing: Promise<void> | null = null;
  const close = async (): Promise<void> => {
    // Idempotent: the desktop shell can reach this from a window close, a tray quit and a
    // signal handler, and doing it twice must not throw.
    closing ??= (async () => {
      await task.stop();
      await app.close();
      await prisma.$disconnect();
    })();
    return closing;
  };

  return {
    url: `http://${config.host === '0.0.0.0' ? '127.0.0.1' : config.host}:${boundPort}`,
    port: boundPort,
    config,
    missing,
    poller,
    close,
  };
}
