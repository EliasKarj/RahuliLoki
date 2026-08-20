/**
 * The economy tab: what everything is worth, whether or not you own it.
 *
 * The dashboard answers "what do I have". This answers the question that comes up twenty times
 * a league about something you do not have yet — is this worth picking up, is that a fair
 * price, what did this drift to. The prices are the same set the valuation already uses, so
 * opening this tab costs one local request and nothing leaves the machine.
 *
 * The whole list arrives at once and the search runs in the browser, which is what makes it
 * filter as you type rather than after you type.
 */

import { useEffect, useMemo, useState } from 'react';
import { api, type EconomyResponse, type EconomyRow } from '../lib/api.ts';
import { usePrices } from '../lib/denomination.tsx';
import { formatAgo } from '../lib/format.ts';
import { Empty } from './ui.tsx';
import { ItemIcon } from './ItemIcon.tsx';

type SortKey = 'name' | 'chaos';

/**
 * Case- and punctuation-insensitive, over the name, the id and the category.
 *
 * The id is searchable on purpose: somebody who knows an item as `gcp` should not have to guess
 * that this app writes it out as "Gemcutter's Prism".
 */
export function matches(row: EconomyRow, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === '') return true;
  const haystack = `${row.name} ${row.id} ${row.category ?? ''}`.toLowerCase();
  return (
    haystack.includes(needle) ||
    haystack.replace(/[^a-z0-9 ]/g, '').includes(needle.replace(/[^a-z0-9 ]/g, ''))
  );
}

/** Each category present, largest first, so the chips read as a shape and not a list. */
export function categories(rows: EconomyRow[]): string[] {
  const totals = new Map<string, number>();
  for (const row of rows) {
    if (row.category === null) continue;
    totals.set(row.category, (totals.get(row.category) ?? 0) + 1);
  }
  return [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
}

export function Economy({ league }: { league: string | undefined }) {
  const [data, setData] = useState<EconomyResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'chaos', desc: true });
  const prices = usePrices();

  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setError(null);
    api
      .economy(league, controller.signal)
      .then((response) => {
        if (!controller.signal.aborted) setData(response);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => controller.abort();
  }, [league]);

  const all = data?.rows ?? [];
  const chips = useMemo(() => categories(all), [all]);

  const rows = useMemo(() => {
    const filtered = all.filter(
      (row) => matches(row, query) && (category === null || row.category === category),
    );
    const sign = sort.desc ? -1 : 1;
    return [...filtered].sort((a, b) =>
      sort.key === 'name' ? sign * a.name.localeCompare(b.name) : sign * (a.chaos - b.chaos),
    );
  }, [all, query, category, sort]);

  if (error !== null) {
    return (
      <p className="rounded border border-accent-600/50 bg-accent-600/10 px-3 py-2 text-xs text-accent-400">
        {error}
      </p>
    );
  }
  if (data === null) return <Empty>Loading prices…</Empty>;
  if (data.fetchedAt === null) {
    return (
      <Empty>
        No prices yet. They arrive with the first poll — press <strong>poll now</strong> on the
        dashboard, or wait for the next scheduled one.
      </Empty>
    );
  }

  const toggle = (key: SortKey) =>
    setSort((current) =>
      current.key === key ? { key, desc: !current.desc } : { key, desc: key === 'chaos' },
    );

  const arrow = (key: SortKey) => (sort.key === key ? (sort.desc ? ' ↓' : ' ↑') : '');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search every priced item…"
          aria-label="Search prices"
          autoFocus
          className="w-80 rounded border border-ink-700 bg-ink-950 px-2.5 py-1.5 text-sm text-ink-100 outline-none placeholder:text-ink-500 focus:border-accent-600"
        />
        <span className="text-xs text-ink-400">
          {rows.length === data.count ? `${data.count} items` : `${rows.length} of ${data.count} items`}
        </span>
        <span className="text-xs text-ink-500">
          prices {formatAgo(data.fetchedAt)}
          {data.stale ? ' (stale)' : ''}
        </span>
      </div>

      {chips.length > 1 ? (
        <div className="flex flex-wrap gap-1.5">
          <Chip active={category === null} onClick={() => setCategory(null)}>
            All
          </Chip>
          {chips.map((name) => (
            <Chip
              key={name}
              active={category === name}
              onClick={() => setCategory(category === name ? null : name)}
            >
              {name.replace(/([a-z])([A-Z])/g, '$1 $2')}
            </Chip>
          ))}
        </div>
      ) : null}

      <div className="max-h-[min(70vh,56rem)] max-w-6xl overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-ink-900">
            <tr className="border-b border-ink-800 text-xs font-normal text-ink-400">
              <th scope="col" className="py-2 text-left font-medium">
                <button type="button" onClick={() => toggle('name')} className="transition-colors hover:text-ink-200">
                  Item{arrow('name')}
                </button>
              </th>
              <th scope="col" className="py-2 text-left font-medium">Category</th>
              <th scope="col" className="py-2 text-right font-medium">
                <button type="button" onClick={() => toggle('chaos')} className="transition-colors hover:text-ink-200">
                  Value{arrow('chaos')}
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-ink-850 last:border-0">
                <td className="py-2 pr-3 text-ink-100">
                  <span className="flex items-center gap-2">
                    <ItemIcon src={row.icon ?? undefined} />
                    {row.name}
                    {/* A slug lost its punctuation on the way here, so the row says so instead
                        of presenting a reconstruction as the item's real name. */}
                    {row.nameSource === 'slug' ? (
                      <span
                        className="text-[0.65rem] text-ink-600"
                        title={`poe.ninja calls this "${row.id}" and gives no name for it; this reading is from the id`}
                      >
                        ?
                      </span>
                    ) : null}
                  </span>
                </td>
                <td className="py-2 pr-3 text-ink-500">
                  {row.category === null ? '—' : row.category.replace(/([a-z])([A-Z])/g, '$1 $2')}
                </td>
                <td className="num py-2 text-accent-500">{prices.price(row.chaos)}</td>
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
