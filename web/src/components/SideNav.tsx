/**
 * The left-hand rail: which view is on screen, and the app's own name above it.
 *
 * A rail rather than a row of tabs because the page is now as wide as the window, and a
 * thirteen-rem column costs nothing on a screen with four hundred pixels to spare — while a
 * horizontal tab strip would take a line of vertical space away from the tables, which are the
 * thing anybody came here to read.
 *
 * Below `lg` it folds into a row, because there the width is the scarce thing instead.
 */

export type View = 'dashboard' | 'economy' | 'kingsmarch';

const VIEWS: Array<{ id: View; label: string; hint: string }> = [
  { id: 'dashboard', label: 'Dashboard', hint: 'What you own and what it is doing' },
  { id: 'economy', label: 'Economy', hint: 'What everything is worth, held or not' },
  { id: 'kingsmarch', label: 'Kingsmarch', hint: 'Your uniques, ranked by the dust a chaos of them buys' },
];

export function SideNav({ value, onChange }: { value: View; onChange: (next: View) => void }) {
  return (
    <nav
      aria-label="Views"
      // Sticky on a wide window: the dashboard is several screens tall with everything open,
      // and a rail that scrolls away is a rail you have to scroll back for.
      className="flex shrink-0 flex-row gap-2 lg:sticky lg:top-6 lg:h-fit lg:w-52 lg:flex-col lg:gap-1"
    >
      {/* The wordmark lives here in the wide layout: it names the thing the rail belongs to,
          and the header beside it is then free to be about the league and the poller. */}
      <h1 className="wordmark mb-0 hidden text-base font-semibold lg:mb-6 lg:block xl:text-lg">
        What Remains
      </h1>
      {VIEWS.map((view) => (
        <button
          key={view.id}
          type="button"
          onClick={() => onChange(view.id)}
          aria-current={value === view.id ? 'page' : undefined}
          title={view.hint}
          className={`rounded px-3 py-1.5 text-left text-sm transition-colors ${
            value === view.id
              ? 'bg-ink-850 text-ink-100'
              : 'text-ink-400 hover:bg-ink-900 hover:text-ink-200'
          }`}
        >
          {view.label}
        </button>
      ))}
    </nav>
  );
}
