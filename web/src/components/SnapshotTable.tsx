/**
 * The raw snapshots behind the charts, newest first, with the change from the one before it.
 *
 * This is the table you read when a chart looks wrong, so it carries the divine rate at the
 * time and marks the intervals that moved unusually far — the two things that explain most
 * surprising-looking movements.
 *
 * ## Why there is one value column and not two
 *
 * There were two: "Chaos" and "Divine". Both printed the same holding, and the first of them
 * was denominated — so above one divine of net worth, which is where this app spends its life,
 * the column headed "Chaos" read `169.28 div` and the one headed "Divine" read `169.28`. Two
 * columns, one number, and a heading that named the wrong unit.
 *
 * Now there is one column, headed by what it is rather than by a unit, and every cell carries
 * its own unit the way every other price on the page does. The column of price ages went with
 * it: the age of the price set is in the status row at the top, where it is one fact rather
 * than twenty-five repetitions of nearly the same one.
 */

import type { SeriesInterval, SnapshotWithTabs } from '../lib/api.ts';
import { formatChaos, formatDateTime, formatCount } from '../lib/format.ts';
import { usePrices } from '../lib/denomination.tsx';
import { Empty } from './ui.tsx';

interface Props {
  snapshots: SnapshotWithTabs[];
  intervals: SeriesInterval[];
  limit?: number;
}

export function SnapshotTable({ snapshots, intervals, limit = 25 }: Props) {
  if (snapshots.length === 0) {
    return <Empty>No snapshots in this range.</Empty>;
  }

  const prices = usePrices();
  const byToId = new Map(intervals.map((interval) => [interval.toId, interval]));
  const rows = [...snapshots].reverse().slice(0, limit);

  // Capped, and left-aligned rather than stretched. A table of short cells pulled across a
  // full-screen window puts a timestamp at one edge and its value at the other, and reading a
  // row becomes a journey. The item table earns the full width because its first column holds
  // real names and a bar behind them; this one does not.
  return (
    <div className="max-w-6xl overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-ink-800 text-xs font-normal text-ink-400">
            <th scope="col" className="py-2 text-left font-medium">Taken</th>
            <th scope="col" className="py-2 text-right font-medium">Value</th>
            <th scope="col" className="py-2 text-right font-medium">Change</th>
            <th scope="col" className="py-2 text-right font-medium">Rate</th>
            <th scope="col" className="py-2 text-right font-medium">Items</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((snapshot) => {
            const interval = byToId.get(snapshot.id);
            const changeColour =
              interval === undefined
                ? 'text-ink-600'
                : interval.idle
                  ? 'text-ink-400'
                  : interval.deltaChaos >= 0
                    ? 'text-accent-500'
                    : 'text-ink-300';

            return (
              <tr key={snapshot.id} className="border-b border-ink-850 last:border-0">
                <td className="py-2 pr-3 text-ink-200">
                  {formatDateTime(snapshot.takenAt)}
                  {interval?.annotated ? (
                    <span className="ml-2 text-xs text-cool-500" title="More than 3× the trailing median">
                      spike
                    </span>
                  ) : null}
                </td>
                <td className="num py-2 pr-3 text-ink-100">{prices.price(snapshot.totalChaos)}</td>
                <td className={`num py-2 pr-3 ${changeColour}`}>
                  {interval === undefined ? '—' : prices.signed(interval.deltaChaos)}
                </td>
                {/* Chaos always. This column is the conversion itself; in divine it would
                    read 1.00 for every row and say nothing. */}
                <td className="num py-2 pr-3 text-ink-400">{formatChaos(snapshot.divineRate)}c</td>
                <td className="num py-2 text-ink-400">{formatCount(snapshot.itemCount)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {snapshots.length > rows.length ? (
        <p className="mt-2 text-xs text-ink-400">
          Showing the {rows.length} most recent of {snapshots.length} snapshots in this range.
        </p>
      ) : null}
    </div>
  );
}
