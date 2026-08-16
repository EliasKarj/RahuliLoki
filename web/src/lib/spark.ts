/**
 * A sparkline as two SVG paths, computed rather than charted.
 *
 * Recharts draws the real charts and does it well, but the hero band needs something else: a
 * shape that bleeds to both edges, sits *behind* text, and costs nothing to render on every
 * refresh. That is a path, not a chart — no axes, no tooltip, no layout pass, no legend.
 *
 * Kept as a pure function so the geometry is testable. A sparkline that quietly draws a flat
 * line for a rising series is the kind of wrong nobody notices, because it still looks like a
 * chart.
 */

export interface Sparkline {
  /** The line along the top of the series. */
  line: string;
  /** The same line closed down to the baseline, for a fill. */
  area: string;
}

/**
 * Scale `values` into a path across `width` × `height`.
 *
 * The vertical scale spans the series' own minimum and maximum rather than starting at zero.
 * For net worth that is the honest choice at this size: a band 40px tall that starts at zero
 * shows a day's trading as a flat line, which says "nothing happened" about a day when plenty
 * did. The hero states the actual figure right next to it, so there is no risk of reading the
 * shape as the magnitude.
 *
 * Returns empty paths for fewer than two points — one snapshot is a dot, not a trend, and
 * drawing a line through it would invent a direction.
 */
export function sparklinePath(values: number[], width: number, height: number): Sparkline {
  const usable = values.filter((value) => Number.isFinite(value));
  if (usable.length < 2 || width <= 0 || height <= 0) return { line: '', area: '' };

  const min = Math.min(...usable);
  const max = Math.max(...usable);
  // A flat series has no range to divide by. Draw it down the middle rather than at an edge.
  const span = max - min;
  const step = width / (usable.length - 1);

  const points = usable.map((value, index) => {
    const x = index * step;
    const y = span === 0 ? height / 2 : height - ((value - min) / span) * height;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });

  const line = `M${points.join('L')}`;
  return { line, area: `${line}L${width.toFixed(2)},${height.toFixed(2)}L0,${height.toFixed(2)}Z` };
}
