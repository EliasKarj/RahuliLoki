/**
 * One holding's life over the selected range, opened by clicking its name anywhere it appears.
 *
 * Two axes, because the two questions are different. The area is what the pile is worth; the
 * line is what one of them costs. When the area rises and the line is flat you accumulated;
 * when the line rises and the area follows with a flat quantity, the market did it for you.
 *
 * Fetched on demand rather than with the dashboard: it is the one endpoint that reads every
 * breakdown in the range, and nobody needs it until they ask a question about a specific item.
 *
 * Not to be confused with PriceHistory, which the Economy tab opens. That one is about the
 * market — what an item costs, held or not, out of the stored price sets. This one is about
 * *your* pile of it: how many you had and what they were worth, out of your own snapshots. The
 * two answer different questions and read different data.
 */

import { useEffect, useState } from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api, type ItemHistoryResponse, type RangeQuery } from '../lib/api.ts';
import { formatCount, formatDateTime, formatDay, formatInUnit, formatTime } from '../lib/format.ts';
import { usePrices } from '../lib/denomination.tsx';
import { Empty, TooltipCard } from './ui.tsx';
import { ItemIcon } from './ItemIcon.tsx';
import { AXIS, PALETTE } from '../lib/palette.ts';

export function ItemHistory({
  name,
  range,
  wide,
  onClose,
}: {
  name: string;
  range: RangeQuery;
  wide: boolean;
  onClose: () => void;
}) {
  const [data, setData] = useState<ItemHistoryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setError(null);

    api
      .itemHistory(name, range, controller.signal)
      .then((response) => {
        if (!controller.signal.aborted) setData(response);
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return;
        setError(caught instanceof Error ? caught.message : String(caught));
      });

    return () => controller.abort();
    // `range` is rebuilt each render by the parent; its two string fields are the real inputs.
  }, [name, range.league, range.from]);

  const prices = usePrices();
  const rows = (data?.points ?? []).map((point) => ({
    t: Date.parse(point.takenAt),
    takenAt: point.takenAt,
    qty: point.qty,
    chaosEach: point.chaosEach,
    chaosTotal: point.chaosTotal,
  }));

  // Two axes, two units, each from its own peak: a stack worth thousands and a unit price of a
  // few chaos do not belong in the same denomination.
  const totalUnit = prices.axis(rows.map((row) => row.chaosTotal));
  const eachUnit = prices.axis(rows.map((row) => row.chaosEach));

  return (
    <div className="rounded border border-ink-800 bg-ink-900/40 p-4">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="flex items-center gap-2 text-sm font-medium text-ink-100">
          <ItemIcon src={data?.icon} size={6} />
          {name}
        </h3>
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-ink-400 transition-colors hover:text-ink-200"
        >
          Close
        </button>
      </div>

      {error ? (
        <p className="rounded border border-accent-600/50 bg-accent-600/10 px-3 py-2 text-xs text-accent-400">
          {error}
        </p>
      ) : data === null ? (
        <Empty>Loading…</Empty>
      ) : rows.length < 2 ? (
        <Empty>Not enough snapshots in this range to draw a history for {name}.</Empty>
      ) : (
        <div className="h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid stroke={PALETTE.grid} vertical={false} />
              <XAxis
                dataKey="t"
                type="number"
                scale="time"
                domain={['dataMin', 'dataMax']}
                tickFormatter={(value: number) =>
                  wide
                    ? formatDay(new Date(value).toISOString())
                    : formatTime(new Date(value).toISOString())
                }
                {...AXIS}
                tickLine={false}
                minTickGap={48}
              />
              <YAxis
                yAxisId="total"
                tickFormatter={(value: number) => formatInUnit(value, totalUnit)}
                {...AXIS}
                tickLine={false}
                axisLine={false}
                width={56}
              />
              <YAxis
                yAxisId="each"
                orientation="right"
                tickFormatter={(value: number) => formatInUnit(value, eachUnit)}
                {...AXIS}
                tickLine={false}
                axisLine={false}
                width={48}
              />

              <Tooltip
                cursor={{ stroke: PALETTE.edge }}
                content={({ active, payload }) => {
                  const row = payload?.[0]?.payload as (typeof rows)[number] | undefined;
                  if (!active || !row) return null;
                  return (
                    <TooltipCard
                      title={formatDateTime(row.takenAt)}
                      rows={[
                        ['Held', formatCount(row.qty), 'text-ink-200'],
                        ['Each', prices.price(row.chaosEach), 'text-cool-500'],
                        ['Total', prices.price(row.chaosTotal), 'text-accent-500'],
                      ]}
                    />
                  );
                }}
              />

              <Area
                yAxisId="total"
                type="monotone"
                dataKey="chaosTotal"
                stroke={PALETTE.gold}
                strokeWidth={1.5}
                fill={PALETTE.gold}
                fillOpacity={0.18}
                isAnimationActive={false}
              />
              <Line
                yAxisId="each"
                type="monotone"
                dataKey="chaosEach"
                stroke={PALETTE.violet}
                strokeWidth={1}
                dot={false}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      <p className="mt-2 text-xs text-ink-500">
        Area is what the pile is worth; the thin line is the unit price. A rising area over a flat
        line is you; a rising line under a flat quantity is the market.
      </p>
    </div>
  );
}
