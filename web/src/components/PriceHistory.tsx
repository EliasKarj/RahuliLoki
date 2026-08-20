/**
 * One item's price over time, out of the price sets this app has kept.
 *
 * Deliberately not poe.ninja's sparkline, which is a percentage series over a window it picks.
 * This is what the thing actually cost, at every hour the app has been running, in the unit the
 * rest of the page quotes. It goes back as far as `PRICE_SET_RETENTION` — two days by default,
 * and as far as you care to keep if you raise it.
 *
 * A history this short is worth saying out loud rather than implying with an axis, so the panel
 * says how much of it there is.
 *
 * Not to be confused with ItemHistory, which the dashboard opens. That one is about your own
 * pile — how many you held and what they were worth, out of your snapshots. This one is about
 * the market, and does not care whether you own any.
 */

import { useEffect, useState } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, type PricePoint } from '../lib/api.ts';
import { usePrices } from '../lib/denomination.tsx';
import { formatChaos, formatDateTime, formatInUnit, formatPrice, formatTime } from '../lib/format.ts';
import { AXIS, PALETTE } from '../lib/palette.ts';
import { Empty, TooltipCard } from './ui.tsx';

export function PriceHistory({
  id,
  name,
  league,
  onClose,
}: {
  id: string;
  name: string;
  league: string | undefined;
  onClose: () => void;
}) {
  const [points, setPoints] = useState<PricePoint[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const prices = usePrices();

  useEffect(() => {
    const controller = new AbortController();
    setPoints(null);
    setError(null);
    api
      .priceHistory(id, league, controller.signal)
      .then((response) => {
        if (!controller.signal.aborted) setPoints(response.points);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => controller.abort();
  }, [id, league]);

  // Each point keeps the divine rate of its own moment. Quoting a two-day-old price at today's
  // rate would be a conversion the data does not support — the endpoint ships the rate per point
  // for exactly this reason, and reading it back at the current one made that field decoration.
  const rows = (points ?? []).map((point) => ({
    t: Date.parse(point.at),
    chaos: point.chaos,
    divineRate: point.divineRate,
  }));
  const unit = prices.axis(rows.map((row) => row.chaos));

  return (
    <section className="rounded border border-ink-800 bg-ink-900/40 p-4">
      <header className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-medium text-ink-100">{name}</h3>
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-ink-400 transition-colors hover:text-ink-200"
        >
          Close
        </button>
      </header>

      {error !== null ? (
        <p className="text-xs text-accent-400">{error}</p>
      ) : points === null ? (
        <Empty>Loading…</Empty>
      ) : rows.length < 2 ? (
        <Empty>
          Not enough history yet. A point is kept per price fetch, so this fills in over the next
          few hours.
        </Empty>
      ) : (
        <>
          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid stroke={PALETTE.grid} vertical={false} />
                <XAxis
                  dataKey="t"
                  type="number"
                  scale="time"
                  domain={['dataMin', 'dataMax']}
                  tickFormatter={(value: number) => formatTime(new Date(value).toISOString())}
                  {...AXIS}
                  tickLine={false}
                  minTickGap={48}
                />
                <YAxis
                  tickFormatter={(value: number) => formatInUnit(value, unit)}
                  {...AXIS}
                  tickLine={false}
                  axisLine={false}
                  width={56}
                  domain={['auto', 'auto']}
                />
                <Tooltip
                  cursor={{ stroke: PALETTE.edge }}
                  content={({ active, payload }) => {
                    const row = payload?.[0]?.payload as
                      | { t: number; chaos: number; divineRate: number }
                      | undefined;
                    if (!active || !row) return null;
                    return (
                      <TooltipCard
                        title={formatDateTime(new Date(row.t).toISOString())}
                        rows={[
                          ['price', formatPrice(row.chaos, row.divineRate), 'text-accent-500'],
                          ['divine rate', `${formatChaos(row.divineRate)}c`, 'text-cool-400'],
                        ]}
                      />
                    );
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="chaos"
                  stroke={PALETTE.gold}
                  strokeWidth={1.5}
                  fill={PALETTE.gold}
                  fillOpacity={0.12}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-2 text-xs text-ink-500">
            {rows.length} price {rows.length === 1 ? 'fetch' : 'fetches'} kept — this app's own
            record, not poe.ninja's.
          </p>
        </>
      )}
    </section>
  );
}
