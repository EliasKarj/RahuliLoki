/**
 * The update check.
 *
 * Two things matter here and neither is "does it parse JSON". The first is that it stays quiet
 * when it should: off means off, a failure is not an announcement, and a tag that is not newer
 * is not an update. The second is that the link it hands a person is a link to GitHub — it
 * comes out of a remote payload and ends up somewhere clickable.
 *
 * The fixture is GitHub's documented release shape. Trimmed to the fields that are read, plus
 * `draft`/`prerelease`, which exist here precisely because they have to be ignored.
 */

import { describe, expect, it, vi } from 'vitest';
import { UpdateService, releaseUrl } from '../src/services/updateService.ts';

const release = {
  tag_name: 'v1.1.0',
  html_url: 'https://github.com/EliasKarj/WhatRemains/releases/tag/v1.1.0',
  draft: false,
  prerelease: false,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function service(
  options: { body?: unknown; fetchFn?: typeof fetch; enabled?: boolean; current?: string } = {},
) {
  const fetchFn =
    options.fetchFn ??
    (vi.fn(async () => jsonResponse(options.body ?? release)) as unknown as typeof fetch);
  const svc = new UpdateService({
    current: options.current ?? '1.0.2',
    userAgent: 'what-remains/test',
    enabled: options.enabled ?? true,
    fetchFn,
    now: () => 1_700_000_000_000,
  });
  return { svc, fetchFn: fetchFn as unknown as ReturnType<typeof vi.fn> };
}

describe('releaseUrl', () => {
  it('accepts a GitHub release page', () => {
    expect(releaseUrl('https://github.com/EliasKarj/WhatRemains/releases/tag/v1.1.0')).toBe(
      'https://github.com/EliasKarj/WhatRemains/releases/tag/v1.1.0',
    );
  });

  it('rejects another host, plain http, and anything that is not a URL', () => {
    expect(releaseUrl('https://github.com.evil.test/releases')).toBeNull();
    expect(releaseUrl('http://github.com/EliasKarj/WhatRemains/releases')).toBeNull();
    expect(releaseUrl('javascript:alert(1)')).toBeNull();
    expect(releaseUrl('not a url')).toBeNull();
    expect(releaseUrl(undefined)).toBeNull();
  });
});

describe('UpdateService', () => {
  it('reports a newer release with somewhere to get it', async () => {
    const { svc } = service();
    const status = await svc.check();

    expect(status.available).toBe(true);
    expect(status.latest).toBe('v1.1.0');
    expect(status.url).toBe(release.html_url);
    expect(status.checkedAt).not.toBeNull();
  });

  it('sends no credential and follows no redirect', async () => {
    const { svc, fetchFn } = service();
    await svc.check();

    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('api.github.com');
    expect(init.redirect).toBe('error');
    const headers = init.headers as Record<string, string>;
    expect(Object.keys(headers).map((key) => key.toLowerCase()).sort()).toEqual([
      'accept',
      'user-agent',
    ]);
  });

  it('says nothing is available when the published release is the one running', async () => {
    const { svc } = service({ current: '1.1.0' });
    const status = await svc.check();

    expect(status.available).toBe(false);
    expect(status.url).toBeNull();
    // Still worth reporting what the latest one is: "checked, nothing new" is an answer.
    expect(status.latest).toBe('v1.1.0');
  });

  it('ignores a draft and a prerelease', async () => {
    const draft = await service({ body: { ...release, draft: true } }).svc.check();
    const pre = await service({ body: { ...release, prerelease: true } }).svc.check();

    expect(draft.available).toBe(false);
    expect(draft.latest).toBeNull();
    expect(pre.available).toBe(false);
  });

  it('never links anywhere but GitHub, whatever the payload says', async () => {
    const { svc } = service({
      body: { ...release, html_url: 'https://downloads.evil.test/WhatRemains-setup.exe' },
    });
    const status = await svc.check();

    expect(status.available).toBe(true);
    expect(status.url).toBeNull();
  });

  it('asks once and answers from the cache after that', async () => {
    const { svc, fetchFn } = service();
    await svc.check();
    await svc.check();

    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('makes one request when several checks overlap', async () => {
    const { svc, fetchFn } = service();
    await Promise.all([svc.check(), svc.check(), svc.check()]);

    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('makes no request at all when switched off', async () => {
    const { svc, fetchFn } = service({ enabled: false });
    const status = await svc.check();

    expect(fetchFn).not.toHaveBeenCalled();
    expect(status.checkedAt).toBeNull();
    expect(status.available).toBe(false);
  });

  it('keeps quiet when GitHub will not answer', async () => {
    const failing = vi.fn(async () => {
      throw new Error('getaddrinfo ENOTFOUND api.github.com');
    }) as unknown as typeof fetch;
    const { svc } = service({ fetchFn: failing });
    const status = await svc.check();

    expect(status.available).toBe(false);
    expect(status.latest).toBeNull();
    // Unchecked, not up to date. The dashboard shows nothing either way, but the two are not
    // the same claim and the status must not conflate them.
    expect(status.checkedAt).toBeNull();
  });

  it('keeps quiet on an HTTP error and on a body that is not a release', async () => {
    const rateLimited = await service({
      fetchFn: (vi.fn(async () => jsonResponse({ message: 'API rate limit exceeded' }, 403)) as unknown as typeof fetch),
    }).svc.check();
    const nonsense = await service({ body: { tag_name: 42 } }).svc.check();

    expect(rateLimited.available).toBe(false);
    expect(nonsense.available).toBe(false);
    expect(nonsense.latest).toBeNull();
  });

  it('reports the running version before anything has been checked', () => {
    const { svc } = service();
    expect(svc.status).toEqual({
      current: '1.0.2',
      latest: null,
      available: false,
      url: null,
      checkedAt: null,
    });
  });
});
