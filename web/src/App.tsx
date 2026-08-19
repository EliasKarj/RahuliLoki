import { useMemo, useState } from 'react';
import { useSnapshots } from './hooks/useSnapshots.ts';
import { NetWorthChart } from './components/NetWorthChart.tsx';
import { RatePerHourChart } from './components/RatePerHourChart.tsx';
import { TabAreaChart } from './components/TabAreaChart.tsx';
import { TopItemsTable } from './components/ItemsTable.tsx';
import { Hero } from './components/Hero.tsx';
import { DenominationProvider } from './lib/denomination.tsx';
import { SnapshotTable } from './components/SnapshotTable.tsx';
import { PollerStatus } from './components/PollerStatus.tsx';
import { Empty, Panel, RangeToggle } from './components/ui.tsx';
import { TokenGate } from './components/TokenGate.tsx';
import { ChangesTable } from './components/ChangesTable.tsx';
import { ItemHistory } from './components/ItemHistory.tsx';
import { DesktopSetup } from './components/DesktopSetup.tsx';
import { UpdateNotice } from './components/UpdateNotice.tsx';
import { hasToken } from './lib/api.ts';
import { rangeStart } from './lib/series.ts';
import { describeSchedule } from './lib/schedule.ts';
import {
  formatAgo,
  formatPrice,
  formatDateTime,
} from './lib/format.ts';
import type { RangeKey } from './lib/series.ts';

export default function App() {
  const [range, setRange] = useState<RangeKey>('24h');
  const [league, setLeague] = useState<string | undefined>(undefined);
  /** The item whose history is open, if any. Clicking a name anywhere sets it. */
  const [selected, setSelected] = useState<string | null>(null);

  const {
    snapshots,
    stats,
    changes,
    latest,
    config,
    health,
    loading,
    error,
    unauthorized,
    refreshedAt,
    refresh,
  } = useSnapshots(league, range);

  // Same shape the hook queries with, so the on-demand item history covers the same window as
  // everything else on screen.
  const itemRange = useMemo(
    () => ({ ...(league ? { league } : {}), ...(rangeStart(range) ? { from: rangeStart(range) as string } : {}) }),
    [league, range],
  );

  // A 401 while this tab already held a token means the token is wrong, not merely missing —
  // worth saying so, rather than silently showing the same empty box again.
  if (unauthorized) return <TokenGate onUnlock={refresh} rejected={hasToken()} />;

  const intervals = stats?.intervals ?? [];
  // One rate for the whole page. `stats` carries the live one; the newest snapshot is the
  // fallback before there are two snapshots to compute stats from.
  const divineRate = stats?.divineRate || latest?.snapshot.divineRate || 0;
  const wide = range !== '24h';
  const leagues = config?.leagues ?? [];
  const activeLeague = league ?? config?.league ?? '';

  return (
    <DenominationProvider divineRate={divineRate}>
    {/* Width scales with the window instead of stopping at a fixed column.
     *
     * It used to be capped at 72rem, which is a sensible measure for prose and the wrong one
     * here: this page is tables and charts, and on a full-screen window it left four hundred
     * pixels of empty void down either side while the item table scrolled inside a box. A table
     * gets better with width — more of it fits, and the columns stop crowding each other.
     *
     * There is still a cap, because a row three thousand pixels wide puts an item's name and
     * its value at opposite ends of the desk. 108rem is about where that starts. */}
    <div className="page mx-auto w-full max-w-[108rem] px-4 py-6 sm:px-8 lg:px-10">
      <header className="mb-6">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div className="flex items-baseline gap-3">
            {/* Carved, not typeset — see .wordmark. The trailing letter's tracking is padding
                on the right of the last glyph, so the league beside it needs no extra gap. */}
            <h1 className="wordmark text-base font-semibold xl:text-lg">What Remains</h1>
            {leagues.length > 1 ? (
              <select
                value={activeLeague}
                onChange={(event) => setLeague(event.target.value)}
                className="rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-200"
                aria-label="League"
              >
                {leagues.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            ) : (
              <span className="text-xs text-ink-400">{activeLeague}</span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <RangeToggle value={range} onChange={setRange} />
            {/* Desktop build only: renders nothing in a browser. Corner-sized on purpose —
                it is the first thing that matters once and the last thing that matters after. */}
            <DesktopSetup onChanged={refresh} />
          </div>
        </div>

        <div className="mt-3">
          <PollerStatus health={health} onPolled={refresh} />
        </div>

        {/* Renders nothing unless there is a release newer than this build, and nothing at all
            once dismissed. See lib/update.ts. */}
        <UpdateNotice update={health?.update} />

        {error ? (
          <p className="mt-3 rounded border border-accent-600/50 bg-accent-600/10 px-3 py-2 text-xs text-accent-400">
            {error}
          </p>
        ) : null}
      </header>

      {loading && snapshots.length === 0 ? (
        <Empty>Loading…</Empty>
      ) : snapshots.length === 0 ? (
        <Empty>
          Nothing recorded for {activeLeague || 'this league'} in this range yet. The poller writes a
          snapshot {describeSchedule(config?.pollCron ?? null)}; you can also trigger one by hand
          above.
        </Empty>
      ) : (
        <div className="space-y-8">
          <Hero snapshots={snapshots} stats={stats} orbs={health?.prices ?? null} />

          {/* No heading at all, unlike every section below it. Those fold away and need a
              label to be unfolded by; this one is always open, sits directly under the hero's
              rule, and opens with a search box over a column called Item. A word saying
              "Items" over that is a label on a labelled thing. */}
          <section>
            <TopItemsTable items={latest?.topItems ?? []} onSelect={setSelected} />
          </section>

          <Panel
            collapsible
            defaultOpen={false}
            title="Net worth over time"
            subtitle="Chaos on the left, the divine rate on the right — a rise against a falling rate is inflation, not profit."
          >
            <NetWorthChart snapshots={snapshots} intervals={intervals} wide={wide} />
          </Panel>

          <Panel
            collapsible
            defaultOpen={false}
            title="Chaos per hour"
            subtitle="One bar per interval. Faint bars moved less than a chaos and are left out of the active average."
          >
            <RatePerHourChart intervals={intervals} wide={wide} />
          </Panel>

          <Panel collapsible defaultOpen={false} title="Where the wealth sits">
            <TabAreaChart snapshots={snapshots} wide={wide} />
          </Panel>

          <Panel
            collapsible
            defaultOpen={false}
            title="What moved"
            subtitle={
              changes?.from && changes.to
                ? `Between ${formatDateTime(changes.from)} and ${formatDateTime(changes.to)}. ` +
                  `Gained ${formatPrice(changes.gainedChaos, divineRate)}, lost ` +
                  `${formatPrice(Math.abs(changes.lostChaos), divineRate)}.`
                : 'Between the ends of this range.'
            }
          >
            <ChangesTable
              changes={changes?.changes ?? []}
              emptyReason={changes?.reason}
              onSelect={setSelected}
            />
          </Panel>

          {selected ? (
            <ItemHistory
              name={selected}
              range={itemRange}
              wide={wide}
              onClose={() => setSelected(null)}
            />
          ) : null}

          <Panel collapsible defaultOpen={false} title="Snapshots">
            <SnapshotTable snapshots={snapshots} intervals={intervals} />
          </Panel>
        </div>
      )}

      <footer className="mt-8 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-ink-800 pt-4 text-xs text-ink-400">
        <span>What Remains {config?.version ?? ''}</span>
        {config ? <span>items under {config.minItemChaos}c are not counted</span> : null}
        {/* Only when it is not every tab. "Tracking every tab" is the default state, and a
            footnote that says what is already true of an untouched install is a footnote that
            is on screen for everyone and useful to nobody. */}
        {config && config.trackedTabs.length > 0 ? (
          <span>tracking {config.trackedTabs.join(', ')}</span>
        ) : null}
        {refreshedAt ? <span>refreshed {formatAgo(new Date(refreshedAt).toISOString())}</span> : null}
      </footer>
    </div>
    </DenominationProvider>
  );
}
