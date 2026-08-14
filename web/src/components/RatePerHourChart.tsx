/**
 * Chaos per hour: one bar per interval between consecutive snapshots, normalised to an hour.
 *
 * Idle intervals — under a chaos of movement — are drawn faint and excluded from the active
 * average, which is why both averages are shown side by side. An eight-hour sleep between two
 * identical snapshots is not a bad farming rate, it is not farming at all, and the difference
 * between the two numbers is exactly how much of the wall clock was spent playing.
 */

import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { SeriesInterval } from '../lib/api.ts';
import { rateRows } from '../lib/series.ts';
import { formatChaos, formatDateTime, formatDay, formatHours, formatRate, formatSignedChaos, formatTime } from '../lib/format.ts';
import { Empty, TooltipCard } from './ui.tsx';

const AXIS = { stroke: '#6b7787', fontSize: 11 };

export function RatePerHourChart({ intervals, wide }: { intervals: SeriesInterval[]; wide: boolean }) {
  const rows = rateRows(intervals);

  if (rows.length === 0) {
    return <Empty>No completed intervals in this range yet.</Empty>;
  }

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
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
          <ReferenceLine y={0} stroke="#333c49" />

          <Tooltip
            cursor={{ fill: '#191e26' }}
            content={({ active, payload }) => {
              const row = payload?.[0]?.payload as ReturnType<typeof rateRows>[number] | undefined;
              if (!active || !row) return null;
              return (
                <TooltipCard
                  title={formatDateTime(row.to)}
                  rows={[
                    ['Rate', formatRate(row.chaosPerHour), row.idle ? 'text-ink-400' : 'text-accent-500'],
                    ['Change', formatSignedChaos(row.deltaChaos)],
                    ['Interval', formatHours(row.hours)],
                    ['Counted', row.idle ? 'no — idle' : 'yes'],
                  ]}
                />
              );
            }}
          />

          <Bar dataKey="chaosPerHour" isAnimationActive={false} maxBarSize={22}>
            {rows.map((row) => (
              <Cell
                key={row.to}
                fill={row.idle ? '#333c49' : row.chaosPerHour >= 0 ? '#e0a458' : '#6b7787'}
                stroke={row.annotated ? '#7aa2f7' : undefined}
                strokeWidth={row.annotated ? 1.25 : 0}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
