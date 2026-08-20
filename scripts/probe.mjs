#!/usr/bin/env node
/**
 * The questions this project cannot answer from where it is developed.
 *
 * Some facts about GGG and poe.ninja are only observable from a machine that can reach them
 * with a real account behind it. Guessing them and writing the guess into the source is how a
 * constant ends up stale and wrong in two comments at once, so instead: a script you run, whose
 * output is the evidence.
 *
 * Everything here is read-only. It makes GET requests, it writes no files, and it changes
 * nothing about your account or your installation.
 *
 * ## The credential
 *
 * POESESSID is read from the settings file the desktop app already wrote. You never paste it
 * anywhere, it is never printed, and it is sent to exactly one host — pathofexile.com — in a
 * Cookie header, the same way the application sends it. Every line this script prints is run
 * through a scrub that replaces the session with `********` even if it somehow arrives in an
 * error message.
 *
 *   node scripts/probe.mjs                 everything, gently
 *   node scripts/probe.mjs --limits        just GGG's rate-limit policy (one request)
 *   node scripts/probe.mjs --ninja         just poe.ninja: dust fields, unique prices
 *   node scripts/probe.mjs --time-poll     read every tab and time it (costs a poll's budget)
 *   node scripts/probe.mjs --item Goldrim  dump one unique's raw fields
 *   node scripts/probe.mjs --item Goldrim --tab 3   look in tab 3 instead of the first
 *
 * Requires Node 22 or newer, which the repository already needs. No dependencies.
 */

import { readFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';

const args = new Set(process.argv.slice(2));
const flag = (name) => args.has(`--${name}`);
const value = (name) => {
  const prefix = `--${name}=`;
  for (const arg of process.argv.slice(2)) if (arg.startsWith(prefix)) return arg.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

const CONTACT = process.env.POE_CONTACT ?? 'set POE_CONTACT to your email or discord';
const USER_AGENT = `what-remains-probe/1.0 (+https://github.com/EliasKarj/WhatRemains) ${CONTACT}`;

/* ------------------------------------------------------------------ credential and settings */

/** Where Electron puts userData for a product called "What Remains". */
function settingsPath() {
  const explicit = value('settings');
  if (explicit) return explicit;
  const name = 'What Remains';
  if (platform() === 'win32') {
    return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), name, 'settings.json');
  }
  if (platform() === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', name, 'settings.json');
  }
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), name, 'settings.json');
}

function loadSettings() {
  const file = settingsPath();
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    return {
      file,
      poesessid: typeof raw.poesessid === 'string' ? raw.poesessid : '',
      accountName: typeof raw.accountName === 'string' ? raw.accountName : '',
      league: typeof raw.league === 'string' ? raw.league : 'Standard',
    };
  } catch (error) {
    return { file, poesessid: '', accountName: '', league: 'Standard', error };
  }
}

const settings = loadSettings();
const POESESSID = process.env.POESESSID ?? settings.poesessid;
const ACCOUNT = value('account') ?? process.env.POE_ACCOUNT_NAME ?? settings.accountName;
const LEAGUE = value('league') ?? process.env.POE_LEAGUE ?? settings.league;

/**
 * Replace the session with asterisks wherever it appears, including in something GGG echoed.
 *
 * The length floor is not fussiness. A real POESESSID is thirty-two hex characters, but a probe
 * run with `POESESSID=x` to see what happens would otherwise replace every letter x in the
 * output — and the first thing that mangles is the hostname in the error telling you what went
 * wrong. Below eight characters it cannot be a session, so scrubbing it destroys the report
 * without protecting anything.
 */
function scrub(text) {
  const line = String(text);
  if (POESESSID.length < 8) return line;
  return line.split(POESESSID).join('********');
}

const say = (...parts) => console.log(scrub(parts.join(' ')));
const head = (title) => {
  console.log('');
  console.log(`── ${title} ${'─'.repeat(Math.max(0, 62 - title.length))}`);
};

/* --------------------------------------------------------------------------------- requests */

async function ggg(tabIndex, withTabs) {
  const params = new URLSearchParams({
    accountName: ACCOUNT,
    league: LEAGUE,
    tabIndex: String(tabIndex),
    tabs: withTabs ? '1' : '0',
  });
  return fetch(`https://www.pathofexile.com/character-window/get-stash-items?${params}`, {
    headers: {
      cookie: `POESESSID=${POESESSID}`,
      accept: 'application/json',
      'user-agent': USER_AGENT,
    },
    redirect: 'error',
  });
}

/** Every rate-limit header GGG sent, verbatim. This is the whole point of the exercise. */
function printRateLimitHeaders(response) {
  const interesting = [...response.headers.keys()]
    .filter((key) => key.toLowerCase().includes('rate-limit') || key.toLowerCase() === 'retry-after')
    .sort();

  if (interesting.length === 0) {
    say('  no rate-limit headers at all — which is itself worth knowing');
    return;
  }
  for (const key of interesting) say(`  ${key}: ${response.headers.get(key)}`);
}

/* ------------------------------------------------------------------------------- the probes */

async function probeLimits() {
  head('GGG: the rate-limit policy, from one request');
  say(`account "${ACCOUNT}", league "${LEAGUE}"`);

  const started = Date.now();
  let response;
  try {
    response = await ggg(0, true);
  } catch (error) {
    say(`  request failed: ${error?.message ?? error}`);
    return null;
  }
  say(`  HTTP ${response.status} in ${Date.now() - started} ms`);
  printRateLimitHeaders(response);

  if (response.status === 403 || response.status === 401) {
    const body = await response.text().catch(() => '');
    say(`  refused. The body says which of the three reasons it is:`);
    say(`  ${body.replace(/\s+/g, ' ').slice(0, 300)}`);
    return null;
  }
  if (!response.ok) return null;

  const payload = await response.json();
  const tabs = Array.isArray(payload.tabs) ? payload.tabs : [];
  say(`  tabs in this league: ${tabs.length}`);
  return { tabs, firstItems: Array.isArray(payload.items) ? payload.items : [] };
}

/**
 * Read every tab and time it, honouring whatever the headers say as we go.
 *
 * Deliberately serial and deliberately cautious: this spends real rate-limit budget, and the
 * point is to measure how long an honest read takes, not to find the fastest way to get an
 * account restricted.
 */
async function timePoll(tabs) {
  head('GGG: how long a full read actually takes');
  if (tabs.length === 0) {
    say('  no tabs to read');
    return;
  }
  say(`  reading ${tabs.length} tabs, one at a time, pausing when the headers ask`);

  const started = Date.now();
  let worstState = '';
  for (let index = 1; index < tabs.length; index += 1) {
    const response = await ggg(index, false);
    const state = response.headers.get('x-rate-limit-account-state') ?? '';
    if (state.length > worstState.length) worstState = state;

    if (response.status === 429) {
      const retry = response.headers.get('retry-after');
      say(`  429 at tab ${index}. Retry-After: ${retry}. Stopping — this is the answer to how`);
      say('  hard the limit bites, and there is no point provoking it twice.');
      return;
    }
    // Drain the body so the socket is reused rather than left hanging.
    await response.arrayBuffer().catch(() => undefined);

    // A gentle floor of our own while probing, unrelated to what the app does.
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  const elapsed = Date.now() - started;
  say(`  ${tabs.length} tabs in ${(elapsed / 1000).toFixed(1)} s`);
  say(`  furthest the state header got: ${worstState}`);
  say('  (this script paces itself at 250 ms; the app paces off the headers instead)');
}

/**
 * One unique, printed field by field, to check what the app is and is not reading.
 *
 * `--tab N` costs one extra request; without it the search runs over the items the listing call
 * already returned, which is the first tab and free.
 */
async function probeItem(firstTabItems, wanted, tabIndex) {
  head(`GGG: the raw fields on one unique ("${wanted}")`);

  let items = firstTabItems;
  if (tabIndex !== undefined) {
    const response = await ggg(tabIndex, false);
    if (!response.ok) {
      say(`  tab ${tabIndex} answered HTTP ${response.status}`);
      return;
    }
    const payload = await response.json();
    items = Array.isArray(payload.items) ? payload.items : [];
    say(`  tab ${tabIndex} holds ${items.length} items`);
  }

  const match = items.find(
    (item) => typeof item?.name === 'string' && item.name.toLowerCase().includes(wanted.toLowerCase()),
  );
  if (!match) {
    const where = tabIndex === undefined ? 'the first tab' : `tab ${tabIndex}`;
    say(`  no unique matching "${wanted}" in ${where}.`);
    say('  Try --tab N for another one, or move a copy into the first tab and re-run.');
    return;
  }
  say(`  keys GGG sent: ${Object.keys(match).sort().join(', ')}`);
  say(`  name: ${match.name}`);
  say(`  baseType: ${match.baseType ?? '(none)'}`);
  say(`  ilvl: ${match.ilvl ?? '(none)'}`);
  say(`  frameType: ${match.frameType}   identified: ${match.identified}   corrupted: ${match.corrupted}`);
  say(`  properties: ${JSON.stringify(match.properties ?? null)}`);
  say('');
  say('  What matters here: is there an ilvl, and does quality appear inside properties as a');
  say('  rendered string? Those are what the Kingsmarch view reads.');
}

const NINJA = 'https://poe.ninja/poe1/api/economy/exchange/current/overview';

async function ninja(type) {
  const url = `${NINJA}?league=${encodeURIComponent(LEAGUE)}&type=${encodeURIComponent(type)}`;
  try {
    const response = await fetch(url, {
      headers: { accept: 'application/json', 'user-agent': USER_AGENT },
    });
    if (!response.ok) return { ok: false, status: response.status };
    return { ok: true, body: await response.json() };
  } catch (error) {
    // Offline, DNS, a proxy in the way. A probe that crashes tells you less than one that says
    // which of its questions it could not ask.
    return { ok: false, status: `unreachable (${error?.cause?.code ?? error?.message ?? 'error'})` };
  }
}

/** Every key anywhere in an object graph, so a field nobody expected still shows up. */
function allKeys(node, into = new Set(), depth = 0) {
  if (depth > 6 || node === null || typeof node !== 'object') return into;
  if (Array.isArray(node)) {
    for (const child of node.slice(0, 5)) allKeys(child, into, depth + 1);
    return into;
  }
  for (const [key, child] of Object.entries(node)) {
    into.add(key);
    allKeys(child, into, depth + 1);
  }
  return into;
}

async function probeNinja() {
  head('poe.ninja: is there a dust value anywhere in the payload?');

  for (const type of ['Currency', 'UniqueArmour', 'UniqueWeapon']) {
    const result = await ninja(type);
    if (!result.ok) {
      say(`  ${type}: HTTP ${result.status}`);
      continue;
    }
    const keys = [...allKeys(result.body)].sort();
    const dusty = keys.filter((key) => /dust|disench|thaum/i.test(key));
    const lines = Array.isArray(result.body?.lines) ? result.body.lines : [];

    say(`  ${type}: ${lines.length} lines`);
    say(`    dust-ish keys: ${dusty.length === 0 ? 'none' : dusty.join(', ')}`);
    if (lines.length > 0) {
      say(`    a line looks like: ${JSON.stringify(lines[0]).slice(0, 220)}`);
    }
    const named = Array.isArray(result.body?.core?.items) ? result.body.core.items.length : 0;
    say(`    items named in core.items: ${named}`);
    await new Promise((resolve) => setTimeout(resolve, 400));
  }

  say('');
  say('  What matters here:');
  say('   1. Any dust-ish key at all — if poe.ninja publishes dust, the app needs no formula.');
  say('   2. Whether the unique overviews return lines with usable ids. If they do, unique');
  say('      prices can be fetched into a map of their own and dust-per-chaos becomes possible.');
}

/**
 * Which `type=` values poe.ninja actually serves.
 *
 * Asked because the obvious guesses came back empty. An endpoint answering 200 with zero lines
 * says nothing about whether the data exists under a name nobody tried, and the app's own list
 * of categories is a list of guesses of exactly the same kind.
 */
async function probeTypes() {
  head('poe.ninja: which type= values return anything');

  const candidates = [
    'Currency', 'Fragment', 'DivinationCard', 'Essence', 'Fossil', 'Resonator', 'Scarab', 'Oil',
    'DeliriumOrb', 'Incubator', 'Artifact', 'Vial', 'Omen', 'Tattoo', 'Coffin', 'AllflameEmber',
    'UniqueArmour', 'UniqueWeapon', 'UniqueAccessory', 'UniqueFlask', 'UniqueJewel', 'UniqueMap',
    'UniqueRelic', 'Unique', 'SkillGem', 'ClusterJewel', 'Map', 'BlightedMap', 'Invitation',
    'Memory', 'BaseType', 'HelmetEnchant', 'Beast',
  ];

  const served = [];
  const empty = [];
  const failed = [];

  for (const type of candidates) {
    const result = await ninja(type);
    if (!result.ok) failed.push(`${type} (${result.status})`);
    else {
      const lines = Array.isArray(result.body?.lines) ? result.body.lines.length : 0;
      if (lines > 0) served.push(`${type}=${lines}`);
      else empty.push(type);
    }
    // Somebody else's free service. One every 300 ms is polite for a one-off probe.
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  say(`  returns lines: ${served.length === 0 ? 'none' : served.join(', ')}`);
  say('');
  say(`  answers but empty: ${empty.length === 0 ? 'none' : empty.join(', ')}`);
  say(`  failed outright:   ${failed.length === 0 ? 'none' : failed.join(', ')}`);
  say('');
  say('  A type in the first list that this app does not fetch is a category of prices it is');
  say('  currently blind to. A unique type in that list is what dust-per-chaos needs.');
}

/* ------------------------------------------------------------------------------------- main */

head('What Remains — probe');
say(`settings file: ${settings.file}`);
if (settings.error) say(`  could not be read (${settings.error.code ?? 'error'}) — falling back to env vars`);
say(`session: ${POESESSID === '' ? 'MISSING' : `present, ${POESESSID.length} characters`}`);
say(`account: ${ACCOUNT || 'MISSING'}`);
say(`league:  ${LEAGUE}`);
if (CONTACT.startsWith('set ')) {
  say('');
  say('note: POE_CONTACT is unset, so the User-Agent has no contact details in it. GGG asks for');
  say('      one. Set it before running anything that makes more than a couple of requests.');
}

const onlyNinja = flag('ninja');
const onlyLimits = flag('limits');

if (!onlyNinja) {
  if (POESESSID === '' || ACCOUNT === '') {
    head('GGG');
    say('  Skipped: no session or account name. Sign in through the app first, or set');
    say('  POESESSID and POE_ACCOUNT_NAME in the environment.');
  } else {
    const listing = await probeLimits();
    if (listing) {
      const wanted = value('item');
      if (wanted) {
        const rawTab = value('tab');
        const tabIndex = rawTab === undefined ? undefined : Number(rawTab);
        await probeItem(
          listing.firstItems,
          wanted,
          Number.isInteger(tabIndex) && tabIndex >= 0 ? tabIndex : undefined,
        );
      }
      if (flag('time-poll')) await timePoll(listing.tabs);
      else if (!onlyLimits) {
        head('GGG: full read');
        say('  Skipped. Add --time-poll to read every tab and time it; it spends real budget.');
      }
    }
  }
}

if (flag('types')) await probeTypes();
else if (!onlyLimits) await probeNinja();

head('done');
say('Paste the output above into the conversation. Nothing in it contains your session.');
