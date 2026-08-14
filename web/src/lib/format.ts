/**
 * Number and time formatting.
 *
 * The rule from the spec: chaos under 1000 is shown whole, above that abbreviated — 14.2k.
 * Fractions of a chaos are noise at net-worth scale, and "14 213" is harder to read at a
 * glance than "14.2k" even though it carries more digits.
 */

const ABBREVIATIONS = [
  { limit: 1e9, suffix: 'B' },
  { limit: 1e6, suffix: 'M' },
  { limit: 1e3, suffix: 'k' },
] as const;

/** Chaos, per the display rule. `1234` → `1.23k`, `999.6` → `1000`, `-2500` → `-2.5k`. */
export function formatChaos(value: number): string {
  if (!Number.isFinite(value)) return '—';

  const sign = value < 0 ? '-' : '';
  const magnitude = Math.abs(value);

  for (const { limit, suffix } of ABBREVIATIONS) {
    if (magnitude >= limit) {
      const scaled = magnitude / limit;
      // Three significant figures: 14.2k, 142k, 1.42M. Trailing zeros are dropped.
      const digits = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
      return `${sign}${Number(scaled.toFixed(digits))}${suffix}`;
    }
  }
  return `${sign}${Math.round(magnitude)}`;
}

/** Divine totals are small numbers people quote to two decimals. */
export function formatDivine(value: number): string {
  if (!Number.isFinite(value)) return '—';
  if (Math.abs(value) >= 1000) return formatChaos(value);
  return value.toFixed(2);
}

/** Chaos per hour, signed, so a losing stretch reads as a loss. */
export function formatRate(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const formatted = formatChaos(Math.abs(value));
  return `${value > 0 ? '+' : value < 0 ? '−' : ''}${formatted}/h`;
}

export function formatSignedChaos(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return `${value > 0 ? '+' : value < 0 ? '−' : ''}${formatChaos(Math.abs(value))}`;
}

export function formatCount(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('en-GB').format(Math.round(value));
}

/** `1.5` → `1 h 30 min`; under an hour drops to minutes. */
export function formatHours(hours: number): string {
  if (!Number.isFinite(hours) || hours < 0) return '—';
  const totalMinutes = Math.round(hours * 60);
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const whole = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `${whole} h` : `${whole} h ${minutes} min`;
}

const TIME = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });
const DAY_TIME = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});
const DAY = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short' });

export function formatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '—' : TIME.format(date);
}

export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '—' : DAY_TIME.format(date);
}

export function formatDay(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '—' : DAY.format(date);
}

/** "4 min ago" / "2 h ago". Used for "last poll", where exactness matters less than freshness. */
export function formatAgo(iso: string | null, now: number = Date.now()): string {
  if (iso === null) return 'never';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';

  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}
