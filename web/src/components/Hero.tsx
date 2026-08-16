/**
 * The number this app exists to show, and its shape over the range.
 *
 * It replaces four equal-sized stat cards. Those gave net worth, gain, and two rates the same
 * visual weight, which is not how anyone reads them: one is the figure you opened the app for
 * and the rest are context on it. Four identical boxes flatten that into a grid and make the
 * eye hunt for the one that matters.
 *
 * So: one dominant figure, the series drawn full-bleed behind it, and the supporting numbers as
 * a plain row underneath divided by hairlines. No boxes at all — a border around a number adds
 * nothing except a border.
 */

import { useMemo } from 'react';
import type { SnapshotWithTabs, StatsResponse } from '../lib/api.ts';
import { sparklinePath } from '../lib/spark.ts';
import {
  formatChaos,
  formatDivine,
  formatHours,
  formatRate,
  formatSignedChaos,
} from '../lib/format.ts';

const WIDTH = 1200;
const HEIGHT = 96;

export function Hero({
  snapshots,
  stats,
}: {
  snapshots: SnapshotWithTabs[];
  stats: StatsResponse | null;
}) {
  const spark = useMemo(
    () => sparklinePath(snapshots.map((snapshot) => snapshot.totalChaos), WIDTH, HEIGHT),
    [snapshots],
  );

  const gain = stats?.totalGainChaos ?? 0;

  return (
    <section className="border-b border-ink-800 pb-5">
      {/* The sparkline is confined to the block holding the figure, never the one holding the
          supporting numbers. Bleeding it across both put a stroke straight through a row of
          small labels — context for a number is worth nothing if it costs the number's
          neighbours their legibility. */}
      <div className="relative min-h-[7rem] overflow-hidden">
      <svg
        className="pointer-events-none absolute inset-x-0 bottom-0 h-20 w-full"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="heroFade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-accent-500)" stopOpacity="0.20" />
            <stop offset="100%" stopColor="var(--color-accent-500)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {spark.area ? <path d={spark.area} fill="url(#heroFade)" /> : null}
        {spark.line ? (
          <path
            d={spark.line}
            fill="none"
            stroke="var(--color-accent-500)"
            strokeOpacity="0.55"
            strokeWidth="1.5"
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
      </svg>

      <div className="relative">
        <p className="text-[0.65rem] uppercase tracking-[0.2em] text-ink-400">Net worth</p>
        <p className="num mt-1 !text-left text-5xl font-medium leading-none text-ink-100 tabular-nums">
          {formatChaos(stats?.currentChaos ?? 0)}
          <span className="ml-1 text-2xl text-ink-400">c</span>
        </p>
        <p className="mt-1.5 text-xs text-ink-400">
          <span className="text-cool-500">{formatDivine(stats?.currentDivine ?? 0)} divine</span>
          {' at '}
          {formatChaos(stats?.divineRate ?? 0)}c
        </p>
      </div>
      </div>

      <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-3 text-xs">
        <Figure
          label="Gain in range"
          value={`${formatSignedChaos(gain)}c`}
          tone={gain === 0 ? 'flat' : gain > 0 ? 'up' : 'down'}
        />
        <Figure label="c/h active" value={formatRate(stats?.chaosPerHourActive ?? 0)} />
        <Figure label="c/h wall-clock" value={formatRate(stats?.chaosPerHourWallClock ?? 0)} />
        <Figure
          label="Moving"
          value={`${formatHours(stats?.activeHours ?? 0)} of ${formatHours(stats?.wallClockHours ?? 0)}`}
        />
        <Figure
          label="Best hour"
          value={stats?.bestHour ? `${formatSignedChaos(stats.bestHour.gainChaos)}c` : '—'}
        />
      </dl>
    </section>
  );
}

/**
 * One supporting figure. Divided from its neighbour by a hairline rather than boxed.
 *
 * Direction is carried by the sign and by a single accent, never by red: a loss is already
 * unmistakable from the minus, and a red would introduce a colour that means nothing else
 * anywhere else in the app.
 */
function Figure({
  label,
  value,
  tone = 'flat',
}: {
  label: string;
  value: string;
  tone?: 'flat' | 'up' | 'down';
}) {
  return (
    <div className="border-l border-ink-800 pl-3 first:border-l-0 first:pl-0">
      <dt className="text-[0.65rem] uppercase tracking-[0.15em] text-ink-400">{label}</dt>
      <dd
        className={`num mt-0.5 !text-left text-base ${
          tone === 'up' ? 'text-accent-500' : tone === 'down' ? 'text-ink-200' : 'text-ink-100'
        }`}
      >
        {value}
      </dd>
    </div>
  );
}
