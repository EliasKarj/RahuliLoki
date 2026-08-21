# What the page shows

The look, the views, and how the numbers are computed.

[← back to the README](../README.md)

---

The page is a **ledger, not a card wall**. No boxes and no frames: hairlines separate the
sections, and the only things with edges are the numbers themselves.

## The three views

**Dashboard**, **Economy** and **Kingsmarch**, chosen from a panel that slides in from the left
edge. The button at the top-left opens it, and wears the name of the view you are in — so a shut
panel still says where you are, which is the one thing the permanent rail it replaced did better.
Choosing a view closes it, as does Escape or clicking the dimmed page behind it.

The rail was honest about your position at all times, and charged thirteen rems of every window
for it, on a page whose whole point is wide tables. Switching views is something you do a few
times an hour; the width is wanted continuously.

**Kingsmarch** is your uniques as the disenchanting bench sees them: one row per item level,
quality, links and tab, because those are what dust and price read and what the dashboard's item
table folds away, with the dust each one yields at its own level and quality. Item level
dominates: the same unique at level 65 gives a twentieth of what it gives at 84. A `≥` marks a
dust figure that is a floor — a corrupted item may carry implicits the stash payload does not
list, each worth half again. The column it exists for is **dust per chaos** — what is worth
destroying rather than selling, which dust alone cannot say. A `~` on a price means poe.ninja
had no line for exactly this item and the closest cheap one was used.

**Dashboard** is everything below — what you own, what it is worth, and what it has been doing.

> **▸ The one step in the chart that is not a gain.** Uniques were not counted in any total
> until 1.4.0, because there were no prices for them that could tell a six-link from a plain
> item. The first poll after upgrading counts every unique you already owned, all at once, and
> the line jumps by whatever they are worth. Nothing about that is earnings, so the range
> containing it says so: "What moved" shows a notice, and the gain figure carries a note. Every
> snapshot records whether uniques were in its total, which is the only way the two can be told
> apart afterwards.

**Economy** is the same prices seen the other way round: every item poe.ninja prices, whether or
not you hold any. Each row carries what it costs, **how much it has moved** as a percentage, and
a small **trend** line — poe.ninja publishes all three on every price line, and this reads them.
Search by name, by poe.ninja's own id (`gcp`, `alt`), or by category; filter by category; sort by
name, value, change or volume. It costs one local request when the tab opens and nothing leaves
the machine — these are the prices the valuation already fetched.

Clicking a name opens **that item's price history**: what it actually cost at every price fetch
this app has kept, in chaos or divine like everything else. That is a different thing from the
trend line beside it — the trend is poe.ninja's percentage series over a window poe.ninja chose,
this is the app's own record of the real number. It reaches back as far as `PRICE_SET_RETENTION`
allows, two days at the default, and further if you raise it.

An empty change cell means poe.ninja published no movement for that row. It does not mean the
price held still.

Rows with no artwork of their own show a **category** picture instead, dimmed. It says what kind
of thing the row is, not which thing, and the dimming is what keeps those two apart.

Most of it comes from the list itself. Every item you hold arrives with its real artwork from the
stash, so a category with one illustrated row lends that picture to the rest of that category —
no CDN path written down, no request made, and it fills in further every time a poll sees
something new. The donor is the lowest id in the category rather than the dearest or the topmost,
so the picture does not change when the market does.

Where the list has nothing to lend, a small table steps in: the divination card back, which GGG
drew for the whole kind and which beats any donor, and a Chaos Orb, a Vaal fragment, an essence
and an oil for their categories, which do not — a donor replaces those the moment one exists.
A category with neither stays blank.

A `?` after a name means the name was read back from poe.ninja's id rather than known, and a slug
has lost its apostrophes. Most rows no longer carry one: poe.ninja's item endpoint publishes its
own spelling for the categories it covers, and that name is both what the row is labelled with and
what its artwork is filed under — which is why rows that used to sit there blank now have their
icons. Hovering a remaining mark says what poe.ninja actually calls the row.

---

## Width

The page uses the window it is given, up to 108rem. It used to stop at 72rem, which is the right
measure for prose and the wrong one for a screen made of tables and charts: full-screen, it left
four hundred pixels of void down either side while the item table scrolled inside a box.

The cap exists because a table row three thousand pixels wide puts an item's name and its value
at opposite ends of the desk. For the same reason the two tables of short cells — Snapshots and
What moved — keep their own narrower measure and sit left-aligned inside the page rather than
stretching across it. The item table does stretch, because its first column holds real names and
a bar behind them, and it has somewhere to put the room.

The item table's height follows the window too, up to 70% of it: a taller window shows more rows
rather than the same rows in the same box with empty page underneath.

---

## Type

Three faces, all carried in the package: **Inter** for text, **JetBrains Mono** for every number,
and **Cinzel** — a Roman inscriptional face — for the wordmark alone.

> **▸ Why they are bundled rather than named and hoped for:** the stylesheet used to ask for
> JetBrains Mono and fall back to whatever monospace the machine had, which on Windows is
> Consolas. The app most people ran was therefore not the app that was designed, and nobody
> could tell. Self-hosting is the only fix available here: the Content-Security-Policy says
> `font-src 'self'`, and it should — a wealth tracker has no business telling a font host when
> it is opened. Three variable files, about 300 kB, in an installer of 160 MB.

Small caps are now one thing and not everything. The wordmark is carved; section headings,
figure labels and table headers are set in sentence case at a normal size, because five stacked
headings in wide-tracked capitals is a lot of texture for a page whose job is to be read at a
glance.

---

## The look: Citadel at the End of Time

A void that is not quite black, gold that is the only light in it, and violet that is time
itself. The wordmark is wide-tracked capitals in a serif — carved rather than typeset — and a
dying glow burns behind the net-worth figure.

| Role | Colour | Where |
|------|--------|-------|
| **gold** | `#e2a94f` | chaos and all wealth: net worth, totals, gains |
| **violet** | `#9d7bf0` | divine: the rate line and any series quoted in divine |
| **dust** | `#7a6f92` | what happened without moving the number: idle intervals, losses |
| **void** | `#070610` | the background, with just enough violet in it not to be neutral |

> **▸ Why losses are not red:** direction is already read from the sign. Red would be a third hue
> for something already distinguishable, and would spend a colour on a meaning nothing else on
> the page uses.
>
> **▸ Why the chart colours live in their own file:** Recharts takes colours as props rather than
> as classes, so every chart used to carry its own copy of `#e0a458` — six files agreeing by
> luck. They stopped agreeing the moment the palette changed. The colours now live in
> `web/src/lib/palette.ts`, and the palette is two files instead of eight.
>
> **▸ Why the background glows are that dim:** there is a screenful of small numbers on top of
> them. Anything strong enough to notice directly would be strong enough to read them through.

At the top, one dominant figure — net worth — with the series drawn behind it. The figure is in
the unit you would say out loud: **a stash worth less than a divine in chaos, more than one in
divine**, with that orb's own artwork beside it. The other denomination is always on the line
below, so nothing is lost in the switch.

The same rule governs **every price on the page** — unit prices and totals in the table, the
category chips, changes, gains and hourly rates. The rule is written in one place
(`formatPrice`) and the divine rate lives in a React context, so printing a price in the wrong
unit would take bypassing the rule rather than forgetting it.

> **▸ Two places the rule does not apply, each for a reason:**
>
> **The divine rate itself** ("205c per divine"). It *is* the conversion; in divine it would read
> 1.00 on every line and say nothing.
>
> **Chart axes.** The per-value rule is right for a single figure and wrong for an axis: an axis
> whose ticks changed unit halfway up would make the curve a lie about its own shape. A chart
> therefore picks one unit from its peak and says so in the ticks.

In the top row, between the state and the **poll now** button, runs a **countdown to the next
automatic poll**: `next poll in 4:07`. While a poll is running it reads `polling now` instead,
and when there is no automatic collection (credentials missing, or the poller halted) the reason
stands where the countdown would.

> **▸ Why the time is asked of the scheduler rather than recomputed from the cron expression:** a
> second parser can disagree with the one actually holding the clock, and a countdown that
> disagrees with the timer is worse than no countdown. The server asks node-cron for its own
> upcoming runs and picks the first one that does not fall inside a backoff — after a failed poll
> a tick is **skipped** rather than delayed, so "the next tick" and "the next poll" are different
> questions.

When a newer version has been released, a single line appears under that row: *What Remains
1.1.0 is out — you are running 1.0.2*, with a link to the release page and a **dismiss**. The
dismissal is remembered for that version only, so the next release says so again. Nothing is
downloaded or installed by the app itself — see
[What leaves the machine](credentials.md#what-leaves-the-machine).

Two supporting figures sit underneath in a row divided by hairlines: **gain in range** and the
**rate while moving**, the latter with the hours it is divided by beside it. Immediately after
them comes the **item table**, where each row has a bar behind it: that row's share of the largest
holding. The charts are further down as single-line bars, closed by default.

> **▸ Why two figures and not five:** there were five — gain, an active rate, a wall-clock rate,
> how long the stash was moving, and the best hour in the range. Four of them were the same
> question asked four ways, and the two rates differed by a distinction nobody remembers by their
> second visit. One rate is kept, the active one, because the question a wealth tracker is asked
> is "how fast am I earning while playing" and not "including the hours I was asleep". The hours
> sit beside it as its denominator rather than as a figure of their own. Both dropped numbers are
> still in `/api/stats`; only the row on screen got shorter.

> **▸ Why the four equal cards went away:** they gave net worth, gain and two hourly rates the
> same visual weight. Nobody reads them that way: one is the number the app was opened for, the
> rest are context on it. Four identical boxes flatten that difference and set the eye hunting
> for the one that matters.
>
> **▸ Why bars in the table:** a hundred rows of right-aligned numbers are hard to weigh against
> each other. A bar makes the shape of the stash readable without adding another chart to look
> at. It is scaled to the largest row rather than to the total — against the total, everything
> below the top three holdings would be too short to compare, which is the opposite of what a bar
> is for.

### 1. Net worth over time

Chaos as an area on the left axis, **the divine rate as a thin dashed line on the right**. Range:
24 h / 7 d / league.

> **▸ Why the rate is in the same chart:** without it, a rising chaos curve cannot be told apart
> from divine inflation. If the rate climbs 190 → 220 and you do nothing at all, your wealth
> measured in chaos still grows. Two axes side by side make the difference visible.

Spikes are marked with a dot: an interval whose change is more than **3× the median of the
preceding moving intervals**. Usually a trade or a big drop.

### 2. Chaos per hour

One bar per gap between consecutive snapshots, normalised to an hour. Faint bars are idle
intervals.

The rate at the top is **while moving**, with the active hours and the wall-clock hours beside
it.

> **▸ Why the active hours rather than the clock:** eight hours slept through is not a bad farming
> rate, it is not farming at all. Count the idle hours and the number shrinks towards zero and
> says nothing. Leave them out and the number describes the rate *while playing*. Both hour counts
> are printed next to it, so the wall-clock rate is a division away and does not need a figure of
> its own; `/api/stats` reports it outright.

### 3. Where the wealth sits

A stacked area per tab, and a sortable table of the largest holdings in the newest snapshot.

### 4. What moved

The difference between the ends of the range, per item, rather than a running total — a running
total would only repeat the c/h chart. Gains and losses are shown separately rather than netted:
*+4000 and −1000* and *+3000* are the same net and a very different evening.

> **▸ Why tabs are summed before the difference:** moving a stack from a dump tab to a currency
> tab is not an event. A per-tab difference would report it as a loss in one place and an exactly
> equal gain in another — two lines of noise about something that did not happen, in precisely the
> view whose job is to surface the things that did.

> **▸ Why the `Why` column is there:** a holding whose quantity did not change but whose value
> rose is the market, not you. Without the distinction, a wealth tracker quietly takes credit for
> a spike in the divine rate. `held` = you acquired or spent, `price` = the same quantity at a
> different price, `both` = both moved.

### 5. An item's history

Click a name in any table. The area is the pile's value, the thin line its unit price. A rising
area over a flat line is your doing; a rising line under a flat quantity is the market's.

> **▸ Why a missing item is zero rather than a gap:** a stack that was sold ought to drop to zero.
> A gap would make the series look as though it ended, which is a different claim.

> **▸ Why this is fetched only on a click:** it is the one route that reads every breakdown in the
> range — the column deliberately left out of every other list response.

### 6. Snapshots

The rows the charts are made of: the value, the change from the previous one, the divine rate at
that moment, the item count, and a mark on the intervals that moved unusually far. This is the
table you read when a chart looks strange.

> **▸ Why one value column:** there were two, "Chaos" and "Divine", and they printed the same
> holding. Above one divine of net worth — where this app spends its life — the column headed
> "Chaos" read `169.28 div` and the one headed "Divine" read `169.28`. One column now, headed by
> what it is rather than by a unit, with the unit in each cell as everywhere else. The column of
> price ages went with it: the age of the price set is one fact, and it is in the status row at
> the top rather than repeated down twenty-five rows.

---

## How the numbers are computed

**The idle rule.** If two consecutive snapshots differ by less than **1 chaos**, the interval is
idle. It adds nothing to the active hours and does not affect the active average. It still shows
in the chart as a faint bar, because the measurement was taken.

**Best hour.** Computed and served by `/api/stats`, though no longer shown on the page. The
largest rise inside **any** 60-minute window, not "the best ten minutes times
six". Computed with a monotonic queue, so an uneven interval does not break it — and uneven
intervals do happen: a container restarts, a machine sleeps, GGG's rate limiter pushes a poll into
the next window.

**Spike marking.** A rolling median over at most 12 preceding moving intervals. At least three
intervals are needed before anything is marked: from two you cannot know what ordinary looks
like. Idle intervals are left out of the median, which would otherwise sink towards zero and make
*everything* a spike.

**The threshold.** `MIN_ITEM_CHAOS` applies to the **summed** holding, not to a single stack.

> **▸ Why the sum:** 900 alterations at 0.12c is 108 chaos, even though each one alone is below
> the threshold. And if a stack is split ten ways, a per-stack threshold would throw the whole
> pile away. Ten piles of 5 alterations is the same thing as fifty alterations.

**Item count** is units: a stack of 250 chaos is 250 items.
