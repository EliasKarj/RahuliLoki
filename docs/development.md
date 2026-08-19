# Development

Settings, the API, tests and the project layout.

[← back to the README](../README.md)

---

## Settings

All of it in `.env`; `.env.example` is the template.

| Variable | Default | Meaning |
|----------|---------|---------|
| `POESESSID` | — | The session cookie. Required to collect anything. |
| `POE_ACCOUNT_NAME` | — | The account name exactly as GGG spells it, `Exile#1234`. |
| `POE_LEAGUE` | `Standard` | The league to track. Snapshots are keyed by it. |
| `POLL_CRON` | `*/10 * * * *` | The collection interval. Validated at startup, not on the first tick. The desktop build picks this from a menu in minutes. |
| `MIN_ITEM_CHAOS` | `2` | *Summed* holdings cheaper than this are left out of the breakdown. |
| `TRACKED_TABS` | empty | Comma-separated tab names. Empty = all of them. |
| `PRICE_TTL_MINUTES` | `60` | How old a price set may be before a new one is fetched. |
| `PRICE_CURRENCY_CATEGORIES` | `Currency,Fragment` | poe.ninja currency-overview types. |
| `PRICE_ITEM_CATEGORIES` | see below | poe.ninja item-overview types. |
| `PRICE_UNIQUE_CATEGORIES` | empty | Unique categories to price. Empty on purpose — see below. |
| `POE_NINJA_URL` | `https://poe.ninja/poe1/api/economy/exchange/current` | poe.ninja's API root. Only needed if it moves again. |
| `POE_CONTACT` | — | Contact details appended to the `User-Agent`. |
| `DATABASE_URL` | `file:./data/what-remains.db` | The SQLite file. |
| `PORT` / `HOST` | `3000` / `127.0.0.1` | HTTP. The default is loopback, not every interface. |
| `AUTH_TOKEN` | empty | Shared API token. Required when the bind is not loopback. |
| `ALLOW_UNAUTHENTICATED` | empty | An acknowledgement that something else handles authentication. |
| `ALLOWED_HOSTS` | empty | Permitted `Host` headers in tokenless mode. |
| `TRUST_PROXY` | empty | Whether to believe `X-Forwarded-*`. Only behind a real proxy. |
| `PRICE_SET_RETENTION` | `48` | Price sets kept per league. `0` = all of them. Includes the icon map. |
| `REQUEST_TIMEOUT_MS` | `30000` | Ceiling for a single outbound request. |
| `LOG_LEVEL` | `info` | pino's level. |

The default price categories: `DivinationCard, Essence, Fossil, Resonator, Scarab, Oil,
DeliriumOrb, Incubator, Artifact, Vial, Omen, Tattoo`.

> **▸ Why gems and maps are not in the default:** they are not priced by name. A gem's price
> depends on level, quality and corruption; a map's on tier; a cluster jewel's on whatever rolled
> on it. Valuing them by name would give them *a* number, and that number would be wrong in a way
> the chart cannot show.

> **▸ Why uniques are not priced either:** poe.ninja redesigned its API, and price rows no longer
> carry `links` or `corrupted`. Without them the variant cannot be identified, and pricing a
> unique by name alone would silently pick one of them: the same Bronn's Lithe is ~5 chaos with no
> links and ~210 as a six-link.
>
> The options were a number wrong by fortyfold with nothing to indicate it, or no number at all.
> So uniques go unpriced and appear in the poll's "no price" warning. If poe.ninja starts
> publishing the variant fields again, `PRICE_UNIQUE_CATEGORIES` switches them back on.

---

## API

Everything under `/api`, everything JSON.

| Route | What it gives |
|-------|---------------|
| `GET /api/snapshots?league=&from=&to=&limit=` | Snapshots, oldest first. The breakdown only with `?full=1`; `?tabs=1` gives per-tab totals without item-level data. |
| `GET /api/snapshots/latest?league=` | The newest snapshot with its full breakdown, tab totals and top holdings with icons. 404 before the first poll. |
| `GET /api/stats?league=&from=&to=` | Gain, c/h active and wall-clock, active hours, best hour, per-interval detail. |
| `GET /api/changes?league=&from=&to=&minChaos=` | What moved between the ends of the range: per-item changes, the reason (`quantity`/`price`/`both`), gains and losses separately. |
| `GET /api/item-history?name=&league=&from=` | One item's quantity and value in every snapshot in the range. |
| `GET /api/leagues` | The current leagues from GGG, for the desktop build's menu. Cached 6 h; the permanent leagues on failure. |
| `GET /api/account` | Who GGG says the stored session belongs to, and whether that matches `POE_ACCOUNT_NAME`. 502 when GGG will not answer — which is itself an answer. |
| `POST /api/poll` | Starts a poll and answers **202 immediately**, not when it finishes. 409 if one is already running, 503 if credentials are missing. The outcome is read from `/api/health`. |
| `GET /api/health` | Last success, halt reason, rate-limit state, price age, and `schedule.nextRunAt`: when the next automatic poll runs. |
| `GET /api/config` | League, schedule, thresholds, and which leagues have history. **No POESESSID.** |

When `AUTH_TOKEN` is set, every one of these requires an `Authorization: Bearer …` header
(`X-Auth-Token` also works). The single exception is `/api/health`, which answers `{"status":"up"}`
without a token and full diagnostics only when authenticated — see
[Access control](credentials.md#access-control).

`/api/health` answers **200 whenever the process is up**, halted included. It is also what the
dashboard polls between refreshes: it names the last poll, and nothing else in the dashboard can
change without one.

> **▸ Why a range wider than the cap keeps the newest rows:** `?limit` bounds a response, and the
> half of a wealth history worth keeping is the near one. Truncating the other way — which is
> what an ascending sort with a limit does — made the chart stop mid-league with no sign that it
> had, and reported a net worth from weeks earlier as the current one, because "current" is read
> off the last row of the series. Past about two weeks of a league at the old cap, both were
> quietly wrong.

> **▸ Why not 503 when halted:** a container health check would restart the process, and a restart
> does not fix an expired POESESSID. It would only restart the container in a loop for days. The
> `status` field reads `halted`, and the top of the page says so to a human.

---

## Commands

```bash
pnpm dev            # server and frontend side by side
pnpm dev:server
pnpm dev:web
pnpm db:migrate     # development migration
pnpm db:studio      # Prisma Studio
pnpm build          # frontend and server
pnpm test
pnpm typecheck
```

The server runs TypeScript directly through Node's type stripping — there is no build step in
development, and `tsc` only produces `dist` for a release.

### Believable data without the wait

```bash
pnpm --filter @whatremains/server seed -- --days 4 --league Settlers
```

Three days of snapshots with sleep gaps, a drifting divine rate and the odd trade. Refuses to
touch a league that already has snapshots unless given `--force`.

> **▸ Why this exists:** judging a chart takes data with the shape of real data. Waiting three days
> to find out that a tooltip overlaps an axis is not a way of working.

---

## Auditing dependencies

CI runs `pnpm audit --audit-level moderate` and fails the build on a known vulnerability. One
advisory is ignored, listed in `package.json` under `pnpm.auditConfig.ignoreGhsas`:

**[GHSA-jmr9-qjv8-65gv](https://github.com/advisories/GHSA-jmr9-qjv8-65gv)** — `extract-zip`,
unvalidated symlink path traversal during extraction. There **is no fixed version**
(`Patched versions: <0.0.0`); the package is unmaintained.

> **▸ Why this is an acceptable exception:** `extract-zip` arrives with Electron's *install
> script*, and its only job is unpacking Electron's own binary on a developer's machine. It is not
> in the shipped program, no code in this repository runs it, and it extracts nothing but
> Electron's own GitHub release. The vulnerability requires a hostile zip file, and there is none
> in that chain.
>
> The exception is pinned in that one place rather than by lowering the threshold, so that it is a
> one-line change in a diff and not a whole gate quietly switched off.

---

## Tests

```bash
pnpm test
```

**517 tests**, not one network request:

- **The rate limiter** — header parsing, pacing, serialisation, `Retry-After`, doubling up to the
  ceiling. The clock and sleep are faked, so testing a 30-minute backoff takes microseconds.
- **Prices** — recorded poe.ninja responses, broken ones included: a null price, an empty `lines`,
  HTML instead of JSON.
- **The stash** — recorded GGG responses, markup and all. One tab failing fails the poll; the
  credential does not leak into an error message.
- **Valuation** — name resolution, merging stacks, the threshold, skipped categories.
- **Series** — the idle rule, uneven intervals, spike marking, best hour.
- **The poller** — nothing is written when something fails; backoff; halting after three failures;
  a manual run clears the halt.
- **The API** — every route through `app.inject()` against a fake store.
- **The frontend** — the formatting rules, the chart transforms, and the item table's grouping
  across tabs, search and sorting.
- **Signing in** — that an anonymous cookie is *not* accepted as a session, that one GGG later
  confirms is, that the same cookie is not re-checked with GGG on every poll, and that the wait
  ends in a timeout rather than spinning.
- **Logging** — that a log written to a file redacts the credential exactly as one written to a
  terminal does.
- **The store's SQL** — against a real SQLite file, migrated by the app's own migrator: the
  per-tab column, its fallback for rows written before it existed, and the item series summed
  inside the database (including a fractional sum, which is what broke it the first time).

---

## Project layout

```
/server
  /src
    /services   priceService, stashService, valuationService, uniques, snapshotRepo
    /routes     snapshots, health, config
    /jobs       pollJob
    /lib        rateLimiter, logger, series, changes, config, auth, http, schedule
    app.ts      assembling Fastify (testable without a listening port)
    server.ts   assembling the server as a function (the desktop build embeds the same one)
    index.ts    the command-line wrapper: startup and a clean shutdown
  /prisma       schema.prisma + migrations
  /tools        seed.ts
/desktop
  /build        the icon, and make-icon.py which draws it
  /src          main (Electron), login (the login window), settings, preload,
                adoptOldData (the old name's data directory), sessionWait, loginHosts
/scripts        with-env.mjs (loads the root .env for the Prisma CLI)
/web
  /src
    /components Hero, NetWorthChart, RatePerHourChart, TabBreakdown, SnapshotTable,
                PollerStatus, TokenGate, ChangesTable, ItemHistory, ItemIcon, DesktopSetup
    /hooks      useSnapshots
    /lib        api, format, series, palette (chart colours), schedule (the countdown), spark
```

The statistics are computed on the server and arrive at the browser finished. The idle rule and
spike marking therefore exist as **exactly one implementation** — two parallel ones would drift
apart by the first change.

---

## What this does not do

- **No multiple users, no login, no sharing.** One user, one GGG account.
- **No scraping of third-party sites.** GGG and poe.ninja directly.
- **No PoE2 support.** GGG offers no public PoE2 stash API. The league setting does not close the
  door, but nothing is built on it.
- **No trading, crafting calculators or flipping tools.**

Early-league prices swing wildly because there is not yet a market. A chart jumping around in the
first few days is not wealth moving, it is poe.ninja being uncertain.
