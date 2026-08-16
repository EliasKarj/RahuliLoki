/**
 * Who does this session actually belong to?
 *
 *   GET https://www.pathofexile.com/api/profile
 *   → {"uuid":"…","name":"Exile#1234","locale":null,"twitch":{"name":"…"}}
 *
 * This exists because a 403 from the stash endpoint has two indistinguishable causes and no way
 * to tell them apart from the outside: a session GGG will not accept, or a session it accepts
 * for an account other than the one `accountName` names. Both come back as
 * `{"error":{"code":6,"message":"Forbidden"}}`.
 *
 * `/api/profile` splits them, because it needs only the session and no account name at all:
 *
 *   It answers with a name  → the session works, and that name is what accountName must be.
 *   It refuses              → the session is the problem, and no spelling of the name would help.
 *
 * That also makes the account name something the app can fill in rather than something a person
 * has to type correctly. A hand-typed name is a pure liability when the session already knows
 * the answer — and it cost this project several rounds of looking in the wrong place.
 *
 * The request is one call, made on demand, never on a schedule. It is GGG's infrastructure and
 * carries the account credential, so it goes out with the same User-Agent, the same timeout and
 * the same refusal to follow redirects as every other call that carries POESESSID.
 */

import { readJsonCapped, timeoutSignal } from '../lib/http.ts';

export interface Profile {
  /** Exactly as GGG spells it, discriminator included. */
  name: string;
  uuid: string | null;
}

export class ProfileError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = 'ProfileError';
    this.status = status;
  }
}

/**
 * Narrow GGG's payload.
 *
 * Only `name` is required — it is the entire point of the call, and a response without one is
 * not usable no matter what else it carries. `uuid` is taken when present and never depended on.
 */
export function parseProfile(payload: unknown): Profile | null {
  const record = payload as { name?: unknown; uuid?: unknown } | null;
  const name = typeof record?.name === 'string' ? record.name.trim() : '';
  if (name === '') return null;
  return { name, uuid: typeof record?.uuid === 'string' ? record.uuid : null };
}

export interface ProfileServiceOptions {
  poesessid: string;
  userAgent: string;
  fetchFn?: typeof fetch;
  baseUrl?: string;
  timeoutMs?: number;
}

/** Ask GGG who this session is. Throws ProfileError when it will not say. */
export async function fetchProfile(options: ProfileServiceOptions): Promise<Profile> {
  if (options.poesessid.trim() === '') {
    throw new ProfileError('no session is stored, so there is nothing to check');
  }

  const url = options.baseUrl ?? 'https://www.pathofexile.com/api/profile';
  const response = await (options.fetchFn ?? globalThis.fetch)(url, {
    headers: {
      // Same rule as the stash call: the credential travels as a cookie and only as a cookie.
      cookie: `POESESSID=${options.poesessid}`,
      accept: 'application/json',
      'user-agent': options.userAgent,
    },
    signal: timeoutSignal(options.timeoutMs ?? 15_000),
    redirect: 'error',
  });

  if (response.status === 401 || response.status === 403) {
    throw new ProfileError(
      `GGG does not accept this session (HTTP ${response.status} from ${url}). It is expired or ` +
        'not a session at all — sign in again. No account name would make this work.',
      response.status,
    );
  }
  if (!response.ok) {
    throw new ProfileError(`GGG returned HTTP ${response.status} from ${url}`, response.status);
  }

  const profile = parseProfile(await readJsonCapped(response, 64 * 1024, 'GGG profile'));
  if (profile === null) {
    throw new ProfileError('GGG answered without a profile name; nothing to check against');
  }
  return profile;
}
