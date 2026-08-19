/**
 * Where the wealth sits: a stacked area of per-tab value over time.
 *
 * Tabs are stacked biggest-first by their current value, so the band that dominates the chart is
 * the one at the bottom, and the ordering does not reshuffle as you scroll through ranges.
 */

import { useMemo } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { SnapshotWithTabs } from '../lib/api.ts';
import { tabNames, tabRows } from '../lib/series.ts';
import { formatDateTime, formatDay, formatInUnit, formatTime } from '../lib/format.ts';
import { usePrices } from '../lib/denomination.tsx';
import { Empty, TooltipCard } from './ui.tsx';
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
