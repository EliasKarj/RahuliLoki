# What the page shows

The look, the views, and how the numbers are computed.

[← back to the README](../README.md)

---

The page is a **ledger, not a card wall**. No boxes and no frames: hairlines separate the
sections, and the only things with edges are the numbers themselves.

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

The supporting figures sit underneath in a row divided by hairlines. Immediately after them comes
the **item table**, where each row has a bar behind it: that row's share of the largest holding.
The charts are further down as single-line bars, closed by default.

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

Both figures are at the top: **c/h active** and **c/h wall-clock**.

> **▸ Why two figures:** eight hours slept through is not a bad farming rate, it is not farming at
> all. Count the idle hours and the number shrinks towards zero and says nothing. Leave them out
> and the number describes the rate *while playing* — but not how many hours the league has
> actually taken. Both, side by side.

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

The rows the charts are made of: the change from the previous one, the divine rate at that moment,
the age of the prices, and whether the interval counted as active. This is the table you read
when a chart looks strange.

---

## How the numbers are computed

**The idle rule.** If two consecutive snapshots differ by less than **1 chaos**, the interval is
idle. It adds nothing to the active hours and does not affect the active average. It still shows
in the chart as a faint bar, because the measurement was taken.

**Best hour.** The largest rise inside **any** 60-minute window, not "the best ten minutes times
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
