import { afterEach, describe, expect, it } from 'vitest';
import { clearSecrets, registerSecret } from '../src/lib/logger.ts';
import { QueryError, parseQuery } from '../src/routes/snapshots.ts';
import { PollerBusyError, PollerHaltedError, type PollOutcome } from '../src/jobs/pollJob.ts';
import { SESSION, START, idleHealth, makeApp } from './helpers/app.ts';

afterEach(() => clearSecrets());

describe('parseQuery', () => {
  it('falls back to the configured league', () => {
    expect(parseQuery({}, 'Settlers').league).toBe('Settlers');
  });

  it('takes an explicit league, so a past league stays readable after a rollover', () => {
    expect(parseQuery({ league: 'Standard' }, 'Settlers').league).toBe('Standard');
  });

  it('parses the range', () => {
    const query = parseQuery({ from: '2026-01-01T00:00:00Z', to: '2026-01-02T00:00:00Z' }, 'Settlers');
    expect(query.from?.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('rejects a range that runs backwards', () => {
    expect(() => parseQuery({ from: '2026-01-02', to: '2026-01-01' }, 'Settlers')).toThrow(QueryError);
  });

  it('rejects an unparseable date instead of silently ignoring it', () => {
    expect(() => parseQuery({ from: 'last tuesday' }, 'Settlers')).toThrow(QueryError);
  });

  it('rejects a nonsense limit', () => {
    expect(() => parseQuery({ limit: '-5' }, 'Settlers')).toThrow(QueryError);
    expect(() => parseQuery({ limit: '2.5' }, 'Settlers')).toThrow(QueryError);
  });

  it('caps a heavy request harder than a light one', () => {
    expect(parseQuery({ limit: '999999' }, 'Settlers').limit).toBe(10_000);
    expect(parseQuery({ limit: '999999', full: '1' }, 'Settlers').limit).toBe(2_000);
  });
});

describe('GET /api/snapshots', () => {
  it('returns the series without the breakdown', async () => {
    const { app } = await makeApp();
    const response = await app.inject({ method: 'GET', url: '/api/snapshots' });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.count).toBe(3);
    expect(body.snapshots[0]).not.toHaveProperty('breakdown');
    expect(body.snapshots[0].totalChaos).toBe(1000);
  });

  it('returns oldest first, which is what a chart wants', async () => {
    const { app } = await makeApp();
    const body = (await app.inject({ method: 'GET', url: '/api/snapshots' })).json();
    expect(body.snapshots.map((row: { totalChaos: number }) => row.totalChaos)).toEqual([1000, 1600, 1600.2]);
  });

  it('includes the breakdown only when asked', async () => {
    const { app } = await makeApp();
    const body = (await app.inject({ method: 'GET', url: '/api/snapshots?full=1' })).json();
    expect(body.snapshots[1].breakdown.Dump['The Doctor'].chaosTotal).toBe(600);
  });

  it('reduces to per-tab totals for the stacked area chart', async () => {
    const { app } = await makeApp();
    const body = (await app.inject({ method: 'GET', url: '/api/snapshots?tabs=1' })).json();

    expect(body.snapshots[1].tabs).toEqual({ Currency: 1000, Dump: 600 });
    expect(body.snapshots[1]).not.toHaveProperty('breakdown');
  });

  it('filters by range', async () => {
    const { app } = await makeApp();
    const url = `/api/snapshots?from=${new Date(START + 3_600_000).toISOString()}`;
    expect((await app.inject({ method: 'GET', url })).json().count).toBe(2);
  });

  it('keeps leagues apart', async () => {
    const { app } = await makeApp();
    const body = (await app.inject({ method: 'GET', url: '/api/snapshots?league=Standard' })).json();
    expect(body.count).toBe(1);
    expect(body.snapshots[0].totalChaos).toBe(42);
  });

  it('answers 400 with a reason for a bad query', async () => {
    const { app } = await makeApp();
    const response = await app.inject({ method: 'GET', url: '/api/snapshots?from=whenever' });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toMatch(/from is not a date/);
  });
});

describe('GET /api/snapshots/latest', () => {
  it('returns the newest snapshot with its breakdown, tab totals and top items', async () => {
    const { app } = await makeApp();
    const body = (await app.inject({ method: 'GET', url: '/api/snapshots/latest' })).json();

    expect(body.snapshot.totalChaos).toBe(1600.2);
    expect(body.tabs).toEqual({});
    expect(body.topItems).toEqual([]);
  });

  it('ranks the top items of a snapshot that has holdings', async () => {
    const { app, store } = await makeApp();
    // Drop the trailing idle snapshot, whose breakdown the seed leaves empty.
    const index = store.rows.findIndex((row) => row.totalChaos === 1600.2);
    store.rows.splice(index, 1);

    const body = (await app.inject({ method: 'GET', url: '/api/snapshots/latest' })).json();

    expect(body.topItems[0]).toMatchObject({ name: 'Chaos Orb', tab: 'Currency', chaosTotal: 1000 });
  });

  it('joins the icon in from the price set, and omits it where there is none', async () => {
    const { app, store } = await makeApp();
    const index = store.rows.findIndex((row) => row.totalChaos === 1600.2);
    store.rows.splice(index, 1);

    const body = (await app.inject({ method: 'GET', url: '/api/snapshots/latest' })).json();
    const rows = body.topItems as Array<{ name: string; icon?: string }>;

    // The fake price set knows an icon for The Doctor and none for Chaos Orb.
    expect(rows.find((row) => row.name === 'The Doctor')?.icon).toBe(
      'https://web.poecdn.com/doctor.png',
    );
    expect(rows.find((row) => row.name === 'Chaos Orb')).not.toHaveProperty('icon');
  });

  it('answers 404 before the first poll rather than an empty object', async () => {
    const { app } = await makeApp();
    const response = await app.inject({ method: 'GET', url: '/api/snapshots/latest?league=Ancestor' });
    expect(response.statusCode).toBe(404);
  });
});

describe('GET /api/changes', () => {
  it('diffs the ends of the range and joins icons in', async () => {
    const { app } = await makeApp();
    const body = (await app.inject({ method: 'GET', url: '/api/changes' })).json();

    // The seed goes 1000c of chaos, then chaos plus a Doctor, then an empty breakdown.
    // Ends of the range: everything present at the start is gone by the end.
    expect(body.from).not.toBeNull();
    expect(body.changes.map((c: { name: string }) => c.name)).toContain('Chaos Orb');
    expect(body.lostChaos).toBeLessThan(0);
  });

  it('says why rather than returning an empty diff when there is only one snapshot', async () => {
    const { app } = await makeApp();
    const body = (await app.inject({ method: 'GET', url: '/api/changes?league=Standard' })).json();

    expect(body.changes).toEqual([]);
    expect(body.reason).toMatch(/at least two/);
  });

  it('rejects a nonsense minChaos', async () => {
    const { app } = await makeApp();
    const response = await app.inject({ method: 'GET', url: '/api/changes?minChaos=-4' });
    expect(response.statusCode).toBe(400);
  });
});

describe('GET /api/item-history', () => {
  it('returns one point per snapshot in the range', async () => {
    const { app } = await makeApp();
    const body = (
      await app.inject({ method: 'GET', url: '/api/item-history?name=Chaos%20Orb' })
    ).json();

    expect(body.name).toBe('Chaos Orb');
    expect(body.points).toHaveLength(3);
    expect(body.points[0].qty).toBe(1000);
    // The trailing seeded snapshot has an empty breakdown: absence reads as zero.
    expect(body.points[2].qty).toBe(0);
  });

  it('carries the icon when the price set knows one', async () => {
    const { app } = await makeApp();
    const body = (
      await app.inject({ method: 'GET', url: '/api/item-history?name=The%20Doctor' })
    ).json();
    expect(body.icon).toBe('https://web.poecdn.com/doctor.png');
  });

  it('requires a name rather than silently answering for nothing', async () => {
    const { app } = await makeApp();
    const response = await app.inject({ method: 'GET', url: '/api/item-history' });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toMatch(/name is required/);
  });
});

describe('GET /api/leagues', () => {
  it('serves the list the setup dropdown needs', async () => {
    const { app } = await makeApp();
    const response = await app.inject({ method: 'GET', url: '/api/leagues' });

    expect(response.statusCode).toBe(200);
    expect(response.json().leagues.map((l: { id: string }) => l.id)).toContain('Settlers');
  });

  it('is behind the token like everything else', async () => {
    const { app } = await makeApp({}, { AUTH_TOKEN: 'a'.repeat(32) } as NodeJS.ProcessEnv);
    expect((await app.inject({ method: 'GET', url: '/api/leagues' })).statusCode).toBe(401);
  });
});

describe('GET /api/account', () => {
  it('reports the name GGG gives and that it matches the configured one', async () => {
    const { app } = await makeApp();
    const response = await app.inject({ method: 'GET', url: '/api/account' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      name: 'Exile#1234',
      configured: 'Exile#1234',
      matches: true,
    });
  });

  it('reports a mismatch rather than leaving the comparison to the caller', async () => {
    // The entire question this endpoint answers. A name that is merely close is refused by the
    // stash endpoint with a 403 that explains nothing.
    const { app } = await makeApp({ profile: async () => ({ name: 'Someone#9999', uuid: null }) });
    const body = (await app.inject({ method: 'GET', url: '/api/account' })).json();

    expect(body.matches).toBe(false);
    expect(body.name).toBe('Someone#9999');
    expect(body.configured).toBe('Exile#1234');
  });

  it('ignores case, which GGG does too', async () => {
    const { app } = await makeApp({ profile: async () => ({ name: 'exile#1234', uuid: null }) });
    expect((await app.inject({ method: 'GET', url: '/api/account' })).json().matches).toBe(true);
  });

  it("passes GGG's refusal through as 502 with its message intact", async () => {
    // Ours would be a guess; GGG's already says whether the session is the problem.
    const { app } = await makeApp({
      profile: async () => {
        throw new Error('GGG does not accept this session (HTTP 403)');
      },
    });
    const response = await app.inject({ method: 'GET', url: '/api/account' });

    expect(response.statusCode).toBe(502);
    expect(response.json().error).toMatch(/does not accept this session/);
  });

  it('never returns the session itself', async () => {
    const { app } = await makeApp();
    const body = (await app.inject({ method: 'GET', url: '/api/account' })).body;
    expect(body.toLowerCase()).not.toContain('poesessid');
  });

  it('is behind the token like everything else', async () => {
    const { app } = await makeApp({}, { AUTH_TOKEN: 'a'.repeat(32) } as NodeJS.ProcessEnv);
    expect((await app.inject({ method: 'GET', url: '/api/account' })).statusCode).toBe(401);
  });
});

describe('GET /api/stats', () => {
  it('reports the gain, both rates, and the best hour', async () => {
    const { app } = await makeApp();
    const body = (await app.inject({ method: 'GET', url: '/api/stats' })).json();

    expect(body.totalGainChaos).toBe(600.2);
    expect(body.chaosPerHourActive).toBe(600);
    expect(body.chaosPerHourWallClock).toBe(300.1);
    expect(body.bestHour.gainChaos).toBe(600);
  });

  it('excludes the idle interval from active hours', async () => {
    const { app } = await makeApp();
    const body = (await app.inject({ method: 'GET', url: '/api/stats' })).json();

    expect(body.activeHours).toBe(1);
    expect(body.wallClockHours).toBe(2);
    expect(body.intervals[1].idle).toBe(true);
  });

  it('answers safely for a league with no snapshots', async () => {
    const { app } = await makeApp();
    const body = (await app.inject({ method: 'GET', url: '/api/stats?league=Ancestor' })).json();
    expect(body).toMatchObject({ count: 0, chaosPerHourActive: 0, bestHour: null });
  });
});

describe('GET /api/health', () => {
  it('reports ok when the poller is healthy', async () => {
    const { app } = await makeApp();
    const body = (await app.inject({ method: 'GET', url: '/api/health' })).json();

    expect(body.status).toBe('ok');
    expect(body.rateLimit.buckets[0].remaining).toBe(42);
    expect(body.prices.divineRate).toBe(218.4);
  });

  it('reports halted, and still answers 200 so a restart loop does not start', async () => {
    const { app, poller } = await makeApp();
    poller.health = { ...idleHealth, halted: true, haltReason: 'halted after 3 consecutive failed polls' };

    const response = await app.inject({ method: 'GET', url: '/api/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe('halted');
  });

  it('reports degraded after a single failure', async () => {
    const { app, poller } = await makeApp();
    poller.health = { ...idleHealth, consecutiveFailures: 1, lastError: 'GGG returned HTTP 500' };
    expect((await app.inject({ method: 'GET', url: '/api/health' })).json().status).toBe('degraded');
  });

  it('reports unconfigured when credentials are missing', async () => {
    const { app } = await makeApp({ missing: ['POESESSID'] });
    const body = (await app.inject({ method: 'GET', url: '/api/health' })).json();
    expect(body.status).toBe('unconfigured');
    expect(body.missing).toEqual(['POESESSID']);
  });

  it('never includes the session credential', async () => {
    registerSecret(SESSION);
    const { app } = await makeApp();
    const response = await app.inject({ method: 'GET', url: '/api/health' });
    expect(response.body).not.toContain(SESSION);
  });
});

describe('POST /api/poll', () => {
  it('answers 202 as soon as the poll has started, not when it finishes', async () => {
    // A poll paces itself against GGG's rate limit — one stash request every eighteen seconds on
    // the tightest bucket — so a full stash is minutes of work. Holding the request open for
    // that long means the client gives up first and shows a network error over a poll that is
    // running perfectly well, which is exactly what happened.
    const { app, poller } = await makeApp();

    const response = await app.inject({ method: 'POST', url: '/api/poll' });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ ok: true, started: true });
    expect(poller.calls).toBe(1);
  });

  it('answers 409 when a poll is already running', async () => {
    const { app, poller } = await makeApp();
    poller.health = { ...idleHealth, running: true };

    const response = await app.inject({ method: 'POST', url: '/api/poll' });

    expect(response.statusCode).toBe(409);
    // And it must not have started a second one on top of the first.
    expect(poller.calls).toBe(0);
  });

  it('answers 503 when polling is disabled', async () => {
    const { app, poller } = await makeApp();
    poller.health = { ...idleHealth, disabledReason: 'polling disabled: POESESSID not set' };

    const response = await app.inject({ method: 'POST', url: '/api/poll' });

    expect(response.statusCode).toBe(503);
    expect(response.json().error).toMatch(/POESESSID/);
    expect(poller.calls).toBe(0);
  });

  it('still answers 202 when the poll goes on to fail', async () => {
    // The outcome cannot be this response's status any more: it arrives minutes later. It is
    // recorded in the poller's health, which is where the dashboard reads it from.
    const { app, poller } = await makeApp();
    poller.outcome = new Error('GGG returned HTTP 500 for tab 1');

    const response = await app.inject({ method: 'POST', url: '/api/poll' });
    await poller.settle();

    expect(response.statusCode).toBe(202);
    expect(poller.calls).toBe(1);
  });

  it('does not crash the process when the started poll rejects', async () => {
    // An unawaited rejection is an unhandled promise rejection, which Node treats as fatal.
    const { app, poller } = await makeApp();
    poller.outcome = new Error('GGG returned HTTP 500 for tab 1');

    const rejections: unknown[] = [];
    const onRejection = (reason: unknown): void => {
      rejections.push(reason);
    };
    process.on('unhandledRejection', onRejection);
    try {
      await app.inject({ method: 'POST', url: '/api/poll' });
      await poller.settle();
      await new Promise((resolve) => setTimeout(resolve, 10));
    } finally {
      process.off('unhandledRejection', onRejection);
    }

    expect(rejections).toEqual([]);
  });

  it('keeps a credential out of the refusal it does report', async () => {
    registerSecret(SESSION);
    const { app, poller } = await makeApp();
    poller.health = { ...idleHealth, disabledReason: `bad session POESESSID=${SESSION}` };

    const response = await app.inject({ method: 'POST', url: '/api/poll' });

    expect(response.body).not.toContain(SESSION);
  });
});

describe('GET /api/config', () => {
  it('reports the settings the frontend needs to label the charts', async () => {
    const { app } = await makeApp();
    const body = (await app.inject({ method: 'GET', url: '/api/config' })).json();

    expect(body).toMatchObject({
      league: 'Settlers',
      pollCron: '*/10 * * * *',
      minItemChaos: 2,
      configured: true,
    });
  });

  it('lists every league with history so a rollover does not hide the old one', async () => {
    const { app } = await makeApp();
    const body = (await app.inject({ method: 'GET', url: '/api/config' })).json();
    expect(body.leagues).toContain('Settlers');
    expect(body.leagues).toContain('Standard');
  });

  it('never exposes the session credential', async () => {
    registerSecret(SESSION);
    const { app } = await makeApp();
    const response = await app.inject({ method: 'GET', url: '/api/config' });

    expect(response.body).not.toContain(SESSION);
    expect(response.body.toLowerCase()).not.toContain('poesessid');
  });
});

describe('unknown routes', () => {
  it('answers 404 as JSON under /api when no SPA is mounted', async () => {
    const { app } = await makeApp();
    const response = await app.inject({ method: 'GET', url: '/api/nope' });
    expect(response.statusCode).toBe(404);
  });
});

describe('GET /api/health prices', () => {
  it('serves the two orb icons the header quotes figures in', async () => {
    // The header shows whichever orb the divine rate put the number in, so it needs the art for
    // both. This is where the rate already lives.
    const { app } = await makeApp();
    const body = (await app.inject({ method: 'GET', url: '/api/health' })).json();

    expect(body.prices.divineIcon).toBe('https://web.poecdn.com/divine.png');
    expect(body.prices.chaosIcon).toBeNull();
  });

  it('answers null rather than omitting them before the first price set', async () => {
    const { app } = await makeApp({ prices: { cached: null, isStale: () => true } });
    const body = (await app.inject({ method: 'GET', url: '/api/health' })).json();

    expect(body.prices).toMatchObject({ chaosIcon: null, divineIcon: null, divineRate: 0 });
  });
});
