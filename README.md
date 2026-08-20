<div align="center">

# What Remains

**A Path of Exile wealth tracker that collects on its own. No button to press, no account handed
to a third party — your machine, your database.**

*What was left of the league after it burned through.*

`desktop app` · `self-hosted` · `single user` · `SQLite`

</div>

---

## What it does

Every ten minutes, a background process

1. fetches poe.ninja's prices (cached for an hour),
2. reads your stash tabs from GGG's API, one at a time,
3. values every item, multiplies by the stack size and drops the noise,
4. writes **one row**: total worth in chaos and in divine, the divine rate at that moment, the
   item count, and a per-tab breakdown.

The page reads those rows and draws your net worth, your gain, the item table and what moved.
Nothing needs pressing: the chart is up to date when you open it after a week away.

Collection continues with the window closed — which is this app's advantage over Exilence Next,
which only recorded while it was open.

---

## Install

**[Download an installer from the releases](https://github.com/EliasKarj/WhatRemains/releases/latest)**
— Windows (`.exe`), macOS (`.dmg`) or Linux (`.AppImage`). Install it, launch it, press *Sign in
to Path of Exile*. The app opens GGG's own login page in its own window; there is no POESESSID to
dig out of devtools and nowhere to paste one.

The other ways to run it — from source, Docker, Fly.io, `./start.sh` — are in the
**[installation guide](docs/installation.md)**, along with backups and upgrading from the old
valuuttaloki.

```bash
# From source, if you would rather build it yourself:
pnpm install
pnpm desktop            # builds and launches
pnpm desktop:package    # builds an installer for this platform
```

---

## Using it

Two views, named by the rail on the left. **Dashboard** is what you own and what it is doing.
**Economy** is every item poe.ninja prices, with what it costs, how far it has moved and a trend
line — searchable by name, by poe.ninja's own id (`gcp`, `alt`) or by category, for the twenty
times a league you want to know what something is worth without owning any of it. Click a name
for that item's price history as this app has watched it. It uses the prices already fetched for
the valuation, so opening it sends nothing anywhere.

Your account and settings live in the **top-right corner**: a small button showing the account
name, with a dot that says whether a session is stored. There is exactly one button to press in
the panel — signing in; the fields save themselves.

| Setting | What it does |
|---------|--------------|
| Account name | Comes from GGG when you sign in. Typeable only as a fallback. |
| League | Saves as soon as you pick it. *Other…* for private leagues. |
| Interval | 5 / 10 / 15 / 30 / 60 min. Too tight a choice says so itself — see below. |
| Background collection | Closing the window hides it to the tray; the collector keeps going. |
| Check for new versions | One request a day to GitHub, carrying no account details. Off means the app never contacts it. |

The top row is the state: when it last collected, how old the prices are, how much of GGG's rate
limit is left, and **a countdown to the next automatic poll**. When a newer version exists, a
line under it says so and links to the release page — the app never installs anything itself.

> **▸ Why five minutes does not fit a large stash:** one poll costs one request per tab, and
> GGG's stash limit is 200 requests an hour. Nineteen tabs every five minutes is 228 — over
> budget. Nothing breaks: the limiter paces itself and polls stretch out. But that is slowing
> down rather than speeding up, so the menu says it out loud. At ten minutes the same stash is
> 114 and fits comfortably.

---

## Documentation

Every choice comes with a **▸ Why this way** note: what a threshold is based on, and what it
does not tell you.

| | |
|---|---|
| **[Installation](docs/installation.md)** | Desktop app, `./start.sh`, Docker, Fly.io, backups, upgrading from valuuttaloki |
| **[Credentials and access](docs/credentials.md)** | Why POESESSID is as good as a password, why GGG's OAuth will not do here, what `AUTH_TOKEN` protects |
| **[What the page shows](docs/interface.md)** | The views, the Citadel at the End of Time look, and how the numbers are computed |
| **[Where the numbers come from](docs/data.md)** | GGG's rate limit, poe.ninja's prices, resolving item names |
| **[Development](docs/development.md)** | Environment variables, the API, tests, project layout |

---

## Credentials, briefly

POESESSID **is a session cookie, not a scoped API key**. It can do everything on the site that
you can: read your stash, list items for sale, post on the forum. So it

- never reaches a log, a browser, a URL or a process argument,
- is stored `0600` in your own application data directory,
- is read from GGG's own login window, never from a text field.

The server **refuses to start** on a public interface without an `AUTH_TOKEN`. The reasoning and
the threat model: **[Credentials and access](docs/credentials.md)**.

---

## Cutting a release

1. Bump the version in the four `package.json` files and in `server/src/lib/config.ts`. The two
   have to agree: the version in `config.ts` is the one an installed copy compares against the
   published tag when it checks for updates.
2. Tag it — `vMAJOR.MINOR.PATCH`, since anything else is not read as a release:

```
git tag v1.0.1
git push origin v1.0.1
```

Two lines rather than one joined by `&&`: Windows PowerShell 5.1 — still the default on
Windows 10 and 11 — parses `&&` as an error rather than as a separator.

`.github/workflows/release.yml` builds the installers for Windows, macOS and Linux each on its
own runner, runs the tests before packaging, and attaches the results to the release.

---

## Licence

MIT. Not affiliated with Grinding Gear Games.
