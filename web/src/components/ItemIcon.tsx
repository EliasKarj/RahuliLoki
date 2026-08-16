/**
 * One item's icon, or the space where one would be.
 *
 * The fixed-size box is the whole point: an icon is missing more often than not — poe.ninja has
 * no art for some lines, and a whole category has none until the next price fetch — and a table
 * whose first column jags left and right down the page is harder to read than one with no icons
 * at all.
 *
 * `alt=""` and `aria-hidden` because the name is already right there in the same cell. An alt
 * text here would make a screen reader announce every item twice.
 */
export function ItemIcon({ src, size = 5 }: { src?: string | undefined; size?: 5 | 6 }) {
  const box = size === 6 ? 'h-6 w-6' : 'h-5 w-5';
  const image = size === 6 ? 'max-h-6 max-w-6' : 'max-h-5 max-w-5';

  return (
    <span className={`flex ${box} shrink-0 items-center justify-center`}>
      {src ? (
        <img
          src={src}
          alt=""
          aria-hidden="true"
          loading="lazy"
          decoding="async"
          // The CDN has no business knowing which dashboard page linked it.
          referrerPolicy="no-referrer"
          className={image}
        />
      ) : null}
    </span>
  );
}
