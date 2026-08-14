/**
 * Environment parsing. Everything the app needs is read once, here, and validated up front —
 * a typo in POLL_CRON should fail at boot, not at 03:00 when the first tick fires.
 *
 * The server boots even when GGG credentials are missing: history that is already in the
 * database stays viewable, and /api/health reports plainly why polling is off. Only the
 * poller requires credentials.
 */

/** poe.ninja categories that key cleanly by item name. Uniques/gems/maps are opt-in — see README. */
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
  priceTtlMs: number;
  userAgent: string;
  port: number;
  host: string;
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

const VERSION = '0.1.0';

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
 * A cron expression is five or six space-separated fields. node-cron throws on a bad
 * expression only when scheduling, which would mean discovering it long after boot.
 */
export function isValidCron(expression: string): boolean {
  const fields = expression.trim().split(/\s+/);
  if (fields.length < 5 || fields.length > 6) return false;
  return fields.every((field) => /^[0-9*,/\-a-zA-Z]+$/.test(field));
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ConfigResult {
  const pollCron = env.POLL_CRON?.trim() || '*/10 * * * *';
  if (!isValidCron(pollCron)) throw new ConfigError(`POLL_CRON is not a cron expression: "${pollCron}"`);

  const minItemChaos = readInt(env, 'MIN_ITEM_CHAOS', 2);
  if (minItemChaos < 0) throw new ConfigError('MIN_ITEM_CHAOS cannot be negative');

  const priceTtlMinutes = readInt(env, 'PRICE_TTL_MINUTES', 60);
  if (priceTtlMinutes <= 0) throw new ConfigError('PRICE_TTL_MINUTES must be positive');

  const contact = env.POE_CONTACT?.trim() || 'valuuttaloki (self-hosted, single user)';

  const config: AppConfig = {
    poesessid: env.POESESSID?.trim() ?? '',
    accountName: env.POE_ACCOUNT_NAME?.trim() ?? '',
    league: env.POE_LEAGUE?.trim() || 'Standard',
    pollCron,
    minItemChaos,
    trackedTabs: readList(env, 'TRACKED_TABS', []),
    currencyCategories: readList(env, 'PRICE_CURRENCY_CATEGORIES', DEFAULT_CURRENCY_CATEGORIES),
    itemCategories: readList(env, 'PRICE_ITEM_CATEGORIES', DEFAULT_ITEM_CATEGORIES),
    priceTtlMs: priceTtlMinutes * 60_000,
    // GGG asks for a User-Agent they can identify and contact. Give them one.
    userAgent: `valuuttaloki/${VERSION} (+https://github.com/EliasKarj/RahuliLoki) ${contact}`,
    port: readInt(env, 'PORT', 3000),
    host: env.HOST?.trim() || '0.0.0.0',
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
    priceCategories: [...config.currencyCategories, ...config.itemCategories],
    priceTtlMinutes: Math.round(config.priceTtlMs / 60_000),
    configured: missing.length === 0,
    missing,
    version: VERSION,
  };
}
