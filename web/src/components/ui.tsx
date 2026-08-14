/** Small shared pieces: panels, stat tiles, pills, the range toggle, empty states. */

import type { ReactNode } from 'react';
import { RANGES, type RangeKey } from '../lib/series.ts';

export function Panel({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-ink-800 bg-ink-900">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-ink-800 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold tracking-wide text-ink-100">{title}</h2>
          {subtitle ? <p className="mt-0.5 text-xs text-ink-400">{subtitle}</p> : null}
        </div>
        {actions}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

export function StatTile({
  label,
  value,
  hint,
  tone = 'accent',
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'accent' | 'cool' | 'plain';
}) {
  const valueColour =
    tone === 'accent' ? 'text-accent-500' : tone === 'cool' ? 'text-cool-500' : 'text-ink-100';

  return (
    <div className="rounded-lg border border-ink-800 bg-ink-900 px-4 py-3">
      <div className="text-[11px] font-medium uppercase tracking-wider text-ink-400">{label}</div>
      <div className={`num mt-1 text-2xl leading-none ${valueColour}`} style={{ textAlign: 'left' }}>
        {value}
      </div>
      {hint ? <div className="mt-1.5 text-xs text-ink-400">{hint}</div> : null}
    </div>
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
