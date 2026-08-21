/**
 * Environment parsing. Everything the app needs is read once, here, and validated up front —
 * a typo in POLL_CRON should fail at boot, not at 03:00 when the first tick fires.
 *
 * The server boots even when GGG credentials are missing: history that is already in the
 * database stays viewable, and /api/health reports plainly why polling is off. Only the
 * poller requires credentials.
 *
 * It does *not* boot when the API would be reachable from outside this machine with nothing
 * guarding it — see `resolveAuth`. That is the one misconfiguration whose blast radius is
 * somebody else's, not the operator's.
 */

import { validate as cronValidate } from 'node-cron';
import { isLoopbackBind, MIN_TOKEN_LENGTH } from './auth.ts';
import { DEFAULT_NINJA_URL } from '../services/ninjaPayload.ts';

/** poe.ninja categories that key cleanly by item name. Gems and maps stay out — see README. */
export const DEFAULT_CURRENCY_CATEGORIES = ['Currency', 'Fragment'] as const;
export const DEFAULT_ITEM_CATEGORIES = [
  'DivinationCard',
  'Essence',
  'Fossil',
  'Resonator',
  'Scarab',
  'Oil',
  'DeliriumOrb',
  'Incubator',
  'Artifact',
  'Vial',
  'Omen',
  'Tattoo',
  // Priced and worth real chaos, and this app was blind to it until scripts/probe.mjs asked
  // poe.ninja which type= values return anything at all. Nothing announced the gap: an item
  // nobody prices is simply absent from the breakdown, and absent looks exactly like "you do
  // not own any".
  'AllflameEmber',
] as const;

/**
 * Unique categories, priced per variant rather than by name — see services/uniques.ts.
 *
 * These are **item**-endpoint types. The exchange endpoint this app fetches everything else
 * from serves no uniques at all: UniqueArmour, UniqueWeapon, UniqueAccessory, UniqueFlask,
 * UniqueJewel, UniqueMap, UniqueRelic and a bare Unique all answer 200 with zero lines, which
 * is why this list sat empty for months and uniques were left out of every net worth.
 *
 * `stash/current/item` serves them: 986 unique armours, 667 weapons, 364 accessories, 167
 * jewels and 39 flasks, each line carrying `links` — the field whose absence made a unique
 * unpriceable here, because by name alone a plain Bronn's Lithe and a six-linked one are the
 * same row at about 5 chaos and about 210. UniqueMap and UniqueRelic answer empty on this
 * endpoint too and are left out rather than asked for nothing. Recorded by scripts/probe.mjs.
 *
 * Set PRICE_UNIQUE_CATEGORIES to an empty value to switch unique pricing off — the totals then
 * read the way every snapshot before this did, which is what makes the old ones comparable.
 */
export const DEFAULT_UNIQUE_CATEGORIES = [
  'UniqueArmour',
  'UniqueWeapon',
  'UniqueAccessory',
  'UniqueJewel',
  'UniqueFlask',
] as const;

export interface AppConfig {
  /** Full account credential. Never logged, never sent to the frontend. */
  poesessid: string;
  accountName: string;
  league: string;
  pollCron: string;
  minItemChaos: number;
  /** Empty means "every tab the account has". */
  trackedTabs: string[];
  currencyCategories: string[];
  itemCategories: string[];
  uniqueCategories: string[];
  priceTtlMs: number;
  userAgent: string;
  port: number;
  host: string;
  /** Shared API token, or null when the operator opted into an open API. */
  authToken: string | null;
  /** True when ALLOW_UNAUTHENTICATED was set. Only meaningful when `authToken` is null. */
  allowUnauthenticated: boolean;
  /** Host header values accepted besides the loopback names, in token-less mode. */
  allowedHosts: string[];
  /** Whether X-Forwarded-* may be believed. Off unless a proxy really is in front. */
  trustProxy: boolean;
  /**
   * Whether to ask GitHub, once a day, whether a newer release exists.
   *
   * On by default, and the one outbound request this app makes that is not about your stash —
   * see updateService.ts for exactly what leaves the machine. `UPDATE_CHECK=off` stops it.
   */
  updateCheck: boolean;
  /** PriceSet rows kept per league; older ones are pruned after each fetch. 0 disables. */
  priceSetRetention: number;
  /** Ceiling on a single outbound request to GGG or poe.ninja. */
  requestTimeoutMs: number;
  /**
   * poe.ninja's API root. Configurable because a third party's URL is not something this app
   * should need a release to follow — and it has already moved once, from `/api/data` to the
   * per-game path, which broke every install until the default was changed.
   */
  poeNinjaUrl: string;
  /**
   * Where the database lives, read here rather than left to Prisma's own env lookup.
   *
   * PrismaClient reads `process.env.DATABASE_URL` at construction. That is invisible to any
   * caller that passes a different environment — the desktop shell does exactly that, and the
   * result was a server whose config pointed at one database while its client pointed at
   * nothing at all. Carrying it in the config makes the dependency explicit and injectable.
   */
  databaseUrl: string | undefined;
  /** Directory of the built SPA, or null when the API runs headless (dev, tests). */
  webDist: string | null;
  logLevel: string;
}

export interface ConfigResult {
  config: AppConfig;
  /** Non-fatal reasons the poller cannot run. Empty means fully configured. */
  missing: string[];
  /** True when POE_LEAGUE was unset and the Standard fallback kicked in. */
  leagueDefaulted: boolean;
}

/**
 * The version this build reports — in the update banner, in the outbound User-Agent, and in
 * /api/config.
 *
 * It is a literal because the build cannot import package.json: `tsconfig.build.json` sets
 * `rootDir: "src"`, and a file above that root would land the emitted output somewhere nobody
 * expects. A literal is therefore a second source of truth for one number, which is exactly how
 * this went wrong: it sat at 1.2.0 through four releases while the manifests said 1.4.0, so a
 * freshly installed 1.4.1 introduced itself as 1.2.0 and was told, permanently, that an update
 * was available.
 *
 * The duplication is therefore checked rather than trusted. `version.test.ts` reads the four
 * manifests and fails if this line disagrees with any of them, and the release workflow fails
 * if the tag being built disagrees with the manifests.
 */
export const VERSION = '1.5.0';

export class ConfigError extends Error {}

function readInt(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new ConfigError(`${key} must be a number, got "${raw}"`);
  return value;
}

function readList(env: NodeJS.ProcessEnv, key: string, fallback: readonly string[]): string[] {
  const raw = env[key];
  if (raw === undefined || raw.trim() === '') return [...fallback];
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/**
 * Validate against node-cron's own parser rather than a shape guess. The previous hand-rolled
 * check passed anything built from the right character classes, so `abc def ghi jkl mno` was
 * accepted at boot and only blew up when the scheduler tried to use it.
 */
export function isValidCron(expression: string): boolean {
  const fields = expression.trim().split(/\s+/);
  if (fields.length < 5 || fields.length > 6) return false;
  return cronValidate(expression);
}

function readBool(env: NodeJS.ProcessEnv, key: string): boolean {
  const raw = env[key]?.trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

/** Like `readBool`, but for a setting that is on until somebody says otherwise. */
function readOffSwitch(env: NodeJS.ProcessEnv, key: string): boolean {
  const raw = env[key]?.trim().toLowerCase();
  if (raw === undefined || raw === '') return true;
  return !(raw === '0' || raw === 'false' || raw === 'no' || raw === 'off');
}

/**
 * Decide how the API is protected, and refuse to start in the one combination that is simply
 * unsafe: reachable from outside this machine, with nothing in front of it.
 *
 * Binding loopback-only is the default, so `pnpm dev` and a compose file that publishes to
 * 127.0.0.1 keep working with no token. Anything wider is a deliberate act — a container with
 * HOST=0.0.0.0, a Fly deployment — and has to come with either a token or a written-down
 * acknowledgement that something else is doing the authenticating.
 */
export function resolveAuth(
  env: NodeJS.ProcessEnv,
  host: string,
): { authToken: string | null; allowUnauthenticated: boolean; allowedHosts: string[] } {
  const raw = env.AUTH_TOKEN?.trim() ?? '';
  const allowUnauthenticated = readBool(env, 'ALLOW_UNAUTHENTICATED');
  const allowedHosts = readList(env, 'ALLOWED_HOSTS', []);

  if (raw !== '') {
    if (raw.length < MIN_TOKEN_LENGTH) {
      throw new ConfigError(
        `AUTH_TOKEN must be at least ${MIN_TOKEN_LENGTH} characters; generate one with ` +
          '`openssl rand -hex 32`',
      );
    }
    return { authToken: raw, allowUnauthenticated: false, allowedHosts };
  }

  const loopbackOnly = isLoopbackBind(host);
  if (!loopbackOnly && !allowUnauthenticated) {
    throw new ConfigError(
      `refusing to serve an unauthenticated API on ${host}. This exposes the full wealth ` +
        'history of the account and a POST /api/poll that spends its GGG rate-limit budget. ' +
        'Set AUTH_TOKEN (`openssl rand -hex 32`), or bind HOST=127.0.0.1, or set ' +
        'ALLOW_UNAUTHENTICATED=1 if something in front of it is already authenticating.',
    );
  }

  return { authToken: null, allowUnauthenticated, allowedHosts };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ConfigResult {
  const pollCron = env.POLL_CRON?.trim() || '*/10 * * * *';
  if (!isValidCron(pollCron)) throw new ConfigError(`POLL_CRON is not a cron expression: "${pollCron}"`);

  const minItemChaos = readInt(env, 'MIN_ITEM_CHAOS', 2);
  if (minItemChaos < 0) throw new ConfigError('MIN_ITEM_CHAOS cannot be negative');

  const priceTtlMinutes = readInt(env, 'PRICE_TTL_MINUTES', 60);
  if (priceTtlMinutes <= 0) throw new ConfigError('PRICE_TTL_MINUTES must be positive');

  const port = readInt(env, 'PORT', 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new ConfigError(`PORT must be a whole number between 1 and 65535, got "${String(port)}"`);
  }

  const priceSetRetention = readInt(env, 'PRICE_SET_RETENTION', 48);
  if (priceSetRetention < 0) throw new ConfigError('PRICE_SET_RETENTION cannot be negative');

  const requestTimeoutMs = readInt(env, 'REQUEST_TIMEOUT_MS', 30_000);
  if (requestTimeoutMs <= 0) throw new ConfigError('REQUEST_TIMEOUT_MS must be positive');

  const contact = env.POE_CONTACT?.trim() || 'What Remains (self-hosted, single user)';

  // Default to loopback. The previous default of 0.0.0.0 meant that anything that started the
  // server — a laptop on café wifi, a VPS with no firewall — published it to its whole network.
  const host = env.HOST?.trim() || '127.0.0.1';
  const { authToken, allowUnauthenticated, allowedHosts } = resolveAuth(env, host);

  const config: AppConfig = {
    poesessid: env.POESESSID?.trim() ?? '',
    accountName: env.POE_ACCOUNT_NAME?.trim() ?? '',
    league: env.POE_LEAGUE?.trim() || 'Standard',
    pollCron,
    minItemChaos,
    trackedTabs: readList(env, 'TRACKED_TABS', []),
    currencyCategories: readList(env, 'PRICE_CURRENCY_CATEGORIES', DEFAULT_CURRENCY_CATEGORIES),
    itemCategories: readList(env, 'PRICE_ITEM_CATEGORIES', DEFAULT_ITEM_CATEGORIES),
    uniqueCategories: readList(env, 'PRICE_UNIQUE_CATEGORIES', DEFAULT_UNIQUE_CATEGORIES),
    priceTtlMs: priceTtlMinutes * 60_000,
    // GGG asks for a User-Agent they can identify and contact. Give them one.
    userAgent: `what-remains/${VERSION} (+https://github.com/EliasKarj/WhatRemains) ${contact}`,
    port,
    host,
    authToken,
    allowUnauthenticated,
    allowedHosts,
    trustProxy: readBool(env, 'TRUST_PROXY'),
    // On unless switched off: a check nobody knows about is a check nobody wanted, but one
    // that has to be turned on is one nobody has when the update matters.
    updateCheck: readOffSwitch(env, 'UPDATE_CHECK'),
    priceSetRetention,
    requestTimeoutMs,
    poeNinjaUrl: env.POE_NINJA_URL?.trim() || DEFAULT_NINJA_URL,
    databaseUrl: env.DATABASE_URL?.trim() || undefined,
    webDist: env.WEB_DIST?.trim() || null,
    logLevel: env.LOG_LEVEL?.trim() || 'info',
  };

  // Only the two credentials block polling. An unset league falls back to Standard, which is
  // valid but rarely what someone wants — index.ts warns about it at boot.
  const missing: string[] = [];
  if (config.poesessid === '') missing.push('POESESSID');
  if (config.accountName === '') missing.push('POE_ACCOUNT_NAME');

  return { config, missing, leagueDefaulted: !env.POE_LEAGUE?.trim() };
}

/** What /api/config is allowed to expose. POESESSID is deliberately absent. */
export function publicConfig(config: AppConfig, missing: string[]) {
  return {
    accountName: config.accountName,
    league: config.league,
    pollCron: config.pollCron,
    minItemChaos: config.minItemChaos,
    trackedTabs: config.trackedTabs,
    priceCategories: [
      ...config.currencyCategories,
      ...config.itemCategories,
      ...config.uniqueCategories,
    ],
    priceTtlMinutes: Math.round(config.priceTtlMs / 60_000),
    configured: missing.length === 0,
    missing,
    version: VERSION,
    /** Lets the UI say whether it is behind a token or relying on the network for safety. */
    authRequired: config.authToken !== null,
  };
}
