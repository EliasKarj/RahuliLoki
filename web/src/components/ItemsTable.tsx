/**
 * The largest holdings in the newest snapshot, as a table.
 *
 * The snapshot's breakdown is per tab, so the same currency in three tabs arrives as three rows.
 * To a player that is one pile — the split is an accident of storage, not a fact about their
 * wealth — so the rows are folded together and the tabs become a column. That folding, and the
 * sorting and searching over it, live in lib/items.ts; what is left here is the rendering.
 */

import { useMemo, useState } from 'react';
import type { TopItem } from '../lib/api.ts';
import type { SortDirection } from '../lib/series.ts';
import {
  categoryLabel,
  categoryTotals,
  groupByItem,
  matchesQuery,
  sortItemRows,
  type SortKey,
} from '../lib/items.ts';
import { formatCount } from '../lib/format.ts';
import { usePrices } from '../lib/denomination.tsx';
import { Empty } from './ui.tsx';
import { ItemIcon } from './ItemIcon.tsx';

type Column = { key: SortKey; label: string; numeric: boolean };

const COLUMNS: Column[] = [
  { key: 'name', label: 'Item', numeric: false },
  { key: 'tabs', label: 'Tabs', numeric: false },
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

  // There used to be a cumulative column here: a running total down the rows, shown only under
  // the default sort because under any other one it adds up to nothing. It was a sixth column
  // carrying a number nobody had asked for — the last row of it is the net worth, which is
  // already the largest thing on the page, and every row above it is answered better by the
  // bar behind the row.
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
        {/* How many rows, and nothing else. This line used to end with the total as well, which
            is the same figure as the hero four rems above it and as the All chip beside it. */}
        <span className="text-xs text-ink-400">
          {rows.length === grouped.length
            ? `${grouped.length} items`
            : `${rows.length} of ${grouped.length} items`}
        </span>
      </div>

      {/* Each category with what it is worth. The total is the point: "Scarab" alone is a
          filter, "Scarab 3.2kc" answers the question that made someone reach for it.
          All carries no figure, because the total of everything is the hero.

          Below two categories there is nothing to filter between — "All" and the single
          category select the same rows and print the same number — so the row is not drawn at
          all rather than drawn inert. It is drawn regardless while a category is selected: a
          search that narrows the categories to one must not take away the control holding the
          filter that is still on. */}
      {totals.length > 1 || category !== null ? (
      <div className="mb-3 flex flex-wrap gap-1.5">
        <Chip active={category === null} onClick={() => setCategory(null)}>
          All
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
      ) : null}

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
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
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
