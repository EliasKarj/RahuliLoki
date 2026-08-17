/**
 * Where the wealth actually sits: a stacked area of per-tab value over time, and a sortable
 * table of the latest snapshot's biggest holdings.
 *
 * Tabs are stacked biggest-first by their current value, so the band that dominates the chart
 * is the one at the bottom, and the ordering does not reshuffle as you scroll through ranges.
 */

import { useMemo, useState } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { SnapshotWithTabs, TopItem } from '../lib/api.ts';
import { sortRows, tabNames, tabRows, type SortDirection } from '../lib/series.ts';
import { formatCount, formatDateTime, formatDay, formatInUnit, formatTime } from '../lib/format.ts';
import { usePrices } from '../lib/denomination.tsx';
import { Empty, TooltipCard } from './ui.tsx';
import { ItemIcon } from './ItemIcon.tsx';
import { AXIS, BANDS, PALETTE } from '../lib/palette.ts';

function bandColour(index: number): string {
  return BANDS[index % BANDS.length] as string;
}

export function TabAreaChart({ snapshots, wide }: { snapshots: SnapshotWithTabs[]; wide: boolean }) {
  const prices = usePrices();
  const names = useMemo(() => tabNames(snapshots), [snapshots]);
  const rows = useMemo(() => tabRows(snapshots, names), [snapshots, names]);
  // One unit for the axis, from the largest total on it. Ticks that changed unit halfway up
  // would make the series a lie about its own shape.
  const unit = prices.axis(snapshots.map((snapshot) => snapshot.totalChaos));

  if (rows.length < 2 || names.length === 0) {
    return <Empty>Per-tab history appears once there are two snapshots to compare.</Empty>;
  }

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={PALETTE.grid} vertical={false} />
          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={['dataMin', 'dataMax']}
            tickFormatter={(value: number) =>
              wide ? formatDay(new Date(value).toISOString()) : formatTime(new Date(value).toISOString())
            }
            {...AXIS}
            tickLine={false}
            minTickGap={48}
          />
          <YAxis tickFormatter={(value: number) => formatInUnit(value, unit)}
          {...AXIS}
          tickLine={false}
          axisLine={false}
          width={56}
        />

          <Tooltip
            cursor={{ stroke: PALETTE.edge }}
            content={({ active, payload }) => {
              const row = payload?.[0]?.payload as Record<string, number | string> | undefined;
              if (!active || !row) return null;
              const entries = names
                .map((name) => [name, Number(row[name] ?? 0)] as const)
                .filter(([, value]) => value > 0)
                .sort((a, b) => b[1] - a[1]);
              return (
                <TooltipCard
                  title={formatDateTime(String(row.takenAt))}
                  rows={entries.map(([name, value], index) => [
                    name,
                    `${formatInUnit(value, unit)}${unit.suffix}`,
                    index % 2 === 0 ? 'text-accent-500' : 'text-cool-500',
                  ])}
                />
              );
            }}
          />

          {names.map((name, index) => (
            <Area
              key={name}
              type="monotone"
              dataKey={name}
              stackId="tabs"
              stroke={bandColour(index)}
              strokeWidth={1}
              fill={bandColour(index)}
              fillOpacity={0.28}
              isAnimationActive={false}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>

      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-300">
        {names.map((name, index) => (
          <li key={name} className="flex items-center gap-1.5">
            <span
              className="inline-block h-2 w-2 rounded-[2px]"
              style={{ backgroundColor: bandColour(index) }}
            />
            {name}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * One row of the items table: an item, wherever it sits.
 *
 * The snapshot's breakdown is per tab, so the same currency in three tabs arrives as three
 * rows. To a player that is one pile — the split is an accident of storage, not a fact about
 * their wealth — so the rows are folded together here and the tabs become a column, the way
 * every stash tracker worth using shows it.
 */
interface ItemRow {
  name: string;
  tabs: string[];
  qty: number;
  chaosEach: number;
  chaosTotal: number;
  icon?: string;
  category: string;
}

/** What an item with no category is filed under. Not a category poe.ninja has. */
export const UNCATEGORISED = 'Other';

/** poe.ninja spells its types in PascalCase; a person reads them with spaces. */
export function categoryLabel(category: string): string {
  return category.replace(/([a-z])([A-Z])/g, '$1 $2');
}

export function groupByItem(items: TopItem[]): ItemRow[] {
  const byName = new Map<string, ItemRow>();
  for (const item of items) {
    const row = byName.get(item.name);
    if (row === undefined) {
      byName.set(item.name, {
        name: item.name,
        tabs: [item.tab],
        qty: item.qty,
        chaosTotal: item.chaosTotal,
        chaosEach: item.chaosEach,
        category: item.category ?? UNCATEGORISED,
        ...(item.icon === undefined ? {} : { icon: item.icon }),
      });
      continue;
    }
    row.qty += item.qty;
    row.chaosTotal = Math.round((row.chaosTotal + item.chaosTotal) * 100) / 100;
    if (!row.tabs.includes(item.tab)) row.tabs.push(item.tab);
    // Unit price does not add up. Keeping the one already recorded is right: every copy of an
    // item is priced identically, so the tabs cannot disagree.
    if (row.icon === undefined && item.icon !== undefined) row.icon = item.icon;
  }
  return [...byName.values()];
}

type SortKey = 'name' | 'tabs' | 'qty' | 'chaosEach' | 'chaosTotal';
type Column = { key: SortKey; label: string; numeric: boolean };

const COLUMNS: Column[] = [
  { key: 'name', label: 'Item', numeric: false },
  { key: 'tabs', label: 'Tabs', numeric: false },
  { key: 'qty', label: 'Qty', numeric: true },
  { key: 'chaosEach', label: 'Each', numeric: true },
  { key: 'chaosTotal', label: 'Total', numeric: true },
];

export function sortItemRows(rows: ItemRow[], key: SortKey, direction: SortDirection): ItemRow[] {
  const sign = direction === 'desc' ? -1 : 1;
  return [...rows].sort((a, b) => {
    if (key === 'name') return sign * a.name.localeCompare(b.name);
    if (key === 'tabs') return sign * a.tabs.join(', ').localeCompare(b.tabs.join(', '));
    return sign * (a[key] - b[key]);
  });
}

/** Case- and punctuation-insensitive, so "assassins" finds "Assassin's Favour". */
/**
 * Each category present, with what it is worth, largest first.
 *
 * The totals are the point. "Scarab" on its own is a filter; "Scarab 3.2kc" answers the
 * question that made someone reach for the filter in the first place.
 */
export function categoryTotals(rows: ItemRow[]): Array<{ category: string; chaos: number }> {
  const totals = new Map<string, number>();
  for (const row of rows) {
    totals.set(row.category, (totals.get(row.category) ?? 0) + row.chaosTotal);
  }
  return [...totals.entries()]
    .map(([category, chaos]) => ({ category, chaos: Math.round(chaos * 100) / 100 }))
    // Uncategorised last whatever it is worth: it is a leftover pile, not a category, and
    // letting it head the list would suggest it means something.
    .sort((a, b) => {
      if (a.category === UNCATEGORISED) return 1;
      if (b.category === UNCATEGORISED) return -1;
      return b.chaos - a.chaos;
    });
}

export function matchesQuery(row: ItemRow, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === '') return true;
  const haystack = `${row.name} ${row.tabs.join(' ')}`.toLowerCase();
  return haystack.includes(needle) || haystack.replace(/[^a-z0-9 ]/g, '').includes(needle);
}

export function TopItemsTable({
  items,
  onSelect,
}: {
  items: TopItem[];
  /** Given, each name becomes a button that opens that item's history. */
  onSelect?: (name: string) => void;
}) {
  const [sort, setSort] = useState<{ key: SortKey; direction: SortDirection }>({
    key: 'chaosTotal',
    direction: 'desc',
  });
  const prices = usePrices();
  const [query, setQuery] = useState('');
  /** Null means every category. A category that vanishes from the data falls back to that. */
  const [category, setCategory] = useState<string | null>(null);

  const grouped = useMemo(() => groupByItem(items), [items]);
  // Totals are computed before the category filter and after the search, so the chips keep
  // showing what each category is worth while one of them is selected. Recomputing them from
  // the filtered rows would leave every chip but the active one reading zero.
  const searched = useMemo(() => grouped.filter((row) => matchesQuery(row, query)), [grouped, query]);
  const totals = useMemo(() => categoryTotals(searched), [searched]);

  const rows = useMemo(() => {
    const matching =
      category === null ? searched : searched.filter((row) => row.category === category);
    return sortItemRows(matching, sort.key, sort.direction);
  }, [searched, sort, category]);

  if (items.length === 0) {
    return <Empty>The latest snapshot holds nothing above the value threshold.</Empty>;
  }

  const toggle = (key: SortKey) =>
    setSort((current) =>
      current.key === key
        ? { key, direction: current.direction === 'desc' ? 'asc' : 'desc' }
        : { key, direction: key === 'name' || key === 'tabs' ? 'asc' : 'desc' },
    );

  // A running total only means anything while the rows are ordered by value, largest first.
  // Under any other sort it would be a column of numbers that add up to nothing, so it is not
  // shown at all rather than shown misleadingly.
  const cumulative = sort.key === 'chaosTotal' && sort.direction === 'desc';
  let running = 0;

  const total = rows.reduce((sum, row) => sum + row.chaosTotal, 0);
  // Scaled against the largest row, not against the total: against the total, everything below
  // the top two or three holdings is a bar too short to compare with its neighbours, which is
  // the opposite of what the bar is for.
  const largest = rows.reduce((max, row) => Math.max(max, row.chaosTotal), 0);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search items or tabs…"
          aria-label="Search items"
          className="w-64 rounded border border-ink-700 bg-ink-950 px-2.5 py-1.5 text-sm text-ink-100 outline-none placeholder:text-ink-500 focus:border-accent-600"
        />
        <span className="text-xs text-ink-400">
          {rows.length === grouped.length
            ? `${grouped.length} items`
            : `${rows.length} of ${grouped.length} items`}
          {' · '}
          {prices.price(total)}
        </span>
      </div>

      {/* Each category with what it is worth. The total is the point: "Scarab" alone is a
          filter, "Scarab 3.2kc" answers the question that made someone reach for it. */}
      <div className="mb-3 flex flex-wrap gap-1.5">
        <Chip active={category === null} onClick={() => setCategory(null)}>
          All <span className="num !text-left text-ink-400">{prices.price(total)}</span>
        </Chip>
        {totals.map((entry) => (
          <Chip
            key={entry.category}
            active={category === entry.category}
            onClick={() => setCategory(category === entry.category ? null : entry.category)}
          >
            {categoryLabel(entry.category)}{' '}
            <span className="num !text-left text-ink-400">{prices.price(entry.chaos)}</span>
          </Chip>
        ))}
      </div>

      <div className="max-h-[32rem] overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-ink-900">
            <tr className="border-b border-ink-800 text-xs uppercase tracking-wider text-ink-400">
              {COLUMNS.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className={`py-2 font-medium ${column.numeric ? 'text-right' : 'text-left'}`}
                  aria-sort={
                    sort.key === column.key
                      ? sort.direction === 'asc'
                        ? 'ascending'
                        : 'descending'
                      : 'none'
                  }
                >
                  <button
                    type="button"
                    onClick={() => toggle(column.key)}
                    className="transition-colors hover:text-ink-200"
                  >
                    {column.label}
                    {sort.key === column.key ? (sort.direction === 'desc' ? ' ↓' : ' ↑') : ''}
                  </button>
                </th>
              ))}
              {cumulative ? (
                <th scope="col" className="py-2 text-right font-medium">
                  Cumulative
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              running += row.chaosTotal;
              return (
                <tr
                  key={row.name}
                  className="group relative border-b border-ink-850 last:border-0"
                >
                  {/* The row's share of the largest holding, drawn behind it. A hundred rows of
                      right-aligned numbers are hard to weigh against each other; this makes the
                      shape of a stash readable without a second chart to look at. */}
                  <td className="relative py-1.5 pr-3 text-ink-100">
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-y-0.5 left-0 z-0 rounded-r-sm bg-accent-500/[0.13] transition-colors group-hover:bg-accent-500/25"
                      style={{ width: largest > 0 ? `${(row.chaosTotal / largest) * 100}%` : '0%' }}
                    />
                    <span className="relative z-10 flex items-center gap-2">
                      <ItemIcon src={row.icon} />
                      {onSelect ? (
                        <button
                          type="button"
                          onClick={() => onSelect(row.name)}
                          className="text-left underline decoration-ink-700 underline-offset-2 transition-colors hover:decoration-accent-500"
                        >
                          {row.name}
                        </button>
                      ) : (
                        row.name
                      )}
                    </span>
                  </td>
                  <td className="py-1.5 pr-3 text-ink-500" title={row.tabs.join(', ')}>
                    {row.tabs.length === 1 ? row.tabs[0] : `${row.tabs[0]} +${row.tabs.length - 1}`}
                  </td>
                  <td className="num py-1.5 pr-3 text-ink-200">{formatCount(row.qty)}</td>
                  <td className="num py-1.5 pr-3 text-ink-400">{prices.price(row.chaosEach)}</td>
                  <td className="num py-1.5 text-accent-500">{prices.price(row.chaosTotal)}</td>
                  {cumulative ? (
                    <td className="num py-1.5 pl-3 text-ink-400">{prices.price(running)}</td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 ? (
          <p className="py-6 text-center text-xs text-ink-400">Nothing matches “{query}”.</p>
        ) : null}
      </div>
    </div>
  );
}

/** One category toggle. Pressed state is the aria contract, not just a colour. */
function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
        active
          ? 'border-accent-600 bg-accent-600/15 text-ink-100'
          : 'border-ink-800 text-ink-300 hover:border-ink-700 hover:text-ink-100'
      }`}
    >
      {children}
    </button>
  );
}
