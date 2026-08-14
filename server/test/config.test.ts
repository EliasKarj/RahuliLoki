import { describe, expect, it } from 'vitest';
import { ConfigError, isValidCron, loadConfig, publicConfig } from '../src/lib/config.ts';

const base = {
  POESESSID: 'a'.repeat(32),
  POE_ACCOUNT_NAME: 'Exile#1234',
  POE_LEAGUE: 'Settlers',
};

describe('isValidCron', () => {
  it('accepts five and six field expressions', () => {
    expect(isValidCron('*/10 * * * *')).toBe(true);
    expect(isValidCron('0 */4 * * 1-5')).toBe(true);
    expect(isValidCron('*/30 * * * * *')).toBe(true);
  });

  it('rejects anything that is not a cron expression', () => {
    expect(isValidCron('every 10 minutes')).toBe(false);
    expect(isValidCron('*/10 * *')).toBe(false);
    expect(isValidCron('')).toBe(false);
  });
});

describe('loadConfig', () => {
  it('reads a complete environment', () => {
    const { config, missing, leagueDefaulted } = loadConfig({
      ...base,
      POLL_CRON: '*/5 * * * *',
      MIN_ITEM_CHAOS: '5',
      TRACKED_TABS: 'Currency, Dump ,Fragments',
      PORT: '8080',
    } as NodeJS.ProcessEnv);

    expect(missing).toEqual([]);
    expect(leagueDefaulted).toBe(false);
    expect(config.league).toBe('Settlers');
    expect(config.pollCron).toBe('*/5 * * * *');
    expect(config.minItemChaos).toBe(5);
    expect(config.trackedTabs).toEqual(['Currency', 'Dump', 'Fragments']);
    expect(config.port).toBe(8080);
  });

  it('defaults the schedule, the threshold and an empty allowlist', () => {
    const { config } = loadConfig(base as NodeJS.ProcessEnv);
    expect(config.pollCron).toBe('*/10 * * * *');
    expect(config.minItemChaos).toBe(2);
    expect(config.trackedTabs).toEqual([]);
    expect(config.priceTtlMs).toBe(3_600_000);
  });

  it('reports missing credentials instead of throwing, so the API still boots', () => {
    const { config, missing } = loadConfig({ POE_LEAGUE: 'Settlers' } as NodeJS.ProcessEnv);
    expect(missing).toEqual(['POESESSID', 'POE_ACCOUNT_NAME']);
    expect(config.league).toBe('Settlers');
  });

  it('flags a defaulted league, which is almost never what somebody wanted', () => {
    const { config, leagueDefaulted } = loadConfig({
      POESESSID: base.POESESSID,
      POE_ACCOUNT_NAME: base.POE_ACCOUNT_NAME,
    } as NodeJS.ProcessEnv);
    expect(leagueDefaulted).toBe(true);
    expect(config.league).toBe('Standard');
  });

  it('refuses a cron expression that would only fail at the first tick', () => {
    expect(() => loadConfig({ ...base, POLL_CRON: 'hourly' } as NodeJS.ProcessEnv)).toThrow(ConfigError);
  });

  it('refuses a non-numeric threshold', () => {
    expect(() => loadConfig({ ...base, MIN_ITEM_CHAOS: 'two' } as NodeJS.ProcessEnv)).toThrow(ConfigError);
  });

  it('refuses a negative threshold', () => {
    expect(() => loadConfig({ ...base, MIN_ITEM_CHAOS: '-1' } as NodeJS.ProcessEnv)).toThrow(ConfigError);
  });

  it('puts a contact in the User-Agent so GGG can reach the operator', () => {
    const { config } = loadConfig({ ...base, POE_CONTACT: 'me@example.com' } as NodeJS.ProcessEnv);
    expect(config.userAgent).toContain('valuuttaloki/');
    expect(config.userAgent).toContain('me@example.com');
  });
});

describe('publicConfig', () => {
  it('never exposes the session credential', () => {
    const { config, missing } = loadConfig(base as NodeJS.ProcessEnv);
    const body = JSON.stringify(publicConfig(config, missing));

    expect(body).not.toContain(base.POESESSID);
    expect(body).not.toContain('poesessid');
    expect(JSON.parse(body)).toMatchObject({ league: 'Settlers', configured: true });
  });
});
