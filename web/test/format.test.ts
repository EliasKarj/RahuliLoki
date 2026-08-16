import { describe, expect, it } from 'vitest';
import {
  formatAgo,
  formatChaos,
  denominate,
  formatCount,
  formatDivine,
  formatHours,
  formatRate,
  formatSignedChaos,
} from '../src/lib/format.ts';

describe('formatChaos', () => {
  it('shows values under a thousand whole', () => {
    expect(formatChaos(0)).toBe('0');
    expect(formatChaos(7)).toBe('7');
    expect(formatChaos(999)).toBe('999');
  });

  it('rounds away the fractions nobody reads at net-worth scale', () => {
    expect(formatChaos(12.4)).toBe('12');
    expect(formatChaos(12.6)).toBe('13');
  });

  it('abbreviates above a thousand, as the spec asks', () => {
    expect(formatChaos(14_200)).toBe('14.2k');
    expect(formatChaos(1_000)).toBe('1k');
    expect(formatChaos(1_234)).toBe('1.23k');
  });

  it('keeps three significant figures as the magnitude grows', () => {
    expect(formatChaos(142_000)).toBe('142k');
    expect(formatChaos(1_420_000)).toBe('1.42M');
    expect(formatChaos(2_500_000_000)).toBe('2.5B');
  });

  it('carries the sign', () => {
    expect(formatChaos(-14_200)).toBe('-14.2k');
    expect(formatChaos(-5)).toBe('-5');
  });

  it('answers a dash for a non-number rather than NaN', () => {
    expect(formatChaos(Number.NaN)).toBe('—');
    expect(formatChaos(Number.POSITIVE_INFINITY)).toBe('—');
  });
});

describe('formatDivine', () => {
  it('quotes two decimals, the way players do', () => {
    expect(formatDivine(6.6437)).toBe('6.64');
    expect(formatDivine(0)).toBe('0.00');
  });

  it('falls back to abbreviation once a divine total gets absurd', () => {
    expect(formatDivine(12_500)).toBe('12.5k');
  });
});

describe('formatRate', () => {
  it('marks direction explicitly', () => {
    expect(formatRate(1200)).toBe('+1.2k/h');
    expect(formatRate(-40)).toBe('−40/h');
    expect(formatRate(0)).toBe('0/h');
  });
});

describe('formatSignedChaos', () => {
  it('marks direction without a unit', () => {
    expect(formatSignedChaos(600.2)).toBe('+600');
    expect(formatSignedChaos(-1500)).toBe('−1.5k');
  });
});

describe('formatCount', () => {
  it('groups digits so a stack of five thousand is readable', () => {
    expect(formatCount(5000)).toBe('5,000');
  });
});

describe('formatHours', () => {
  it('drops to minutes under an hour', () => {
    expect(formatHours(0.25)).toBe('15 min');
  });

  it('shows hours and minutes above one', () => {
    expect(formatHours(1.5)).toBe('1 h 30 min');
    expect(formatHours(3)).toBe('3 h');
  });

  it('answers a dash for nonsense', () => {
    expect(formatHours(Number.NaN)).toBe('—');
    expect(formatHours(-1)).toBe('—');
  });
});

describe('formatAgo', () => {
  const now = Date.parse('2026-01-01T12:00:00Z');

  it('counts seconds, minutes, hours and days', () => {
    expect(formatAgo('2026-01-01T11:59:30Z', now)).toBe('30s ago');
    expect(formatAgo('2026-01-01T11:45:00Z', now)).toBe('15 min ago');
    expect(formatAgo('2026-01-01T06:00:00Z', now)).toBe('6 h ago');
    expect(formatAgo('2025-12-28T12:00:00Z', now)).toBe('4 d ago');
  });

  it('says never when nothing has happened yet', () => {
    expect(formatAgo(null, now)).toBe('never');
  });

  it('does not report a future timestamp as a negative age', () => {
    expect(formatAgo('2026-01-01T12:05:00Z', now)).toBe('0s ago');
  });
});

describe('denominate', () => {
  it('quotes a stash in divine once it is worth one', () => {
    // Nobody reports a stash as "twenty thousand chaos"; past a divine they count divines.
    expect(denominate(20512, 196.9)).toMatchObject({ unit: 'divine' });
    expect(denominate(20512, 196.9).value).toBeCloseTo(104.17, 2);
  });

  it('quotes it in chaos below a divine', () => {
    // "0.4 divine" is a number you have to convert in your head to picture.
    expect(denominate(150, 196.9)).toMatchObject({ unit: 'chaos', value: 150 });
  });

  it('switches exactly at one divine', () => {
    expect(denominate(196.9, 196.9).unit).toBe('divine');
    expect(denominate(196.89, 196.9).unit).toBe('chaos');
  });

  it('carries the other denomination for the line underneath', () => {
    const amount = denominate(20512, 196.9);
    expect(amount.otherUnit).toBe('chaos');
    expect(amount.otherValue).toBe(20512);
  });

  it('falls back to chaos when the rate is unusable', () => {
    // Dividing by zero yields Infinity, and "∞ divine" over a perfectly good chaos total is
    // worse than simply saying the chaos.
    expect(denominate(20512, 0)).toMatchObject({ unit: 'chaos', value: 20512 });
    expect(denominate(20512, Number.NaN).unit).toBe('chaos');
    expect(denominate(20512, -5).unit).toBe('chaos');
  });

  it('decides on magnitude, so a large loss is still quoted in divine', () => {
    expect(denominate(-20512, 196.9).unit).toBe('divine');
    expect(denominate(-20512, 196.9).value).toBeCloseTo(-104.17, 2);
  });

  it('does not invent a number from a broken total', () => {
    expect(denominate(Number.NaN, 196.9).unit).toBe('chaos');
  });
});
