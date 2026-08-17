# CLAUDE.md — What Remains

Path of Exile wealth tracker. Polls stash tabs on a schedule, values them against poe.ninja
prices, stores snapshots, and charts currency accumulation over time.

Inspired by Wealthy Exile / Exilence CE, but self-hosted and single-user.

## Goals

- Continuous, unattended snapshots of stash value (no manual "take snapshot" button required)
- Chaos + divine denominated net worth over the life of a league
- Chaos-per-hour that reflects *active* time, not wall-clock time
- Per-tab breakdown so it's obvious where wealth actually sits
- Survive a league restart without losing history

## Non-goals

- Multi-user accounts, auth, or sharing. Single user, single GGG account.
- Scraping wealthyexile.com or any third-party frontend. Go to GGG + poe.ninja directly.
- PoE2 support. GGG does not expose a public PoE2 stash API yet; leave the door open in the
  league config but do not build for it.
- Trade automation, crafting calculators, flip finders. Out of scope.

## Stack

| Layer     | Choice                                              |
|-----------|-----------------------------------------------------|
| Frontend  | Vite + React + TypeScript, Tailwind, Recharts       |
| Backend   | Fastify + TypeScript                                |
| DB        | SQLite via Prisma (single file, easy backup; Postgres-compatible schema) |
| Scheduler | `node-cron` inside the backend process              |
| Deploy    | Single container, Fly.io or a small VPS             |

**Note:** this cannot be a static GitHub Pages app. The poller needs a persistent process.
Frontend and backend ship together from one container; Fastify serves the built SPA from
`/dist`.

## Architecture

```
node-cron (*/10 * * * *)
   │
   ├── priceService     → poe.ninja, cached 1h in memory + DB
   ├── stashService     → GGG stash API, rate-limit aware
   ├── valuationService → items × prices → chaos total + breakdown
   └── snapshotRepo     → one row per successful poll
                              │
                       Fastify REST API
                              │
                     React + Recharts SPA
```

## Directory layout

```
/server
  /src
    /services      priceService, stashService, valuationService
    /routes        snapshots, health, config
    /jobs          pollJob.ts
    /lib           rateLimiter.ts, logger.ts
    index.ts
  /prisma          schema.prisma, migrations
/web
  /src
    /components    NetWorthChart, RatePerHourChart, TabBreakdown, SnapshotTable
    /hooks         useSnapshots
    /lib           api.ts, format.ts
```

## Data model

Store the full `breakdown` blob. It makes it possible to re-slice history (e.g. "net worth
excluding one lucky mirror drop") without re-fetching anything.

```prisma
model Snapshot {
  id            Int      @id @default(autoincrement())
  takenAt       DateTime @default(now())
  league        String
  totalChaos    Float
  totalDivine   Float
  divineRate    Float    // chaos per divine at time of snapshot
  itemCount     Int
  breakdown     Json     // { [tabName]: { [itemName]: { qty, chaosEach, chaosTotal } } }
  priceSetAt    DateTime // when the poe.ninja price set was fetched
  @@index([league, takenAt])
}

model PriceSet {
  id        Int      @id @default(autoincrement())
  league    String
  fetchedAt DateTime @default(now())
  prices    Json     // { [itemName]: chaosValue }
}
```

## Poller

Runs every 10 minutes. Sequence:

1. **Prices** — if the cached poe.ninja set is older than 1h, refetch:
   `{DivinationCard|UniqueWeapon|Essence|Fossil|Scarab|...}`. Merge into a flat
   `name → chaosValue` map. Divine rate comes from the Currency set.
2. **Tabs** — `accountName=&league=&tabIndex=&tabs=1` with `Cookie: POESESSID={...}`. First
   call returns the tab list; iterate only over tabs in the configured allowlist.
3. **Value** — for each item, resolve a price key (see gotchas), multiply by stack size, drop
   anything below `MIN_ITEM_CHAOS` (default 2) to cut noise.
4. **Persist** — one snapshot row. If any tab fetch fails, abort the whole poll and write
   nothing; a partial snapshot looks like a wealth crash in the chart.

## Rate limiting — this is the part that matters

GGG bans aggressively. Non-negotiable rules:

- Parse `X-Rate-Limit-Account` and `X-Rate-Limit-Account-State` on every response and sleep to
  stay under the tightest bucket.
- Serialize tab requests. Never fire them in parallel.
- On `429`, honour `Retry-After`, then apply exponential backoff (2× up to 30 min).
- Hard-fail the job after 3 consecutive failed polls and log loudly rather than hammering.
- Set a descriptive `User-Agent` identifying the app and contact.

## API

| Route                              | Purpose                                                  |
|------------------------------------|----------------------------------------------------------|
| `GET /api/snapshots?league=&from=&to=` | Snapshot list, `breakdown` omitted unless `?full=1`   |
| `GET /api/snapshots/latest`        | Most recent snapshot with full breakdown                 |
| `GET /api/stats`                   | Derived: total gain, c/h, best hour, active hours        |
| `POST /api/poll`                   | Manual trigger, for debugging                            |
| `GET /api/health`                  | Last successful poll, rate-limit state                   |

## Frontend

### 1. Net worth over time (primary)

Area chart, chaos on the left Y axis, `divineRate` as a thin line on a right axis. Without the
divine overlay it's impossible to tell real gains from divine inflation. Range toggle:
24h / 7d / league.

### 2. Chaos per hour

Bar chart of deltas between consecutive snapshots, normalised to per-hour.

**Active-time rule:** if two consecutive snapshots differ by less than 1 chaos, treat that
interval as idle and exclude it from the c/h average. Otherwise an overnight gap drags the
number to near zero. Show both "c/h active" and "c/h wall-clock" so the difference is visible.

### 3. Tab breakdown

Stacked area over time by tab, plus a sortable table of the latest snapshot's top items by
total chaos value.

### 4. Annotations

Flag any single-interval delta larger than 3× the trailing median — usually a sale or a big
drop. Mark these on the net worth chart so spikes are legible rather than confusing.

**Styling:** dark theme, JetBrains Mono for numeric columns, keep the palette to two accents
plus neutrals. Numbers right-aligned and tabular. Chaos values under 1000 shown whole, above
that abbreviated (`14.2k`).

## Config

`.env`, never committed:

```
POESESSID=
POE_ACCOUNT_NAME=
POE_LEAGUE=
POLL_CRON=*/10 * * * *
MIN_ITEM_CHAOS=2
TRACKED_TABS=          # comma-separated tab names; empty = all
DATABASE_URL=file:./data/what-remains.db
```

`POESESSID` is a full account credential — it is not a scoped API key. Never log it, never
send it to the frontend, never include it in error messages. Add `.env` and `/data` to
`.gitignore` before the first commit.

## Commands

```
pnpm dev          # server + web concurrently
pnpm dev:server
pnpm dev:web
pnpm db:migrate
pnpm db:studio
pnpm build
pnpm test
```

Every package must have a working `dev` script defined in its own `package.json` — do not rely
on the root script alone.

## Milestones

1. **Skeleton** — Prisma schema, Fastify boot, `/api/health`, one migration.
2. **Prices** — poe.ninja fetch + merge + 1h cache. Test against a recorded fixture.
3. **Stash** — single tab fetch with full rate-limit handling. Verify header parsing before
   ever running it on a loop.
4. **Valuation + first snapshot** — end-to-end manual `POST /api/poll`.
5. **Scheduler** — cron, failure backoff, health reporting.
6. **Chart 1** — net worth over time. Ship it, run it for a day, look at real data.
7. **Charts 2–4** — c/h, tab breakdown, annotations.
8. **Deploy** — container, volume mount for the SQLite file, restart policy.

## Gotchas

- **Item name resolution is the hardest part.** poe.ninja keys by display name, but stash items
  carry `typeLine`, `baseType`, `name`, and gem/map variants (level, quality, tier, corrupted)
  that change value. Start with currency and fragments only — they map cleanly — then add
  categories one at a time. Log every unresolved item name so gaps are visible rather than
  silently valued at zero.
- **League rollover.** Snapshots are keyed by league; never mix leagues in one series. Standard
  tabs are a separate, near-static series.
- **poe.ninja early league.** Prices are thin and wild in the first days. Expect volatility in
  the chart that is not real wealth movement.
- **Quad tabs are large.** A full quad can be thousands of items; keep valuation synchronous
  and simple, but don't send raw item arrays to the frontend.
- **Clock gaps.** If the host sleeps or the container restarts, snapshots will have holes. The
  chart must handle irregular intervals — never assume fixed spacing when computing deltas.
