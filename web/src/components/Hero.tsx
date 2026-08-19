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
import type { HealthResponse, SnapshotWithTabs, StatsResponse } from '../lib/api.ts';
import { sparklinePath } from '../lib/spark.ts';
import { ItemIcon } from './ItemIcon.tsx';
import {
  denominate,
  formatChaos,
  formatDenominated,
  formatDivine,
  formatHours,
} from '../lib/format.ts';
import { usePrices } from '../lib/denomination.tsx';

const WIDTH = 1200;
const HEIGHT = 96;

export function Hero({
  snapshots,
  stats,
  orbs,
}: {
  snapshots: SnapshotWithTabs[];
  stats: StatsResponse | null;
  /** Carries the two orb icons. Null before the first price set, which is a fine state to be in. */
  orbs: HealthResponse['prices'] | null;
}) {
  const spark = useMemo(
    () => sparklinePath(snapshots.map((snapshot) => snapshot.totalChaos), WIDTH, HEIGHT),
    [snapshots],
  );

  const prices = usePrices();
  const gain = stats?.totalGainChaos ?? 0;

  // Quoted in the orb a player would say it in: divine past one divine, chaos below. The unit
  // decides which orb's art sits next to the figure, so the two can never disagree.
  const worth = denominate(stats?.currentChaos ?? 0, stats?.divineRate ?? 0);
  const icon = worth.unit === 'divine' ? orbs?.divineIcon : orbs?.chaosIcon;

  return (
    <section className="border-b border-ink-800 pb-8">
      {/* The sparkline is confined to the block holding the figure, never the one holding the
          supporting numbers. Bleeding it across both put a stroke straight through a row of
          small labels — context for a number is worth nothing if it costs the number's
          neighbours their legibility. */}
      <div className="relative min-h-[7rem] overflow-hidden xl:min-h-[8.5rem]">
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
        {/* Still "net worth" and not the app's own name: the label's job is to say what the
            figure is, and the wordmark three lines up already says what the app is. */}
        <p className="text-[0.65rem] uppercase tracking-[0.2em] text-ink-400">Net worth</p>
        <p className="mt-1 flex items-center gap-2">
          <span className="ember num !text-left text-5xl font-medium leading-none text-ink-100 tabular-nums xl:text-6xl">
            {formatDenominated(worth)}
          </span>
          {/* The orb itself rather than a letter. It is the unit players actually recognise, and
              it is already on screen a dozen times in the table below. */}
          <ItemIcon src={icon ?? undefined} size={6} />
          <span className="text-2xl text-ink-400">{worth.unit === 'divine' ? 'div' : 'c'}</span>
        </p>
        <p className="mt-1.5 text-xs text-ink-400">
          {/* The other denomination, always. Switching units is only safe if nothing is lost by
              it, and someone comparing against a trade site needs the chaos figure regardless. */}
          <span className={worth.unit === 'divine' ? 'text-ink-300' : 'text-cool-500'}>
            {worth.otherUnit === 'divine'
              ? `${formatDivine(worth.otherValue)} divine`
              : `${formatChaos(worth.otherValue)}c`}
          </span>
          {' at '}
          {formatChaos(stats?.divineRate ?? 0)}c per divine
        </p>
      </div>
      </div>

      {/* Two figures, not five.
       *
       * There were five: gain, an active rate, a wall-clock rate, how long the stash was moving,
       * and the best hour in the range. Four of them were the same question asked four ways, and
       * the two rates differed by a distinction — active hours against the clock — that only the
       * person who wrote it remembers by the second visit.
       *
       * So one rate, the active one, because a wealth tracker is asked "how fast am I earning
       * while playing" and not "including the hours I was asleep". The hours it is divided by
       * sit under it as a note rather than as a column of their own, which is where they were
       * useful in the first place: they are the denominator, not a figure. The wall-clock rate
       * is gain over wall-clock hours, and both of those numbers are still on screen.
       */}
      <dl className="mt-6 flex flex-wrap gap-x-10 gap-y-3 text-xs">
        <Figure
          label="Gain in range"
          value={prices.signed(gain)}
          tone={gain === 0 ? 'flat' : gain > 0 ? 'up' : 'down'}
        />
        <Figure
          label="Rate while moving"
          value={prices.rate(stats?.chaosPerHourActive ?? 0)}
          note={`${formatHours(stats?.activeHours ?? 0)} of ${formatHours(stats?.wallClockHours ?? 0)}`}
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
  note,
  tone = 'flat',
}: {
  label: string;
  value: string;
  /** What the figure is measured over, when that is what makes it readable. */
  note?: string;
  tone?: 'flat' | 'up' | 'down';
}) {
  return (
    <div className="border-l border-ink-800 pl-3 first:border-l-0 first:pl-0">
      <dt className="text-xs text-ink-400">{label}</dt>
      <dd
        className={`num mt-0.5 !text-left text-base ${
          tone === 'up' ? 'text-accent-500' : tone === 'down' ? 'text-ink-200' : 'text-ink-100'
        }`}
      >
        {value}
        {note ? <span className="ml-2 text-[0.7rem] text-ink-400">{note}</span> : null}
      </dd>
    </div>
  );
}
