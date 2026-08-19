/**
 * "There is a newer version" — asked of GitHub, once a day, and never acted on by itself.
 *
 * The app updates by someone downloading an installer, so the only thing it can usefully do is
 * notice and say so. That is deliberately where this stops: it checks and it tells, and the
 * decision stays with the person. Downloading and swapping the program out from under someone
 * is a different feature with a different threat model — it wants code signing, and without it
 * an auto-updater is a thing that replaces your binary from the internet.
 *
 * ## What leaves the machine
 *
 * One GET to api.github.com, carrying the same User-Agent as everything else and no credential
 * of any kind — no POESESSID, no token, no account name. What GitHub learns is that an IP asked
 * about a public repository, which is what it learns from anyone opening the releases page.
 *
 * It is still an outbound request this app did not use to make, which is why it can be turned
 * off (`UPDATE_CHECK=off`, or the checkbox in the desktop panel) and why the answer is cached
 * for a day rather than fetched per page load.
 */

import { silentLogger, type Logger } from '../lib/logger.ts';
import { readJsonCapped, timeoutSignal } from '../lib/http.ts';
import { isNewer } from '../lib/version.ts';

export interface UpdateStatus {
  /** The version running right now. */
  current: string;
  /** The newest release tag GitHub reports, or null when it could not be established. */
  latest: string | null;
  /** True only when `latest` is a release strictly newer than `current`. */
  available: boolean;
  /** Where to go and get it. Null unless there is something to get. */
  url: string | null;
  /** When this answer was obtained. Null before the first successful check. */
  checkedAt: string | null;
}

interface RawRelease {
  tag_name?: unknown;
  html_url?: unknown;
  draft?: unknown;
  prerelease?: unknown;
}

export interface UpdateServiceOptions {
  /** The version this build reports, from config. */
  current: string;
  userAgent: string;
  /** Off means never ask. The status then says so instead of pretending to be up to date. */
  enabled: boolean;
  timeoutMs?: number;
  ttlMs?: number;
  baseUrl?: string;
  fetchFn?: typeof fetch;
  now?: () => number;
  log?: Logger;
}

/**
 * Only a GitHub release page is worth linking to.
 *
 * The URL comes out of a remote payload and ends up somewhere a person will click, so it is
 * checked the same way an icon URL is: https, and a host we meant.
 */
export function releaseUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value === '') return null;
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase();
    if (parsed.protocol !== 'https:') return null;
    return host === 'github.com' || host.endsWith('.github.com') ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export class UpdateService {
  readonly #options: UpdateServiceOptions;
  readonly #fetch: typeof fetch;
  readonly #now: () => number;
  readonly #log: Logger;
  readonly #baseUrl: string;
  readonly #ttlMs: number;
  #cached: UpdateStatus;
  #cachedAt = 0;
  #inFlight: Promise<UpdateStatus> | null = null;

  constructor(options: UpdateServiceOptions) {
    this.#options = options;
    this.#fetch = options.fetchFn ?? globalThis.fetch;
    this.#now = options.now ?? Date.now;
    this.#log = options.log ?? silentLogger;
    this.#baseUrl =
      options.baseUrl ?? 'https://api.github.com/repos/EliasKarj/WhatRemains/releases/latest';
    // A day. Releases are not frequent, and this is a request nobody asked for.
    this.#ttlMs = options.ttlMs ?? 24 * 60 * 60_000;
    this.#cached = {
      current: options.current,
      latest: null,
      available: false,
      url: null,
      checkedAt: null,
    };
  }

  /** The last answer, without asking. What the health endpoint reports. */
  get status(): UpdateStatus {
    return this.#cached;
  }

  /**
   * The current answer, asking GitHub if the cached one has expired.
   *
   * A failure is not an error anybody needs to see: the app works, and "we could not check"
   * looks identical to "you are up to date" from the outside. It is logged and the previous
   * answer stands.
   */
  async check(): Promise<UpdateStatus> {
    if (!this.#options.enabled) return this.#cached;
    if (this.#cached.checkedAt !== null && this.#now() - this.#cachedAt < this.#ttlMs) {
      return this.#cached;
    }
    this.#inFlight ??= this.#refresh().finally(() => {
      this.#inFlight = null;
    });
    return this.#inFlight;
  }

  async #refresh(): Promise<UpdateStatus> {
    try {
      const response = await this.#fetch(this.#baseUrl, {
        headers: {
          accept: 'application/vnd.github+json',
          'user-agent': this.#options.userAgent,
        },
        signal: timeoutSignal(this.#options.timeoutMs ?? 15_000),
        redirect: 'error',
      });
      if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}`);

      const raw = (await readJsonCapped(response, 512 * 1024, 'release')) as RawRelease;
      // A draft is not published and a prerelease is not for everyone; neither is an update.
      const usable = raw.draft !== true && raw.prerelease !== true;
      const tag = usable && typeof raw.tag_name === 'string' ? raw.tag_name : null;
      const available = tag !== null && isNewer(this.#options.current, tag);

      this.#cached = {
        current: this.#options.current,
        latest: tag,
        available,
        url: available ? releaseUrl(raw.html_url) : null,
        checkedAt: new Date(this.#now()).toISOString(),
      };
      this.#cachedAt = this.#now();
      if (available) this.#log.info({ latest: tag }, 'a newer release is available');
      return this.#cached;
    } catch (error) {
      this.#log.warn({ err: error }, 'could not check for updates');
      return this.#cached;
    }
  }
}
