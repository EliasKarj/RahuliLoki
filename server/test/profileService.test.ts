import { describe, expect, it, vi } from 'vitest';
import { ProfileError, fetchProfile, parseProfile } from '../src/services/profileService.ts';

/** The real response, transcribed from a live call. */
const PROFILE = {
  uuid: '2886fd80-f4c5-418c-8e5a-87ba0193d82f',
  name: 'elkkukkeli#6495',
  locale: null,
  twitch: { name: 'eljaass' },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const SESSION = 'f00dcafe'.repeat(4);

function options(fetchFn: typeof fetch, poesessid = SESSION) {
  return { poesessid, userAgent: 'what-remains/test', fetchFn };
}

describe('parseProfile', () => {
  it('reads the name and uuid GGG actually returns', () => {
    expect(parseProfile(PROFILE)).toEqual({
      name: 'elkkukkeli#6495',
      uuid: '2886fd80-f4c5-418c-8e5a-87ba0193d82f',
    });
  });

  it('keeps the discriminator, which is part of the name', () => {
    // Dropping it produces a name that looks right and is refused by the stash endpoint with a
    // 403 that says nothing about why — the exact dead end this call exists to end.
    expect(parseProfile(PROFILE)?.name).toContain('#6495');
  });

  it('takes the name without a uuid rather than failing on it', () => {
    expect(parseProfile({ name: 'Exile#1' })).toEqual({ name: 'Exile#1', uuid: null });
  });

  it('returns null when there is no usable name', () => {
    expect(parseProfile({ uuid: 'x' })).toBeNull();
    expect(parseProfile({ name: '   ' })).toBeNull();
    expect(parseProfile(null)).toBeNull();
    expect(parseProfile('nope')).toBeNull();
  });
});

describe('fetchProfile', () => {
  it('sends the session as a cookie and never in the URL', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(PROFILE)) as unknown as typeof fetch;
    await fetchProfile(options(fetchFn));

    const call = (fetchFn as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0];
    expect(String(call?.[0])).toBe('https://www.pathofexile.com/api/profile');
    expect(String(call?.[0])).not.toContain(SESSION);
    expect((call?.[1].headers as Record<string, string>).cookie).toBe(`POESESSID=${SESSION}`);
  });

  it('refuses to follow a redirect on a request carrying the credential', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(PROFILE)) as unknown as typeof fetch;
    await fetchProfile(options(fetchFn));

    const call = (fetchFn as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0];
    expect(call?.[1].redirect).toBe('error');
  });

  it('says the session is the problem when GGG refuses it', async () => {
    // The whole point: this call carries no account name, so a refusal here cannot be blamed on
    // the spelling of one. Saying so stops the next hour of trying different names.
    const fetchFn = vi.fn(async () => jsonResponse({ error: 'x' }, 403)) as unknown as typeof fetch;
    await expect(fetchProfile(options(fetchFn))).rejects.toThrow(/No account name would make this work/);
  });

  it('treats 401 the same way as 403', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({}, 401)) as unknown as typeof fetch;
    await expect(fetchProfile(options(fetchFn))).rejects.toBeInstanceOf(ProfileError);
  });

  it('reports other HTTP failures separately, since they are not about the session', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({}, 503)) as unknown as typeof fetch;
    await expect(fetchProfile(options(fetchFn))).rejects.toThrow(/HTTP 503/);
  });

  it('does not spend a request when there is no session to check', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(PROFILE)) as unknown as typeof fetch;
    await expect(fetchProfile(options(fetchFn, '  '))).rejects.toThrow(/no session is stored/);
    expect((fetchFn as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(0);
  });

  it('rejects an answer with no name rather than returning an empty one', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ uuid: 'x' })) as unknown as typeof fetch;
    await expect(fetchProfile(options(fetchFn))).rejects.toThrow(/without a profile name/);
  });
});
