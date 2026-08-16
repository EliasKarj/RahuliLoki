import { describe, expect, it } from 'vitest';
import { sparklinePath } from '../src/lib/spark.ts';

/** Every "x,y" pair in a path, as numbers. */
function points(path: string): Array<[number, number]> {
  return [...path.matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)].map(
    (match) => [Number(match[1]), Number(match[2])] as [number, number],
  );
}

describe('sparklinePath', () => {
  it('spans the full width, first point to last', () => {
    const { line } = sparklinePath([1, 2, 3, 4, 5], 100, 40);
    const drawn = points(line);
    expect(drawn[0]?.[0]).toBe(0);
    expect(drawn[drawn.length - 1]?.[0]).toBe(100);
  });

  it('puts the largest value at the top and the smallest at the bottom', () => {
    // SVG y grows downward, so the maximum has to be the *smallest* y. Getting this inverted
    // draws a falling week as a rising line, which still looks like a chart.
    const { line } = sparklinePath([10, 30, 20], 100, 40);
    const [first, second, third] = points(line);
    expect(second?.[1]).toBe(0);
    expect(first?.[1]).toBe(40);
    expect(third?.[1]).toBeGreaterThan(0);
    expect(third?.[1]).toBeLessThan(40);
  });

  it('draws a flat series down the middle rather than at an edge', () => {
    // A day where nothing moved has no range to scale against, and dividing by it would be NaN.
    const { line } = sparklinePath([500, 500, 500], 100, 40);
    for (const [, y] of points(line)) expect(y).toBe(20);
  });

  it('closes the area back to the baseline', () => {
    const { area } = sparklinePath([1, 5], 100, 40);
    expect(area.endsWith('Z')).toBe(true);
    expect(area).toContain('L100.00,40.00L0,40.00');
  });

  it('draws nothing for a single point, which has no direction', () => {
    expect(sparklinePath([42], 100, 40)).toEqual({ line: '', area: '' });
    expect(sparklinePath([], 100, 40)).toEqual({ line: '', area: '' });
  });

  it('ignores values that are not finite instead of producing NaN in the path', () => {
    const { line } = sparklinePath([1, Number.NaN, 3, Number.POSITIVE_INFINITY], 100, 40);
    expect(line).not.toContain('NaN');
    expect(points(line)).toHaveLength(2);
  });

  it('draws nothing into a box with no area', () => {
    expect(sparklinePath([1, 2, 3], 0, 40).line).toBe('');
    expect(sparklinePath([1, 2, 3], 100, 0).line).toBe('');
  });
});
