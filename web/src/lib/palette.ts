/**
 * The colours the charts draw with.
 *
 * Recharts takes colours as props, not classes, so every chart used to carry its own copy of
 * `#e0a458` — six files agreeing by luck. They stopped agreeing the moment the palette moved.
 * These constants are the same values the theme defines in index.css, in the one form SVG can
 * be handed, so a change of palette is a change in two files rather than eight.
 *
 * ## What the colours mean
 *
 * The citadel stands in the dark at the end of time: a void that is not quite black, gold that
 * is the last light in it, and the violet of time itself running past. So:
 *
 *   gold   — chaos, and every quantity of wealth.
 *   violet — divine: the rate overlay and divine-denominated series, so "is this a real gain or
 *            is divine just inflating?" stays answerable by eye.
 *   dust   — everything that happened but did not move the number: idle intervals, losses.
 *
 * Losses are dust rather than red. A third hue would be a new colour for something already
 * distinguishable by direction.
 */

export const PALETTE = {
  /** Chaos and wealth. The citadel's own light. */
  gold: '#e2a94f',
  goldBright: '#f2c97e',
  goldDim: '#a8762f',

  /** Divine, and time passing. */
  violet: '#9d7bf0',
  violetBright: '#bda3ff',
  violetDim: '#6d4bc9',

  /** Void, in the order the theme's ink ramp uses. */
  void: '#070610',
  surface: '#0c0a16',
  hairline: '#171325',
  grid: '#221c33',
  edge: '#332a49',

  /** Muted text and anything that happened without mattering. */
  dust: '#7a6f92',
} as const;

/** Axis ticks and lines, identical across every chart. */
export const AXIS = { stroke: PALETTE.dust, fontSize: 11 } as const;

/**
 * Per-tab bands, in drawing order.
 *
 * Gold and violet alternate so neighbouring bands never share a hue, and each pair steps
 * darker — a stash with six tabs is still six distinguishable bands rather than a gradient.
 */
export const BANDS = [
  PALETTE.gold,
  PALETTE.violet,
  PALETTE.goldDim,
  PALETTE.violetDim,
  PALETTE.goldBright,
  PALETTE.violetBright,
] as const;
