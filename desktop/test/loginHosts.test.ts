import { describe, expect, it } from 'vitest';
import { LOGIN_HOSTS, allowedHost } from '../src/loginHosts.ts';

describe('allowedHost', () => {
  it('allows GGG and its subdomains', () => {
    expect(allowedHost('https://www.pathofexile.com/login')).toBe(true);
    expect(allowedHost('https://pathofexile.com/my-account')).toBe(true);
  });

  it('allows the Steam login flow, which a PoE account may require', () => {
    // A Path of Exile account can be a Steam account. GGG hands off to Steam's OpenID endpoint,
    // the user authenticates on Steam's own pages, and Steam sends them back. Refusing these
    // does not make the window safer — it makes logging in impossible, which is exactly what it
    // did: Steam's page loaded via a redirect and then every click inside it was blocked.
    expect(allowedHost('https://steamcommunity.com/openid/login')).toBe(true);
    expect(allowedHost('https://store.steampowered.com/login/')).toBe(true);
    expect(allowedHost('https://login.steampowered.com/jwt/refresh')).toBe(true);
    expect(allowedHost('https://help.steampowered.com/en/wizard/HelpWithLogin')).toBe(true);
  });

  it('refuses a host that merely ends with an allowed name', () => {
    // The reason the check is anchored on a dot rather than a bare suffix. Anyone can register
    // evilpathofexile.com, and a login window that trusted it would be worse than no guard.
    expect(allowedHost('https://evilpathofexile.com/login')).toBe(false);
    expect(allowedHost('https://notsteampowered.com/')).toBe(false);
    expect(allowedHost('https://pathofexile.com.attacker.test/')).toBe(false);
  });

  it('refuses anything that is not https', () => {
    // A login page reached over http is not one worth typing a password into, and these schemes
    // have no business in this window at all.
    expect(allowedHost('http://www.pathofexile.com/login')).toBe(false);
    expect(allowedHost('file:///etc/passwd')).toBe(false);
    expect(allowedHost('javascript:alert(1)')).toBe(false);
    expect(allowedHost('data:text/html,<h1>hi</h1>')).toBe(false);
    expect(allowedHost('about:blank')).toBe(false);
  });

  it('refuses a string that is not a URL rather than throwing', () => {
    expect(allowedHost('')).toBe(false);
    expect(allowedHost('not a url')).toBe(false);
  });

  it('ignores case in the hostname', () => {
    expect(allowedHost('https://WWW.PathOfExile.com/login')).toBe(true);
  });

  it('is limited to the hosts the login actually needs', () => {
    // A guard that grows without anyone noticing is decoration. If this list changes, the change
    // should be deliberate enough to update the test with it.
    expect([...LOGIN_HOSTS].sort()).toEqual([
      'pathofexile.com',
      'steamcommunity.com',
      'steampowered.com',
    ]);
  });
});
