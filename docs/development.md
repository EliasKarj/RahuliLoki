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
| `PRICE_UNIQUE_CATEGORIES` | the five item-endpoint unique types | Unique categories to price. Set it empty to leave uniques out of the total, as every version before 1.4.0 did. |
| `POE_NINJA_URL` | `https://poe.ninja/poe1/api/economy/exchange/current` | poe.ninja's API root. Only needed if it moves again. |
| `POE_CONTACT` | — | Contact details appended to the `User-Agent`. |
| `DATABASE_URL` | `file:./data/what-remains.db` | The SQLite file. |
| `PORT` / `HOST` | `3000` / `127.0.0.1` | HTTP. The default is loopback, not every interface. |
| `AUTH_TOKEN` | empty | Shared API token. Required when the bind is not loopback. |
| `ALLOW_UNAUTHENTICATED` | empty | An acknowledgement that something else handles authentication. |
| `ALLOWED_HOSTS` | empty | Permitted `Host` headers in tokenless mode. |
| `TRUST_PROXY` | empty | Whether to believe `X-Forwarded-*`. Only behind a real proxy. |
| `UPDATE_CHECK` | on | Ask GitHub once a day whether there is a newer release. `off` stops it entirely. |
| `PRICE_SET_RETENTION` | `48` | Price sets kept per league. `0` = all of them. Includes the icon map, and sets how far back the Economy tab's price history reaches — 48 hourly fetches is two days. |
| `REQUEST_TIMEOUT_MS` | `30000` | Ceiling for a single outbound request. |
| `LOG_LEVEL` | `info` | pino's level. |

The default price categories: `DivinationCard, Essence, Fossil, Resonator, Scarab, Oil,
DeliriumOrb, Incubator, Artifact, Vial, Omen, Tattoo, AllflameEmber`.

> **▸ How that list was checked:** `node scripts/probe.mjs --types` asks poe.ninja which `type=`
> values return anything at all, rather than trusting a list assembled from memory. It found
> `AllflameEmber` priced and missing here — items this app was quietly valuing at nothing,
> because an unpriced item is simply absent from the breakdown and absent looks exactly like not
> owning any. It also found `Incubator` and `Vial` answering with zero lines in that league; they
> are kept, because one league's emptiness is not evidence that a category is gone, and an empty
> answer costs one request an hour.

> **▸ Why gems and maps are not in the default:** they are not priced by name. A gem's price
> depends on level, quality and corruption; a map's on tier; a cluster jewel's on whatever rolled
> on it. Valuing them by name would give them *a* number, and that number would be wrong in a way
> the chart cannot show.

> **▸ How uniques are priced, and why it took so long:** the **exchange** endpoint serves none.
> `UniqueArmour`, `UniqueWeapon`, `UniqueAccessory`, `UniqueFlask`, `UniqueJewel`, `UniqueMap`,
> `UniqueRelic` and a bare `Unique` all answer 200 with zero lines, recorded by
> `scripts/probe.mjs`. For months that read as "poe.ninja does not price uniques any more", and
> the conclusion was wrong about how much had been looked at rather than about what it saw.
>
> The **item** endpoint, `stash/current/item`, serves 2,223 of them across five types, every one
> named and priced, and carrying `links`. That last field is the one that matters: by name alone
> a plain Bronn's Lithe and a six-linked one are the same row at ~5 chaos and ~210, which is why
> uniques were left out of every total rather than valued at whichever the payload listed first.
>
> So each stash item is matched to a line by its own links and corruption — `pickCandidate` in
> `services/uniques.ts` — and only then counted. The breakdown keys a six-link separately from a
> plain one, so a chart cannot merge them.
>
> Two things it still cannot resolve, both recorded rather than assumed. **Corruption is not
> published**: the full key list of a line has no `corrupted` on it anywhere, so a corrupted item
> falls back to the uncorrupted line for its links. **Variants are published and unmatchable**:
> nothing in the stash payload lines up with "Pre 2.0" or a Watcher's Eye's rolled mods, so where
> variants collide the cheapest wins. Both understate rather than overstate, and both are
> reported — the API returns `priceIsApproximate` per row.

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
| `GET /api/economy?league=` | Every item poe.ninja prices: name, category, value, percentage change, trade volume and poe.ninja's own sparkline. One response, searched in the browser. |
| `GET /api/price-history?id=&league=` | What one item has cost across every price set still retained — this app's own record, oldest first. |
| `GET /api/uniques?league=` | The identified uniques a poll last saw, with item level, quality, corruption, links, tab, the dust each yields, the chaos price for that variant, and dust per chaos. |
| `GET /api/leagues` | The current leagues from GGG, for the desktop build's menu. Cached 6 h; the permanent leagues on failure. |
| `GET /api/account` | Who GGG says the stored session belongs to, and whether that matches `POE_ACCOUNT_NAME`. 502 when GGG will not answer — which is itself an answer. |
| `POST /api/poll` | Starts a poll and answers **202 immediately**, not when it finishes. 409 if one is already running, 503 if credentials are missing. The outcome is read from `/api/health`. |
| `GET /api/health` | Last success, halt reason, rate-limit state, price age, `schedule.nextRunAt` (when the next automatic poll runs), and `update`: whether a newer release exists. |
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

> **▸ Why the uniques are stored instead of read on demand:** the tab needs item level and
> quality, which are per item and which the snapshot breakdown does not keep — it aggregates by
> name, which is right for a wealth chart and useless at a disenchanting bench. Reading the stash
> when the tab opens would spend GGG's rate limit every time somebody clicked it. So a poll,
> which has already read every tab, keeps what dust cares about in one row per league,
> overwritten each time. The question is "what is in my stash now", and there is no version of it
> that also wants Tuesday's answer.

> **▸ Where the dust numbers come from:** a table of 1,103 uniques published by
> [deronek/poe-disenchant-tool](https://github.com/deronek/poe-disenchant-tool) under the MIT
> licence, vendored in `server/src/data` with the notice. It gives two figures per unique — item
> level 84 at no quality, and at 20% — and the formula is derived from the pair rather than
> assumed: the ratio between them is `(F + 40) / F`, which solves for the inherent influence and
> corruption multiplier the item already carries. Across the table that yields exactly four
> values, 100, 150, 200 and 400, which is one influence, two, and six units of influence or
> corruption. An item whose published dust is already boosted is therefore not boosted twice.
>
> The check is the test, not the paragraph: every row goes back through the formula and both
> published columns have to come out again.

> **▸ Where the chaos half comes from:** the same variant index the wealth total is valued
> against, matched on the item's own links. One price path for uniques in the whole application,
> so this view and the dashboard cannot disagree about what a thing is worth. A `~` in the price
> column marks a row whose match was not exact.

> **▸ Why the economy list arrives whole:** a price set is a few thousand rows and the client
> is on the same machine. Paging it would trade a few hundred kilobytes, once, for a search that
> filters after you type instead of as you type — which is the entire value of the tab.

> **▸ Why the movement fields are recorded rather than recomputed:** poe.ninja publishes a
> percentage change, a trade volume and a short sparkline on every line, and this app read past
> all three for months. They describe a window poe.ninja chose and has since moved past, so they
> cannot be reconstructed later — the only moment they can be captured is the moment they arrive.
> They are stored in `PriceSet.meta`, nullable, and not backfilled: inventing them for older rows
> would put made-up history in the one place a person goes to check history.

> **▸ Why an item with no published movement shows an empty cell and not 0%:** "poe.ninja said
> nothing" and "it did not move" are different claims, and only the first is true. The same rule
> puts those rows at the far end of a sort by change whichever way it points, rather than mixed
> in among the ones that really held steady.

> **▸ Why every economy row says where its name came from:** poe.ninja's redesigned payload
> names exactly two items, chaos and divine. Everything else is an id. A name is therefore
> either proved by your own stash, taken from the short-code alias table, or read back off the
> slug — and the last of those loses punctuation, because the slug rule drops it and nothing
> records where it went. `awakeners-orb` cannot become "Awakener's Orb" by rule. The row carries
> `nameSource` so a reconstruction can be marked as one rather than presented as the item's
> real name.

> **▸ Why the update check hangs off the health endpoint:** the dashboard already reads it every
> minute, and the answer changes about once a month. Its own endpoint would be a second poll for
> a field that is almost always the same. `deps.update()` is synchronous and returns the cached
> answer — a health endpoint that waits on api.github.com reports GitHub's outage as its own —
> and the request behind it happens at boot and once a day thereafter.

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

> **▸ Why the pure half of a module tends to sit in its own file:** `ninjaPayload.ts` next to
> `priceService.ts`, `lib/items.ts` next to `ItemsTable.tsx`. The split is not tidiness for its
> own sake — it is what lets four modules import a constant or a parser without dragging in a
> fetch, a cache and a database, and what lets the tests for "do two stacks of chaos add up"
> import something that does not pull in Recharts.

The server runs TypeScript directly through Node's type stripping — there is no build step in
development, and `tsc` only produces `dist` for a release.

### Asking GGG and poe.ninja things this repository cannot

```bash
node scripts/probe.mjs                    # everything, gently
node scripts/probe.mjs --limits           # GGG's rate-limit policy, from one request
node scripts/probe.mjs --ninja            # poe.ninja: any dust field, and the unique overviews
node scripts/probe.mjs --types            # which poe.ninja type= values return anything at all
node scripts/probe.mjs --items            # whether the OTHER poe.ninja endpoint serves uniques
node scripts/probe.mjs --time-poll        # read every tab and time it (spends real budget)
node scripts/probe.mjs --item Goldrim     # one unique's raw fields, to see what GGG really sends
```

Read-only, no dependencies, no files written. It takes POESESSID from the settings file the
desktop app already wrote, so nothing is pasted anywhere, and every line it prints goes through a
scrub that blanks the session even if GGG echoed it back in an error.

> **▸ Why this exists:** several numbers this project depends on are only observable from a
> machine that can reach GGG with a real account behind it. Writing a guess into the source
> instead is how the rate-limit policy came to be quoted as two different values in two comments
> in one file — both of them wrong, as the first run of this script established. A script whose
> output is evidence is the alternative to a constant nobody checked.

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

CI runs `pnpm audit --audit-level moderate` and fails the build on a known vulnerability.

A transitive dependency with a fix its parent has not picked up yet is forced to the fixed
version in `package.json` under `pnpm.overrides`, rather than waited on:

| Override | Why |
|----------|-----|
| `deepmerge-ts: >=8.0.0` | [GHSA-ggr8-5vv4-36mx](https://github.com/advisories/GHSA-ggr8-5vv4-36mx), stack exhaustion on recursive object graphs. It arrives under `prisma > @prisma/config`, so it is the CLI's config loader and not the shipped server, but the fix is a version bump and the alternative is another standing exception. |

One advisory has no fix and is ignored, listed under `pnpm.auditConfig.ignoreGhsas`:

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

**630 tests**, not one network request:

- **The rate limiter** — header parsing, pacing, serialisation, `Retry-After`, doubling up to the
  ceiling. The clock and sleep are faked, so testing a 30-minute backoff takes microseconds. One
  of them reads twenty-four tabs against GGG's real policy and fails if it takes more than five
  seconds — the regression it exists for cost twenty-six. Concurrency is tested on real timers
  rather than a fake clock, because a clock that releases one waiter at a time manufactures the
  serial behaviour the test is looking for.
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
- **The update check** — that a draft, a prerelease and an unparseable tag are not updates, that
  `1.0.9` is older than `1.0.10` and not newer, that the link is dropped unless it points at
  GitHub, that a failure changes nothing, and that switching it off makes no request at all.
- **Desktop settings** — that the update check defaults to on for a settings file written before
  it existed, that switching it off reaches the server as `UPDATE_CHECK=off`, and that the file
  holding the credential is written `0600` — that last one only where file modes exist, since
  Windows reports `0o666` for everything and the file is protected by an ACL there instead.
- **The movement fields** — that a line publishing none of them is left out rather than recorded
  as zeroes, that a sparkline with a string in it loses the string and not the series, and that a
  negative volume is refused.
- **Price history against a real database** — that it reads one id out of every retained set
  oldest-first with the divine rate of each moment, that a set which did not price the item is a
  gap rather than a zero, that the limit keeps the recent end, and that an id cannot smuggle
  anything into the JSON path it is interpolated into.
- **The dust formula** — every one of the 1,103 rows of the published table is run back through
  it and both published columns have to come out again. 1,102 reproduce exactly; the last is
  asserted to be one dust short, because that is a rounding artefact in the source and hiding it
  would let a real regression hide behind it. Also: that an already-influenced item is not
  boosted twice, that an item level nobody sent is treated as the floor rather than the ceiling,
  and that a unique the table has never heard of gets null rather than an estimate.
- **Uniques for the bench** — that quality is parsed out of a rendered tooltip string rather
  than trusted, that an item level GGG did not send stays null instead of becoming zero, that
  copies differing in anything dust reads stay separate rows, and that the same unique in two
  tabs is two rows because a row promises you can find the item again.
- **The economy list** — that a slug reads back as words without claiming the punctuation it
  lost, that a name the stash has proved beats the slug reading of it, that the short-code table
  reverses correctly, and that searching finds an item by its id as well as by its name.
- **The store's SQL** — against a real SQLite file, migrated by the app's own migrator: the
  per-tab column, its fallback for rows written before it existed, and the item series summed
  inside the database (including a fractional sum, which is what broke it the first time).

---

## Project layout

```
/server
  /src
    /services   priceService (fetching and caching), ninjaPayload (reading what comes back),
                economy (naming every priced id), kingsmarch (uniques as the bench sees them),
                dust (what an item yields at the disenchanting bench),
                stashService, valuationService, uniques, snapshotRepo, leagueService,
                profileService, updateService
    /routes     snapshots, health, config, economy
    /jobs       pollJob
    /lib        rateLimiter, logger, series, changes, config, auth, http, schedule, version
    app.ts      assembling Fastify (testable without a listening port)
    server.ts   assembling the server as a function (the desktop build embeds the same one)
    index.ts    the command-line wrapper: startup and a clean shutdown
  /data         dust.json + NOTICE.md (third-party, MIT — see the notice)
  /prisma       schema.prisma + migrations
  /tools        seed.ts
/desktop
  /build        the icon, and make-icon.py which draws it
  /src          main (Electron), login (the login window), settings, preload,
                adoptOldData (the old name's data directory), sessionWait, loginHosts
/scripts        with-env.mjs (loads the root .env for the Prisma CLI)
                probe.mjs (asks GGG and poe.ninja what this repo cannot)
/web
  /src
    /components Hero, NetWorthChart, RatePerHourChart, TabAreaChart, ItemsTable, SnapshotTable,
                PollerStatus, TokenGate, ChangesTable, ItemHistory, ItemIcon, DesktopSetup,
                UpdateNotice, SideNav, Economy, PriceHistory, Kingsmarch
    /hooks      useSnapshots
    /lib        api, format, series, palette (chart colours), schedule (the countdown), spark,
                update (the release notice and its dismissal), items (the item table's data),
                search (one definition of "does this row match what was typed")
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
