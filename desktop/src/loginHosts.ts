/**
 * Where the login window is allowed to go.
 *
 * The guard exists because the window is a real browser holding a real session: without it, one
 * redirect could take a page that looks like GGG's login somewhere else entirely, while the user
 * keeps typing into it. That risk is real and the guard stays.
 *
 * What it may not do is make logging in impossible. A Path of Exile account can be a Steam
 * account, and that flow leaves pathofexile.com on purpose: GGG hands off to Steam's OpenID
 * endpoint, the user authenticates on Steam's own pages, and Steam sends them back. An allowlist
 * of pathofexile.com alone refuses every one of those steps.
 *
 * That is what happened. The first hop arrived as an HTTP redirect, which `will-navigate` does
 * not see, so Steam's page loaded — and then every click inside it was refused, silently, and
 * the window sat there looking broken. Two fixes, both here: Steam's hosts are allowed, and
 * refusals are no longer silent.
 *
 * Kept in its own module, free of Electron, so the matching can be tested. Getting this wrong in
 * either direction is expensive: too narrow and nobody can log in, too wide and the guard is
 * decoration.
 */

/**
 * Registrable domains the login flow may visit. Matched as the domain itself or any subdomain,
 * never as a suffix of a longer name — `evilpathofexile.com` is not `pathofexile.com`.
 */
export const LOGIN_HOSTS: readonly string[] = [
  'pathofexile.com',
  // Steam's login lives across several of these: store.steampowered.com for the sign-in form,
  // login.steampowered.com for the newer token service, steamcommunity.com for OpenID itself,
  // and help.steampowered.com when someone has to recover an account mid-flow.
  'steampowered.com',
  'steamcommunity.com',
];

export function allowedHost(url: string, hosts: readonly string[] = LOGIN_HOSTS): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  // https only. A login page reached over http is not one worth typing a password into, and
  // about:/file:/data: URLs have no business in this window at all.
  if (parsed.protocol !== 'https:') return false;

  const hostname = parsed.hostname.toLowerCase();
  return hosts.some((allowed) => hostname === allowed || hostname.endsWith(`.${allowed}`));
}
