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
import { formatChaos, formatCount, formatDateTime, formatDay, formatTime } from '../lib/format.ts';
import { Empty, TooltipCard } from './ui.tsx';
import { ItemIcon } from './ItemIcon.tsx';

const AXIS = { stroke: '#6b7787', fontSize: 11 };

/**
 * Tabs need to be told apart, and the palette is two accents. Alternating them and stepping
 * the opacity gives a readable stack without inventing new hues for what is one quantity —
 * chaos — split by container.
 */
const BANDS = ['#e0a458', '#7aa2f7', '#b8823c', '#5b82d4', '#edb974', '#9bbaf9'] as const;

function bandColour(index: number): string {
  return BANDS[index % BANDS.length] as string;
}

export function TabAreaChart({ snapshots, wide }: { snapshots: SnapshotWithTabs[]; wide: boolean }) {
  const names = useMemo(() => tabNames(snapshots), [snapshots]);
  const rows = useMemo(() => tabRows(snapshots, names), [snapshots, names]);

  if (rows.length < 2 || names.length === 0) {
    return <Empty>Per-tab history appears once there are two snapshots to compare.</Empty>;
  }

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="#232a34" vertical={false} />
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
          <YAxis tickFormatter={formatChaos} {...AXIS} tickLine={false} axisLine={false} width={56} />

          <Tooltip
            cursor={{ stroke: '#333c49' }}
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
                    formatChaos(value),
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

type Column = { key: keyof TopItem & string; label: string; numeric: boolean };

const COLUMNS: Column[] = [
  { key: 'name', label: 'Item', numeric: false },
  { key: 'tab', label: 'Tab', numeric: false },
  { key: 'qty', label: 'Qty', numeric: true },
  { key: 'chaosEach', label: 'Each', numeric: true },
  { key: 'chaosTotal', label: 'Total', numeric: true },
];

export function TopItemsTable({
  items,
  onSelect,
}: {
  items: TopItem[];
  /** Given, each name becomes a button that opens that item's history. */
  onSelect?: (name: string) => void;
}) {
  const [sort, setSort] = useState<{ key: Column['key']; direction: SortDirection }>({
    key: 'chaosTotal',
    direction: 'desc',
  });

  const rows = useMemo(() => sortRows(items, sort.key, sort.direction).slice(0, 50), [items, sort]);

  if (items.length === 0) {
    return <Empty>The latest snapshot holds nothing above the value threshold.</Empty>;
  }

  const toggle = (key: Column['key']) =>
    setSort((current) =>
      current.key === key
        ? { key, direction: current.direction === 'desc' ? 'asc' : 'desc' }
        : { key, direction: key === 'name' || key === 'tab' ? 'asc' : 'desc' },
    );

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
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
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.tab}/${row.name}`} className="border-b border-ink-850 last:border-0">
              <td className="py-1.5 pr-3 text-ink-100">
                <span className="flex items-center gap-2">
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
              <td className="py-1.5 pr-3 text-ink-400">{row.tab}</td>
              <td className="num py-1.5 pr-3 text-ink-200">{formatCount(row.qty)}</td>
              <td className="num py-1.5 pr-3 text-ink-400">{formatChaos(row.chaosEach)}</td>
              <td className="num py-1.5 text-accent-500">{formatChaos(row.chaosTotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {items.length > rows.length ? (
        <p className="mt-2 text-xs text-ink-400">
          Showing the top {rows.length} of {items.length} priced holdings.
        </p>
      ) : null}
    </div>
  );
}
