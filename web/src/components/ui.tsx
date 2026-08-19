/** Small shared pieces: panels, stat tiles, pills, the range toggle, empty states. */

import { useState, type ReactNode } from 'react';
import { RANGES, type RangeKey } from '../lib/series.ts';

/**
 * A titled section. Optionally one that folds away.
 *
 * Not a card. Cards put a border and a fill around everything, which gives every section the
 * same visual weight and stacks eight hairlines down a screen that is mostly numbers. A rule
 * and a small-caps label separate sections just as clearly and leave the data as the only thing
 * with edges.
 *
 * Collapsing matters more than it sounds. Four full-height charts above the item table meant
 * the thing most people open this app to read — what they own and what it is worth — sat two
 * screens down every single time. The charts are worth having *and* worth being out of the way
 * by default; folding is what lets both be true.
 */
export function Panel({
  title,
  subtitle,
  actions,
  collapsible = false,
  defaultOpen = true,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const shown = !collapsible || open;

  const heading = (
    <div className="flex items-baseline gap-2 text-left">
      {collapsible ? (
        <span className="text-[0.65rem] text-ink-500 transition-colors group-hover:text-accent-500" aria-hidden="true">
          {open ? '\u25be' : '\u25b8'}
        </span>
      ) : null}
      {/* Sentence case, not small caps.
       *
       * Five stacked headings in wide-tracked capitals is a lot of texture for a page whose
       * job is to be read at a glance, and it made every section shout at the same volume as
       * the wordmark. The wordmark is the one carved thing here now; a section is just a
       * label, so it is set like one. */}
      <h2 className="text-sm font-medium tracking-wide text-ink-200">{title}</h2>
      {subtitle && shown ? (
        <p className="hidden text-xs font-normal normal-case tracking-normal text-ink-500 lg:block">
          {subtitle}
        </p>
      ) : null}
    </div>
  );

  return (
    <section>
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-ink-800 pb-3">
        {collapsible ? (
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            className="group flex flex-1 items-baseline transition-colors"
          >
            {heading}
          </button>
        ) : (
          heading
        )}
        {actions}
      </header>
      {shown ? <div className="pt-5">{children}</div> : null}
    </section>
  );
}

export function Pill({ tone, children }: { tone: 'ok' | 'warn' | 'muted'; children: ReactNode }) {
  const classes =
    tone === 'ok'
      ? 'border-cool-600/40 bg-cool-600/10 text-cool-400'
      : tone === 'warn'
        ? 'border-accent-600/50 bg-accent-600/10 text-accent-400'
        : 'border-ink-700 bg-ink-850 text-ink-300';

  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${classes}`}>
      {children}
    </span>
  );
}

export function RangeToggle({
  value,
  onChange,
}: {
  value: RangeKey;
  onChange: (next: RangeKey) => void;
}) {
  return (
    <div className="inline-flex overflow-hidden rounded-md border border-ink-700" role="group" aria-label="Time range">
      {RANGES.map((range) => (
        <button
          key={range.key}
          type="button"
          onClick={() => onChange(range.key)}
          aria-pressed={value === range.key}
          className={`px-3 py-1 text-xs transition-colors ${
            value === range.key
              ? 'bg-ink-700 text-ink-100'
              : 'bg-ink-900 text-ink-400 hover:bg-ink-850 hover:text-ink-200'
          }`}
        >
          {range.label}
        </button>
      ))}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-40 items-center justify-center rounded-md border border-dashed border-ink-800 px-6 py-10 text-center text-sm text-ink-400">
      {children}
    </div>
  );
}

/** Shared tooltip chrome, so every chart's hover card looks the same. */
export function TooltipCard({ title, rows }: { title: string; rows: Array<[string, string, string?]> }) {
  return (
    <div className="rounded-md border border-ink-700 bg-ink-850/95 px-3 py-2 text-xs shadow-lg backdrop-blur">
      <div className="mb-1 font-medium text-ink-200">{title}</div>
      <table>
        <tbody>
          {rows.map(([label, value, colour]) => (
            <tr key={label}>
              <td className="pr-3 text-ink-400">{label}</td>
              <td className={`num ${colour ?? 'text-ink-100'}`}>{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
