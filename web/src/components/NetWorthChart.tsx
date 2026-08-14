/**
 * Net worth over time — the primary chart.
 *
 * Chaos as a filled area on the left axis, the divine rate as a thin line on the right. The
 * overlay is the whole point: a rising chaos total during a falling divine rate is inflation,
 * not profit, and without the second axis the two are indistinguishable.
 *
 * Spike markers sit on snapshots whose interval the server flagged as more than 3× the
 * trailing median — a sale, a big drop, or a purchase.
 */

import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { SeriesInterval, SnapshotWithTabs } from '../lib/api.ts';
import { annotationPoints, netWorthRows } from '../lib/series.ts';
import { formatChaos, formatDateTime, formatDay, formatDivine, formatSignedChaos, formatTime } from '../lib/format.ts';
import { Empty, TooltipCard } from './ui.tsx';

const AXIS = { stroke: '#6b7787', fontSize: 11 };

interface Props {
  snapshots: SnapshotWithTabs[];
  intervals: SeriesInterval[];
  /** True when the range spans more than a day, which changes the tick format. */
  wide: boolean;
}

export function NetWorthChart({ snapshots, intervals, wide }: Props) {
  const rows = netWorthRows(snapshots);
  const marks = annotationPoints(intervals, rows);

  if (rows.length < 2) {
    return <Empty>Two snapshots are needed before there is a line to draw. Give the poller a few minutes.</Empty>;
  }

  return (
    <div className="h-80 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="chaosFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#e0a458" stopOpacity={0.35} />
              <stop offset="100%" stopColor="#e0a458" stopOpacity={0.02} />
            </linearGradient>
          </defs>

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
          <YAxis
            yAxisId="chaos"
            tickFormatter={formatChaos}
            {...AXIS}
            tickLine={false}
            axisLine={false}
            width={56}
          />
          <YAxis
            yAxisId="divine"
            orientation="right"
            tickFormatter={(value: number) => formatChaos(value)}
            {...AXIS}
            tickLine={false}
            axisLine={false}
            width={48}
            domain={['auto', 'auto']}
          />

          <Tooltip
            cursor={{ stroke: '#333c49' }}
            content={({ active, payload }) => {
              const row = payload?.[0]?.payload as ReturnType<typeof netWorthRows>[number] | undefined;
              if (!active || !row) return null;
              return (
                <TooltipCard
                  title={formatDateTime(row.takenAt)}
                  rows={[
                    ['Chaos', formatChaos(row.chaos), 'text-accent-500'],
                    ['Divine', formatDivine(row.divine), 'text-cool-500'],
                    ['Divine rate', `${formatChaos(row.divineRate)}c`, 'text-cool-500'],
                    ['Items', String(row.itemCount)],
                  ]}
                />
              );
            }}
          />

          <Area
            yAxisId="chaos"
            type="monotone"
            dataKey="chaos"
            stroke="#e0a458"
            strokeWidth={1.75}
            fill="url(#chaosFill)"
            isAnimationActive={false}
            dot={false}
          />
          <Line
            yAxisId="divine"
            type="monotone"
            dataKey="divineRate"
            stroke="#7aa2f7"
            strokeWidth={1}
            strokeDasharray="4 3"
            dot={false}
            isAnimationActive={false}
          />

          {marks.map((mark) => (
            <ReferenceDot
              key={mark.at}
              yAxisId="chaos"
              x={mark.t}
              y={mark.chaos}
              r={4}
              fill={mark.deltaChaos >= 0 ? '#e0a458' : '#6b7787'}
              stroke="#0f1216"
              strokeWidth={1.5}
              isFront
            />
          ))}
        </ComposedChart>
      </ResponsiveContainer>

      {marks.length > 0 ? (
        <p className="mt-2 text-xs text-ink-400">
          {marks.length} marked {marks.length === 1 ? 'interval' : 'intervals'} moved more than 3× the
          trailing median
          {marks.length <= 4
            ? `: ${marks.map((mark) => `${formatSignedChaos(mark.deltaChaos)} at ${formatDateTime(mark.at)}`).join(', ')}`
            : '.'}
        </p>
      ) : null}
    </div>
  );
}
