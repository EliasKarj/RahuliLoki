# Where the numbers come from

GGG's rate limit, poe.ninja's prices, and resolving item names.

[← back to the README](../README.md)

---

## Rate limiting

GGG bans readily. This is the part of the code worth reading before changing anything.

Every response states the rule in force and your own position in it:

```
X-Rate-Limit-Account:       30:60:60,100:1800:600
X-Rate-Limit-Account-State:  1:60:0,   1:1800:0
X-Rate-Limit-Ip:            45:60:120,180:1800:600
X-Rate-Limit-Policy:        backend-item-request-limit
X-Rate-Limit-Rules:         Account,Ip
```

Those are real, recorded from `get-stash-items` by `scripts/probe.mjs`. Two rules apply at once
and the tightest wins: the account gets 30 requests a minute and 100 every half hour, the IP 45
and 180. Breaching them costs a 60-second or 600-second timeout.

The triple is `hits:period:penalty`. The limiter

- **paces on how much is left in the bucket**, not on its average refill rate: the first half of
  the budget may be spent freely, after which the delay ramps evenly up to the full
  `period / hits` rate by the time the bucket is empty;
- **serialises the decision** — one request at a time is admitted, though several may be in the air;
- **waits out the whole period** when a bucket is empty, and the stated time when the state
  reports a penalty;
- **honours `Retry-After`** on a 429 and doubles from there up to 30 minutes;
- **gives up** with a `RateLimitError` rather than carrying on hammering.

> **▸ Why on what is left rather than on the average rate:** the earlier rule paced *every* request
> at the slowest bucket's average. The half-hourly policy `100:1800` averages out to one request
> every eighteen seconds, so a twenty-tab stash took six minutes — even when 17 of the 100 had
> been used. The budget was there; we simply refused to spend it.
>
> Now a slack bucket demands nothing. Past the reserve the delay ramps evenly, so approaching the
> ceiling is a slowdown rather than a wall. The hard protections are unchanged: an empty bucket
> still waits out its full period, and a stated penalty is observed to the second.
>
> The knob is one number, `PACING_RESERVE`. It is deliberately one: it answers the question "how
> close to GGG's ceiling is this application willing to run".

> **▸ Why a poll used to crawl anyway, long after that was fixed:** underneath the pacing sat a
> flat one-second floor between requests, and it applied whatever the buckets said. GGG allows
> forty-five requests a minute; this app spent a second between every one of them. Measured on a
> fake clock against the real policy `45:60:120,200:3600:3600`:
>
> | Tabs | With the floor | Without |
> |------|----------------|---------|
> | 8 | 8.0 s | **1.0 s** |
> | 12 | 12.4 s | **1.4 s** |
> | 24 | 25.9 s | **2.9 s** |
> | 40 | 43.8 s | **13.4 s** |
> | 60 | 126 s | **82 s** |
>
> The floor is off by default now. There is no moment where a constant beats the headers: before
> the first response there is no previous request to be too close to, and after it the pacing
> knows how much of the real bucket is left. It remains as an option for an operator who wants
> to run slower on purpose — behind a proxy with limits of its own — and never because the
> pacing needs the help.
>
> Past forty tabs the time is GGG's limit rather than ours: forty-five requests a minute is
> forty-five requests a minute, and the second half of a sixty-tab stash waits for the window to
> roll. No client can read that account faster.

> **▸ Where the numbers in these tables come from:** a simulated GGG paced by the policy above,
> which was guessed until `scripts/probe.mjs` recorded the real one — and the guess was wrong in
> every term. It assumed 45 requests a minute where the account gets 30, an hour-long second
> window where it is half an hour, and hour-long penalties where they are ten minutes. A limiter
> built on it would have paced against a ceiling twice as generous as the real one.
>
> The tables below predate that correction and are relative to the guess; the ratios hold, the
> absolute seconds do not. Measured against the real policy, nineteen tabs at a 470 ms round trip
> take **4.1 s** where reading them one at a time takes 9.8 s.
>
> What never depended on any of it: the app does not use these numbers. `RateLimiter` starts with
> no policy at all and paces by whatever the headers on the response in front of it say. That is
> why the first request of a poll goes alone — there is nothing to be inside yet — and why every
> figure in the source is a comment rather than a value.

> **▸ Why several requests are in the air at once:** the limiter used to hold its queue for the
> whole round trip, so a stash was read one network latency at a time — twenty-four tabs at two
> hundred milliseconds each is five seconds of *waiting*, against a policy that would have
> allowed all twenty-four inside one second. GGG's buckets count requests per window, not
> requests at a time.
>
> Admission is still serialised, one decision at a time; only the waiting overlaps. Measured
> against a fake GGG at 200 ms a round trip:
>
> | Tabs | One at a time | Six at a time |
> |------|---------------|---------------|
> | 8 | 1.7 s | **0.6 s** |
> | 12 | 2.4 s | **0.6 s** |
> | 24 | 4.8 s | **1.2 s** |
> | 40 | 16.6 s | **13.0 s** |
>
> Six, and never more than the window has room for: `computeDelayMs` counts the requests already
> launched but not yet answered, so concurrency cannot hide hits from the pacing. It drops to
> one the moment pacing starts, and it is one for the very first request of all — before any
> response there is no policy to be within, and opening with six would be guessing that the
> allowance is at least six.

The first call returns the tab list **and** the first tab's items in the same response, so it is
never read twice.

---

## Pricing and resolving names

### poe.ninja's API changed, and it cost something

The old `/api/data/currencyoverview` and `/itemoverview` keyed every row by its display name. They
are gone: the whole path answers `not found` for every league, Standard included, because the URL
predates poe.ninja's support for two games and does not say which one is meant. In their place is
one endpoint per game:

```
https://poe.ninja/poe1/api/economy/exchange/current/overview?league=<league>&type=<type>
```

`league` is **GGG's own league name verbatim** — `Allflame`, `Hardcore Allflame`.

A row no longer carries a name, an icon, or the unique-variant fields. A row is an id and a
number:

```json
{ "id": "alt", "primaryValue": 0.1238 }
```

Three consequences, all of them losses:

**Names** are now resolved the other way round. An id is computed from the stash item's display
name — not a name from an id, because that direction cannot be recovered: `assassins-favour` does
not say where the apostrophe belonged. The breakdown is still shown by display name, and that name
comes from the stash, which is a better source than poe.ninja was.

**Icons** no longer come from poe.ninja, which publishes them for chaos and divine only. They are
taken from the **stash response**, where every item has an `icon` field pointing at GGG's own CDN.
That is a better source than poe.ninja ever was: it is the artwork for exactly the item being
counted, from the artists themselves. A poll stores what it saw in the price set the icon lookup
reads anyway, and writes only when something was new.

**Uniques** go unpriced — see `PRICE_UNIQUE_CATEGORIES` in the settings.

> **▸ Why there are two kinds of id and what follows from it:** newer items use a slug derived from
> the name (`accelerating-catalyst`, `awakeners-orb`), but older currency uses trade-site
> shorthand (`alt`, `alch`, `gcp`, `chaos`). A rule produces the slug; no rule produces the
> shorthand, so those live in a table in `services/ninjaId.ts`.
>
> That table **cannot be checked against the price response**, because the response has no names.
> So the failure is shaped to be visible: a missing shorthand means the name matches nothing and
> the item lands on the "no price" list — visibly unpriced, not silently zero. A poll additionally
> logs the ids nothing in the stash matched, which is exactly what a missing shorthand looks like.
> `verifyAliases` checks the table against the two names the API still gives.

### Choosing the display name from a stash item

A stash item carries `name`, `typeLine` and `baseType`, and which of them is the display name
depends on what kind of item it is:

| Kind | Display name |
|------|--------------|
| Currency, fragments, scarabs, essences | `baseType` (= `typeLine`) |
| Divination cards | `typeLine` |
| Uniques | `name` — `baseType` is the base |

For uniques `name` is tried first, otherwise `baseType`. Otherwise a Headhunter would be valued as
a leather belt.

Names are sometimes prefixed with GGG's markup `<<set:MS>><<set:M>><<set:S>>`; that is stripped.

**Every name left unpriced is logged** on every poll, with its quantity. Deliberately skipped
categories (gems, maps, cluster jewels, unidentified uniques) are counted separately, so an
intentional skip does not look like a missing price.

> **▸ Why a silent zero is the worst option:** an item that cannot be priced sinks to zero in the
> total. In the chart it looks as though it does not exist. The log is where the hole is visible —
> and seeing the hole is the only way to fix it.

**If poe.ninja is down** and no new price set can be fetched, the poll carries on with the previous
one. A snapshot's `priceSetAt` says how old the prices it was valued at were, and the Snapshots
table shows it in the **PRICES** column. Only if there is no set at all does the poll fail.
