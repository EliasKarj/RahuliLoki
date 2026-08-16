import { useMemo, useState } from 'react';
import { useSnapshots } from './hooks/useSnapshots.ts';
import { NetWorthChart } from './components/NetWorthChart.tsx';
import { RatePerHourChart } from './components/RatePerHourChart.tsx';
import { TabAreaChart, TopItemsTable } from './components/TabBreakdown.tsx';
import { Hero } from './components/Hero.tsx';
import { SnapshotTable } from './components/SnapshotTable.tsx';
import { PollerStatus } from './components/PollerStatus.tsx';
import { Empty, Panel, RangeToggle } from './components/ui.tsx';
import { TokenGate } from './components/TokenGate.tsx';
import { ChangesTable } from './components/ChangesTable.tsx';
import { ItemHistory } from './components/ItemHistory.tsx';
import { DesktopSetup } from './components/DesktopSetup.tsx';
import { hasToken } from './lib/api.ts';
import { rangeStart } from './lib/series.ts';
import {
  formatAgo,
  formatChaos,
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
  const wide = range !== '24h';
  const leagues = config?.leagues ?? [];
  const activeLeague = league ?? config?.league ?? '';

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <header className="mb-6">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div className="flex items-baseline gap-3">
            <h1 className="text-lg font-semibold tracking-tight text-ink-100">valuuttaloki</h1>
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
          <RangeToggle value={range} onChange={setRange} />
        </div>

        <div className="mt-3">
          <PollerStatus health={health} onPolled={refresh} />
        </div>

        {/* Desktop build only: renders nothing in a browser. */}
        <div className="mt-3">
          <DesktopSetup onChanged={refresh} />
        </div>

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
          snapshot every {config?.pollCron ?? '10 minutes'}; you can also trigger one by hand above.
        </Empty>
      ) : (
        <div className="space-y-6">
          <Hero snapshots={snapshots} stats={stats} prices={health?.prices ?? null} />

          <Panel
            title="Items"
            subtitle={
              latest
                ? `Latest snapshot, ${formatDateTime(latest.snapshot.takenAt)}. Click a name for its history.`
                : 'Latest snapshot.'
            }
          >
            <TopItemsTable items={latest?.topItems ?? []} onSelect={setSelected} />
          </Panel>

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

          <Panel
            collapsible
            defaultOpen={false}
            title="Where the wealth sits"
            subtitle="Per-tab value over time."
          >
            <TabAreaChart snapshots={snapshots} wide={wide} />
          </Panel>

          <Panel
            collapsible
            defaultOpen={false}
            title="What moved"
            subtitle={
              changes?.from && changes.to
                ? `Between ${formatDateTime(changes.from)} and ${formatDateTime(changes.to)}. ` +
                  `Gained ${formatChaos(changes.gainedChaos)}c, lost ${formatChaos(Math.abs(changes.lostChaos))}c.`
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

          <Panel
            collapsible
            defaultOpen={false}
            title="Snapshots"
            subtitle="The rows behind the charts, newest first."
          >
            <SnapshotTable snapshots={snapshots} intervals={intervals} />
          </Panel>
        </div>
      )}

      <footer className="mt-8 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-ink-800 pt-4 text-xs text-ink-400">
        <span>valuuttaloki {config?.version ?? ''}</span>
        {config ? <span>items under {config.minItemChaos}c are not counted</span> : null}
        {config && config.trackedTabs.length > 0 ? (
          <span>tracking {config.trackedTabs.join(', ')}</span>
        ) : config ? (
          <span>tracking every tab</span>
        ) : null}
        {refreshedAt ? <span>refreshed {formatAgo(new Date(refreshedAt).toISOString())}</span> : null}
      </footer>
    </div>
  );
}
