/**
 * The uniques in your stash, as the disenchanting bench sees them.
 *
 * Dust from an item depends on the item, not on its name: its level and its quality. That is
 * why this view exists separately from the dashboard's item table, which folds every copy of a
 * unique into one line because that is the right shape for a wealth chart and the wrong one for
 * deciding what to feed the bench.
 *
 * ## Why there is no dust column yet
 *
 * There is no verified source for the dust numbers. They scale with item level and quality —
 * that much is not in doubt — but this project has not confirmed the actual figures against
 * anything, and a decision tool full of half-remembered constants is worse than one that admits
 * what it does not know. Everything a formula needs is here and named; the column arrives with
 * a source.
 */

import { useEffect, useMemo, useState } from 'react';
import { api, type UniqueRow, type UniquesResponse } from '../lib/api.ts';
import { usePrices } from '../lib/denomination.tsx';
import { formatAgo, formatCount } from '../lib/format.ts';
import { looseIncludes } from '../lib/search.ts';
import { Empty } from './ui.tsx';
import { ItemIcon } from './ItemIcon.tsx';

type SortKey = 'name' | 'count' | 'ilvl' | 'quality' | 'chaos' | 'dust' | 'dustPerChaos';

export function matchesUnique(row: UniqueRow, query: string): boolean {
  return looseIncludes(`${row.name} ${row.baseType} ${row.tab}`, query);
}

export function Kingsmarch({ league }: { league: string | undefined }) {
  const [data, setData] = useState<UniquesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'dust', desc: true });
  const prices = usePrices();

  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setError(null);
    api
      .uniques(league, controller.signal)
      .then((response) => {
        if (!controller.signal.aborted) setData(response);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => controller.abort();
  }, [league]);

  const all = data?.rows ?? [];

  const rows = useMemo(() => {
    const filtered = all.filter((row) => matchesUnique(row, query));
    const sign = sort.desc ? -1 : 1;
    return [...filtered].sort((a, b) => {
      if (sort.key === 'name') return sign * a.name.localeCompare(b.name);
      const left = a[sort.key];
      const right = b[sort.key];
      // A row with nothing to sort by goes to the far end whichever way the column points,
      // rather than mixing in among the rows that do have a value.
      if (left === null && right === null) return 0;
      if (left === null) return 1;
      if (right === null) return -1;
      return sign * (left - right);
    });
  }, [all, query, sort]);

  if (error !== null) {
    return (
      <p className="rounded border border-accent-600/50 bg-accent-600/10 px-3 py-2 text-xs text-accent-400">
        {error}
      </p>
    );
  }
  if (data === null) return <Empty>Reading the stash…</Empty>;
  if (data.capturedAt === null) {
    return (
      <Empty>
        Nothing read yet. The uniques are recorded by a poll, so this fills in after the next one
        — or press <strong>poll now</strong> on the dashboard.
      </Empty>
    );
  }
  if (all.length === 0) {
    return <Empty>The last poll found no identified uniques in the tracked tabs.</Empty>;
  }

  /**
   * Whether anything here has a price at all.
   *
   * poe.ninja serves no unique prices — every unique type answers with zero lines, recorded by
   * scripts/probe.mjs — so in practice this is false and the column is not drawn. It is a
   * condition rather than a deletion because the column becomes right again the day those
   * endpoints have something in them, and an always-empty column is exactly the clutter this
   * page has been cleared of twice.
   */
  const anyPriced = all.some((row) => row.chaos !== null);
  /** False only if the dust table knows none of these — a stash of brand new uniques. */
  const anyDust = all.some((row) => row.dust !== null);

  const toggle = (key: SortKey) =>
    setSort((current) =>
      current.key === key ? { key, desc: !current.desc } : { key, desc: key !== 'name' },
    );
  const arrow = (key: SortKey) => (sort.key === key ? (sort.desc ? ' ↓' : ' ↑') : '');
  const total = rows.reduce((sum, row) => sum + row.count, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search uniques, bases or tabs…"
          aria-label="Search uniques"
          className="w-80 rounded border border-ink-700 bg-ink-950 px-2.5 py-1.5 text-sm text-ink-100 outline-none placeholder:text-ink-500 focus:border-accent-600"
        />
        <span className="text-xs text-ink-400">
          {formatCount(total)} {total === 1 ? 'item' : 'items'} in {rows.length}{' '}
          {rows.length === 1 ? 'row' : 'rows'}
        </span>
        <span className="text-xs text-ink-500">read {formatAgo(data.capturedAt)}</span>
      </div>

      {/* Stated once, at the top, rather than as a footnote nobody reads. The dust column is the
          point of this view and it is missing; saying why is the least it can do. */}
      <p className="max-w-3xl rounded border border-ink-800 bg-ink-900/40 px-3 py-2 text-xs text-ink-400">
        Dust is for <strong className="font-medium text-ink-300">one</strong> of the item, at its
        own level and quality. Item level dominates it: the same unique at level 65 yields a
        twentieth of what it does at 84, and below 65 it stops falling.{' '}
        <span className="text-ink-500">
          A ≥ means the figure is a floor — a corrupted item may carry implicits the stash payload
          does not list, and each is worth half again.
        </span>{' '}
        There is no dust-per-chaos yet because poe.ninja's exchange endpoint serves no unique
        prices at all.
      </p>

      <div className="max-h-[min(70vh,56rem)] max-w-6xl overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-ink-900">
            <tr className="border-b border-ink-800 text-xs font-normal text-ink-400">
              <th scope="col" className="py-2 text-left font-medium">
                <button type="button" onClick={() => toggle('name')} className="transition-colors hover:text-ink-200">
                  Item{arrow('name')}
                </button>
              </th>
              <th scope="col" className="py-2 text-left font-medium">Tab</th>
              <th scope="col" className="py-2 text-right font-medium">
                <button type="button" onClick={() => toggle('count')} className="transition-colors hover:text-ink-200">
                  Qty{arrow('count')}
                </button>
              </th>
              <th scope="col" className="py-2 text-right font-medium">
                <button type="button" onClick={() => toggle('ilvl')} className="transition-colors hover:text-ink-200">
                  ilvl{arrow('ilvl')}
                </button>
              </th>
              <th scope="col" className="py-2 text-right font-medium">
                <button type="button" onClick={() => toggle('quality')} className="transition-colors hover:text-ink-200">
                  Quality{arrow('quality')}
                </button>
              </th>
              {anyDust ? (
                <th scope="col" className="py-2 text-right font-medium">
                  <button type="button" onClick={() => toggle('dust')} className="transition-colors hover:text-ink-200">
                    Dust{arrow('dust')}
                  </button>
                </th>
              ) : null}
              {anyPriced ? (
                <th scope="col" className="py-2 text-right font-medium">
                  <button type="button" onClick={() => toggle('chaos')} className="transition-colors hover:text-ink-200">
                    Each{arrow('chaos')}
                  </button>
                </th>
              ) : null}
              {anyPriced ? (
                <th scope="col" className="py-2 text-right font-medium">
                  <button type="button" onClick={() => toggle('dustPerChaos')} className="transition-colors hover:text-ink-200">
                    Dust/chaos{arrow('dustPerChaos')}
                  </button>
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={`${row.name}|${row.tab}|${row.ilvl ?? ''}|${row.quality}|${row.corrupted}`}
                className="border-b border-ink-850 last:border-0"
              >
                <td className="py-2 pr-3 text-ink-100">
                  <span className="flex items-center gap-2">
                    <ItemIcon src={row.icon ?? undefined} />
                    <span>
                      {row.name}
                      {row.baseType === '' ? null : (
                        <span className="ml-2 text-xs text-ink-500">{row.baseType}</span>
                      )}
                    </span>
                    {row.corrupted ? (
                      <span className="text-[0.65rem] text-cool-400" title="Corrupted">
                        corrupted
                      </span>
                    ) : null}
                  </span>
                </td>
                <td className="py-2 pr-3 text-ink-500">{row.tab}</td>
                <td className="num py-2 pr-3 text-ink-200">{formatCount(row.count)}</td>
                {/* An item level GGG did not send is a dash, not a zero: zero is a real level. */}
                <td className="num py-2 pr-3 text-ink-400">{row.ilvl === null ? '—' : row.ilvl}</td>
                <td className="num py-2 pr-3 text-ink-400">
                  {row.quality === 0 ? '' : `${row.quality}%`}
                </td>
                {anyDust ? (
                  <td
                    className="num py-2 pr-3 text-accent-500"
                    title={
                      row.goldCost === null
                        ? undefined
                        : `${formatCount(row.goldCost)} gold to disenchant, ${row.slots ?? '?'} slots`
                    }
                  >
                    {row.dust === null ? '' : `${row.dustAtLeast ? '≥' : ''}${formatCount(row.dust)}`}
                  </td>
                ) : null}
                {anyPriced ? (
                  <td className="num py-2 pr-3 text-ink-200">
                    {row.chaos === null ? '' : prices.price(row.chaos)}
                  </td>
                ) : null}
                {anyPriced ? (
                  <td className="num py-2 text-accent-500">
                    {row.dustPerChaos === null ? '' : formatCount(Math.round(row.dustPerChaos))}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 ? (
          <p className="py-6 text-center text-xs text-ink-400">Nothing matches “{query}”.</p>
        ) : null}
      </div>
    </div>
  );
}
