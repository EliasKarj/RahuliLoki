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

/** Which orb a quantity is quoted in, and how much of it. */
export interface Denominated {
  unit: 'chaos' | 'divine';
  value: number;
  /** The same amount in the other orb, for the line underneath. */
  otherUnit: 'chaos' | 'divine';
  otherValue: number;
}

/**
 * Quote an amount in the orb a player would actually say it in.
 *
 * Nobody reports a stash as "twenty thousand chaos"; past a divine they count divines. Below
 * one, divines are the wrong unit in the other direction — "0.4 divine" is a number you have to
 * convert in your head to picture. So the threshold is one divine, which is exactly where the
 * spoken unit changes.
 *
 * Falls back to chaos whenever the rate is unusable. A rate of zero is not merely unhelpful
 * here: dividing by it yields Infinity, and a net worth of "∞ divine" over a perfectly good
 * chaos total is worse than simply saying the chaos.
 */
export function denominate(chaos: number, divineRate: number): Denominated {
  const rate = Number.isFinite(divineRate) && divineRate > 0 ? divineRate : 0;
  if (rate === 0 || !Number.isFinite(chaos) || Math.abs(chaos) < rate) {
    return {
      unit: 'chaos',
      value: chaos,
      otherUnit: 'divine',
      otherValue: rate === 0 ? 0 : chaos / rate,
    };
  }
  return { unit: 'divine', value: chaos / rate, otherUnit: 'chaos', otherValue: chaos };
}

/** Format an amount in whichever orb `denominate` chose. */
export function formatDenominated(amount: Denominated): string {
  return amount.unit === 'divine' ? formatDivine(amount.value) : formatChaos(amount.value);
}

/**
 * A price, in the orb it belongs in, with its unit attached.
 *
 * The one formatter every price on the page goes through, so the rule is stated once. Below a
 * divine an amount reads in chaos; at or above one it reads in divine.
 */
export function formatPrice(chaos: number, divineRate: number): string {
  const amount = denominate(chaos, divineRate);
  return amount.unit === 'divine' ? `${formatDivine(amount.value)} div` : `${formatChaos(amount.value)}c`;
}

/** The same, signed, for a change rather than a holding. */
export function formatSignedPrice(chaos: number, divineRate: number): string {
  const amount = denominate(chaos, divineRate);
  const sign = amount.value > 0 ? '+' : amount.value < 0 ? '−' : '';
  const magnitude = Math.abs(amount.value);
  return amount.unit === 'divine'
    ? `${sign}${formatDivine(magnitude)} div`
    : `${sign}${formatChaos(magnitude)}c`;
}

/** A rate: the same rule, per hour. */
export function formatPriceRate(chaosPerHour: number, divineRate: number): string {
  if (!Number.isFinite(chaosPerHour)) return '—';
  return `${formatSignedPrice(chaosPerHour, divineRate)}/h`;
}

export interface ChartUnit {
  unit: 'chaos' | 'divine';
  /** Divide a chaos value by this to get the axis' unit. */
  divisor: number;
  suffix: string;
}

/**
 * One unit for a whole axis, chosen from the largest value on it.
 *
 * The per-value rule is right for a figure read on its own and wrong for an axis. An axis whose
 * ticks switched units halfway up would be unreadable, and a series plotted against it would be
 * a lie about its own shape. So a chart picks one unit — the one its peak belongs in — and says
 * so in the tick labels.
 */
export function chartUnit(values: number[], divineRate: number): ChartUnit {
  const rate = Number.isFinite(divineRate) && divineRate > 0 ? divineRate : 0;
  const peak = values.reduce(
    (max, value) => (Number.isFinite(value) ? Math.max(max, Math.abs(value)) : max),
    0,
  );
  if (rate === 0 || peak < rate) return { unit: 'chaos', divisor: 1, suffix: 'c' };
  return { unit: 'divine', divisor: rate, suffix: ' div' };
}

/** Format a chaos value against an axis' chosen unit. */
export function formatInUnit(chaos: number, unit: ChartUnit): string {
  const scaled = chaos / unit.divisor;
  return unit.unit === 'divine' ? formatDivine(scaled) : formatChaos(scaled);
}

/**
 * poe.ninja spells its categories in PascalCase; a person reads them with spaces.
 *
 * `DivinationCard` -> `Divination Card`. Lived in two components and one lib as three copies of
 * the same regex.
 */
export function categoryLabel(category: string): string {
  return category.replace(/([a-z])([A-Z])/g, '$1 $2');
}
