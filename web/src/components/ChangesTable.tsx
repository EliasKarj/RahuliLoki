/**
 * What moved between the ends of the selected range.
 *
 * The other four views answer "how much". This one answers "from what" — the question you
 * actually have after seeing the line go up. Gains and losses are shown side by side rather
 * than netted, because "+4000 and -1000" and "+3000" describe very different afternoons.
 *
 * The `reason` column is the part worth reading twice. A holding whose quantity never changed
 * but whose value rose is the market moving, not you earning, and a wealth tracker that cannot
 * separate the two is quietly taking credit for a divine price spike.
 */

import { useState } from 'react';
import type { ItemChange } from '../lib/api.ts';
import { formatCount } from '../lib/format.ts';
import { usePrices } from '../lib/denomination.tsx';
import { Empty } from './ui.tsx';
import { ItemIcon } from './ItemIcon.tsx';

type Filter = 'all' | 'gains' | 'losses';

const REASON_LABEL: Record<ItemChange['reason'], string> = {
  quantity: 'held',
  price: 'price',
  both: 'both',
};

const REASON_TITLE: Record<ItemChange['reason'], string> = {
  quantity: 'The amount you hold changed — you acquired or spent this.',
  price: 'Same amount, different market price. This gain is not yours.',
  both: 'The amount and the unit price both moved.',
};

/**
 * The one difference this table cannot explain by itself.
 *
 * Uniques were not counted in any total until poe.ninja's item endpoint turned out to price
 * them. The poll after that shows every unique already sitting in the stash arriving at once,
 * as ordinary gains, indistinguishable from a good afternoon. Nothing in the numbers can say
 * which it was, so it is said here.
 */
function UniquesArrived() {
  return (
    <p className="rounded border border-cool-500/40 bg-cool-500/10 px-3 py-2 text-xs text-cool-300">
      Uniques started being counted during this range. Every unique you already owned shows up
      here as if it arrived, and the gain for the range includes all of it — that part is the app
      learning to see them, not you earning them.
    </p>
  );
}

export function ChangesTable({
  changes,
  emptyReason,
  uniquesArrived = false,
  onSelect,
}: {
  changes: ItemChange[];
  emptyReason?: string | undefined;
  /** See UniquesArrived: the range straddles the moment uniques entered the total. */
  uniquesArrived?: boolean;
  onSelect?: (name: string) => void;
}) {
  const prices = usePrices();
  const [filter, setFilter] = useState<Filter>('all');

  if (changes.length === 0) {
    return (
      <div className="space-y-3">
        {uniquesArrived ? <UniquesArrived /> : null}
        <Empty>{emptyReason ?? 'Nothing moved by more than a chaos over this range.'}</Empty>
      </div>
    );
  }

  const rows = changes
    .filter((row) =>
      filter === 'all' ? true : filter === 'gains' ? row.chaosDelta > 0 : row.chaosDelta < 0,
    )
    .slice(0, 50);

  return (
    <div>
      {uniquesArrived ? (
        <div className="mb-3">
          <UniquesArrived />
        </div>
      ) : null}
      <div className="mb-3 flex gap-1 text-xs">
        {(['all', 'gains', 'losses'] as const).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            className={`rounded px-2 py-1 transition-colors ${
              filter === key ? 'bg-ink-800 text-ink-100' : 'text-ink-400 hover:text-ink-200'
            }`}
          >
            {key === 'all' ? 'All' : key === 'gains' ? 'Gained' : 'Lost'}
          </button>
        ))}
      </div>

      {/* Capped like the snapshot table, and for the same reason — see SnapshotTable.tsx. */}
      <div className="max-w-6xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-ink-800 text-xs font-normal text-ink-400">
              <th scope="col" className="py-2 text-left font-medium">Item</th>
              <th scope="col" className="py-2 text-right font-medium">Held</th>
              <th scope="col" className="py-2 text-right font-medium">Each</th>
              <th scope="col" className="py-2 text-right font-medium">Why</th>
              <th scope="col" className="py-2 text-right font-medium">Change</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.name} className="border-b border-ink-850 last:border-0">
                <td className="py-2 pr-3 text-ink-100">
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
                <td className="num py-2 pr-3 text-ink-200">
                  {row.qtyDelta === 0 ? (
                    <span className="text-ink-500">{formatCount(row.qtyAfter)}</span>
                  ) : (
                    <>
                      {formatCount(row.qtyBefore)} <span className="text-ink-600">→</span>{' '}
                      {formatCount(row.qtyAfter)}
                    </>
                  )}
                </td>
                <td className="num py-2 pr-3 text-ink-400">
                  {row.chaosEachBefore === row.chaosEachAfter
                    ? prices.price(row.chaosEachAfter)
                    : `${prices.price(row.chaosEachBefore)} → ${prices.price(row.chaosEachAfter)}`}
                </td>
                <td className="py-2 pr-3 text-right">
                  <span
                    title={REASON_TITLE[row.reason]}
                    className={`rounded px-1.5 py-0.5 text-xs ${
                      row.reason === 'price' ? 'bg-ink-800 text-ink-400' : 'text-ink-500'
                    }`}
                  >
                    {REASON_LABEL[row.reason]}
                  </span>
                </td>
                <td
                  className={`num py-2 text-right ${
                    row.chaosDelta > 0 ? 'text-accent-500' : 'text-cool-400'
                  }`}
                >
                  {prices.signed(row.chaosDelta)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
