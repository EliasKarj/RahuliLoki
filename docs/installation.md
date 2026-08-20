# Installation

Four ways to run the same program. The prebuilt installer is the first of them and the only one
most people need; the rest are for running from source.

[← back to the README](../README.md)

---

## Before anything else: Node and pnpm

Everything below assumes **Node 22 or newer** and **pnpm**. Neither is preinstalled anywhere, and
`pnpm` is the command most people trip over first:

```
pnpm : The term 'pnpm' is not recognized...
```

```bash
# Is Node there?
node -v                    # must be v22 or newer

# pnpm comes with corepack, which comes with Node:
corepack enable pnpm
```

If `node` is missing: [nodejs.org](https://nodejs.org), or `winget install OpenJS.NodeJS.LTS`
(Windows) / `brew install node` (macOS). Open a **new terminal** afterwards.

The launch scripts do this check for you: `./start.sh` (macOS, Linux) and `.\start.ps1`
(Windows).

---

## The desktop app

**[Prebuilt installers are in the releases](https://github.com/EliasKarj/WhatRemains/releases/latest)**
— Windows `.exe`, macOS `.dmg`, Linux `.AppImage`. What follows is for building from source.

```bash
pnpm install
pnpm desktop            # builds and launches
pnpm desktop:package    # builds an installer for this platform
```

On Windows, without installing pnpm separately:

```powershell
.\start.ps1 -Desktop
```

The same server and the same page — but in its own window, with a tray icon and a **real login**.
The app opens GGG's login page in a window of its own and reads the session from it. There is no
POESESSID to dig out of devtools and nowhere to paste one.

Your account and settings live in the **top-right corner**: a small button showing the account
name, with a dot that says whether a session is stored. Clicking it opens the rest as three
groups divided by hairlines: **who and which league** (account name, league), **the session**
(sign in and sign out) and **what the collector does** (interval, background collection, launch
at login). A click outside, or Escape, closes it.

**There is exactly one button to press in the panel: signing in.** The fields save themselves —
the league as soon as you pick it, the text fields when they lose focus or when you press Enter —
and signing in does the rest.

> **▸ Why *Save* and *Ask GGG* went away:** they were three presses for one intention. *Save*
> wrote a league and an account name, *Ask GGG* replaced the name you had just written with the
> one GGG reports, and signing in proved which account the session belongs to — reporting the
> same name a third time. Someone setting the app up had to press all three, in an order nothing
> on screen explained.
>
> Now signing in carries the league sitting in the form and takes the name from GGG. The one
> *Ask GGG* case that still matters — a stored session whose account name never got filled in —
> is handled inside the sign-in, and needs no button of its own: the only moment worth asking is
> exactly that moment.
>
> The account name field is still typeable. GGG's answer beats a hand-typed name every time, but
> the field is the only way out if `/api/profile` will not answer.

> **▸ Why the corner:** signing in is the only thing that matters on the first launch and the
> last thing that matters on every launch after it. A full-width box reading "signed in as
> Exile#1234" pushed the numbers the app was opened for further down the screen every single
> time. A button keeps the same information visible and costs one line.
>
> When something is missing the panel opens itself rather than waiting to be found. Hiding the
> setup screen from someone who has not set anything up would be a worse trade than the space it
> costs.

> **▸ Why the login window is the whole reason the desktop build exists:** the instruction "open
> F12, find the cookie jar, copy the value we just told you is as good as your password" is three
> steps of friction and one step of teaching a bad habit. Anyone who learns to dig a POESESSID
> out of a request is one convincing website away from handing it to someone else. Here the
> credential never passes through the user's hands at all.

> **▸ Why the window waits for GGG's confirmation rather than for a cookie:** pathofexile.com
> sets a POESESSID cookie **for an anonymous visitor**, before anyone has typed anything. The
> condition "a cookie exists" was therefore met half a second after the page loaded: the window
> closed, the panel reported a successful login, and what was stored was a session with no
> account.
>
> The consequences were worse than an obvious error would have been. Everything looked right,
> GGG answered every stash request with 403, and the error message blamed an expired session —
> which led to logging in again, which "succeeded" in exactly the same wrong way.
>
> A cookie is not a session until GGG says whose it is. The window asks `/api/profile`, which
> needs only the session and not an account name, and accepts only a cookie that answers with a
> name. That also means the account name comes from GGG rather than from a text field.

The settings panel also chooses the **collection interval** — 5, 10, 15, 30 or 60 minutes. The
choice is written to the same `POLL_CRON` setting the server reads anyway, and the server
restarts in the background afterwards.

> **▸ Why five minutes does not fit a large stash:** one poll costs **one request per tab** — the
> first request returns the tab list in the same response, so there is no extra call. GGG's stash
> policy, recorded from a real response, is `30:60:60,100:1800:600` for the account: a hundred
> requests every half hour, so **200 an hour**, and no more than thirty in any one minute.
>
> Nineteen tabs every five minutes is 12 × 19 = **228 requests an hour**, over budget. At ten
> minutes it is 114 and fits comfortably. Nothing breaks when you go over — the limiter paces
> itself and polls stretch out, until they start overlapping the next one — but that is slowing
> down rather than speeding up, so the menu says it out loud: too tight a choice shows a red line
> beneath it with the computed hourly cost. It is the stash owner's decision, not the program's.
>
> So the shortest interval nineteen tabs fit into is 10 minutes. A smaller stash fits a tighter
> one: sixteen tabs or fewer fit into five minutes.

> **▸ Why closing the window does not stop collection:** unattended collection is this app's
> advantage over Exilence Next, which only recorded while it was open. Closing hides the window
> to the tray and the collector carries on. Quitting is a separate choice in the tray menu.

> **▸ Why Prisma's CLI is not bundled:** it is 36 MB of platform binaries whose only job in a
> finished program would be running a handful of CREATE TABLE statements once at startup.
> Migrations run from the same SQL files through `node:sqlite`, and CI asks Prisma itself whether
> the result is identical. It is also why Electron 38 is the floor: anything older bundles
> Node 20, which has no `node:sqlite`.

---

## One command (fastest)

```bash
git clone https://github.com/EliasKarj/WhatRemains.git what-remains
cd what-remains
./start.sh              # macOS, Linux
```

```powershell
git clone https://github.com/EliasKarj/WhatRemains.git what-remains
cd what-remains
.\start.ps1            # Windows
```

Both check Node, fetch pnpm through corepack if it is missing, and carry on from there.

> **▸ If PowerShell refuses to run the script** (*running scripts is disabled on this system*),
> that is the default execution policy and not a fault in the file:
> `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass`

The script checks Node and pnpm, asks for credentials (POESESSID is typed invisibly and stored
in `.env` with mode 0600), runs the migrations, builds, starts the server and performs **one**
real poll to tell you immediately whether the credential works. After that the page is at
<http://localhost:3000>.

| Flag | What it does |
|------|--------------|
| `./start.sh` | Install if needed, build, start |
| `./start.sh --dev` | Server and Vite with hot reload, for working on the code |
| `./start.sh --seed` | Fills the database with invented data so the charts have something in them |
| `./start.sh --check` | Verifies everything and starts nothing |
| `./start.sh --reconfigure` | Asks for the credentials again (the old `.env` is backed up) |

> **▸ Why the script does a real poll rather than only starting:** the only way to know whether a
> POESESSID works is to use it. One request, no retry — a retry would spend a second request from
> the same budget the whole rate limiter exists to protect, and tell you nothing new.

> **▸ Why the credential is not checked with curl straight from the script:** the server already
> has a rate limiter and good error messages. A second, dumber implementation in shell would
> drift away from both and shoot at GGG with no regard for the buckets.

---

## Docker (recommended on a server)

```bash
git clone https://github.com/EliasKarj/WhatRemains.git what-remains
cd what-remains
cp .env.example .env      # fill in POESESSID and POE_ACCOUNT_NAME
docker compose up -d
```

The page is at <http://localhost:3000>. The first snapshot appears on the next scheduled tick, or
immediately if you press **poll now** on the page.

Compose publishes the port to loopback only (`127.0.0.1:3000`), so no token is needed. If you
change that to `3000:3000`, set `AUTH_TOKEN` as well — otherwise the server refuses to start and
says why. See [Access control](credentials.md#access-control).

---

## Fly.io

`fly.toml` is ready to go. The volume has to exist before the first deploy, and the credential
goes into `fly secrets` rather than into a file:

```bash
fly launch --no-deploy --copy-config
fly volumes create what_remains_data --size 1 --region arn
fly secrets set POESESSID=… POE_ACCOUNT_NAME='Exile#1234' POE_LEAGUE=Settlers \
  AUTH_TOKEN="$(openssl rand -hex 32)"
fly deploy
```

`AUTH_TOKEN` is not optional here. Fly publishes the app to the public internet, and the server
refuses to start without one. The browser asks for the token once and holds it for the tab.

`auto_stop_machines = false` is deliberate: a sleeping machine collects nothing, and collecting
is the entire point of the app.

---

## Locally, without a container

```bash
pnpm install
pnpm --filter @whatremains/server exec prisma generate
pnpm db:migrate
cp .env.example .env      # fill in the credentials
pnpm dev                  # server on :3000, frontend on :5173
```

Vite proxies `/api` requests to the server, so even in development everything speaks in relative
URLs.

---

## Where your data lives

An installed copy keeps everything of its own in the per-user application data directory — never
inside the program, so an update replaces the program and leaves a league's history alone.

| | Windows | macOS | Linux |
|---|---|---|---|
| Directory | `%APPDATA%\What Remains` | `~/Library/Application Support/What Remains` | `~/.config/What Remains` |

Inside it: `settings.json` (the session, mode `0600`), `what-remains.db` (the snapshots) and
`logs/what-remains.log`.

> **▸ Why the log is a file rather than a console:** an installed copy is a windowed program. On
> Windows such a process has no console attached at all, so every log line would be written into
> nothing — and the alternative, opening a console window beside the app to hold them, is a
> terminal nobody asked for sitting in the taskbar for the life of the session.
>
> The tray menu has **Open log**, because a file is only an improvement if you can find it
> without knowing where Electron puts application data. Run from source, the log still goes to
> stdout, because that is the whole point of running from source.

---

## Upgrading from valuuttaloki

The program used to be called **valuuttaloki**. The name changed, and the name is part of a few
paths.

**The desktop app handles it.** Electron derives its data directory from the application's name,
so the rename moved that folder out from under an existing install. On the first launch the app
**copies** `settings.json` and the database from the old folder into the new one — the session,
the account and the whole history come along. The old folder is neither deleted nor modified.

> **▸ Why a copy rather than a move:** if this migration is wrong in some way nobody has thought
> of yet, the original is still there. A move would spend the only copy to save a few megabytes.
>
> **▸ Why only into an empty folder:** if the new version has already been launched and signed
> into, its state is newer than the old folder's. A migration that ran twice would put a stale
> session back over a fresh one.

**Docker and self-hosted installs need one gesture.** The filename in `docker-compose.yml` and
`fly.toml` is now `what-remains.db`, as are the service, container and volume names. The old data
is still on the volume under the old name, so pick one:

```bash
# either rename the file on the volume…
docker compose stop
docker compose run --rm what-remains mv /data/valuuttaloki.db /data/what-remains.db

# …or leave DATABASE_URL pointing at the old name
DATABASE_URL=file:/data/valuuttaloki.db
```

Either is fine. What is **not** worth doing is starting up under the new name and wondering about
the empty chart: the database has not gone anywhere, it is in a different file.

The browser's `sessionStorage` key changed too, so a token-protected install asks for the token
once more.

---

## Backups and the turn of a league

The database is one file, and rows are only ever added — nothing is updated and nothing is
deleted.

```bash
docker compose stop
docker compose cp what-remains:/data/what-remains.db backup.db
docker compose start
```

> **▸ Why stop it:** the collector writes every ten minutes and a write takes milliseconds, so
> copying from a running container lands on top of a write very rarely. Rarely is not never, and
> a broken backup is discovered exactly when it is needed. Two seconds of downtime is cheaper.

Snapshots are keyed by league, and leagues are never mixed into one series. When a new league
starts, change `POE_LEAGUE` and restart the container — the old series stays and can be picked
from the menu at the top of the page. Standard is its own, nearly unchanging series.

> **▸ Why the whole breakdown is stored:** a row holds the per-tab item breakdown, not just the
> total. That costs space, but it makes the history sliceable after the fact — "how much would I
> be worth without that one lucky drop" — without fetching anything again. Fetching again would
> not even be possible: GGG will not tell you what was in your stash last Tuesday.
