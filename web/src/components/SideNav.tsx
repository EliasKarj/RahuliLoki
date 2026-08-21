/**
 * The view switcher, as a panel that slides in from the left edge.
 *
 * It used to be a permanent rail. The rail was honest about where you were — the current view sat
 * highlighted in it at all times — but it charged thirteen rems of every window for the privilege,
 * on a page whose whole point is wide tables, and switching views is something you do a handful of
 * times an hour at most. A panel that is closed by default gives that width back.
 *
 * ## What the rail did that a closed panel cannot
 *
 * Say which view you are looking at. That is not a detail to lose, so the button that opens the
 * panel carries the current view's name: closed, it reads "Economy"; open, the same name is
 * highlighted in the list. Nothing about where you are depends on the panel being open.
 *
 * ## Getting out again
 *
 * Three ways, because a panel you can open and not close is a trap: choosing a view, pressing
 * Escape, and clicking the dimmed page behind it. Focus moves into the panel when it opens and
 * returns to the button when it closes, so this is navigable without a mouse — the failure that
 * makes a drawer unusable rather than merely awkward.
 */

import { useEffect, useRef } from 'react';

export type View = 'dashboard' | 'economy' | 'kingsmarch';

export const VIEWS: Array<{ id: View; label: string; hint: string }> = [
  { id: 'dashboard', label: 'Dashboard', hint: 'What you own and what it is doing' },
  { id: 'economy', label: 'Economy', hint: 'What everything is worth, held or not' },
  { id: 'kingsmarch', label: 'Kingsmarch', hint: 'Your uniques, ranked by the dust a chaos of them buys' },
];

/** The name of a view, for the button that opens the panel. */
export function viewLabel(view: View): string {
  return VIEWS.find((entry) => entry.id === view)?.label ?? 'Menu';
}

export function SideNav({
  value,
  onChange,
  open,
  onOpenChange,
}: {
  value: View;
  onChange: (next: View) => void;
  open: boolean;
  onOpenChange: (next: boolean) => void;
}) {
  const panel = useRef<HTMLDivElement | null>(null);
  const toggle = useRef<HTMLButtonElement | null>(null);
  /** So focus is only pulled around in response to opening, not on every render while open. */
  const wasOpen = useRef(false);

  useEffect(() => {
    if (!open) {
      // Back to the button, but only if this is a close rather than the first render — otherwise
      // the page would steal focus from wherever the reader put it as soon as it loaded.
      if (wasOpen.current) toggle.current?.focus();
      wasOpen.current = false;
      return;
    }
    wasOpen.current = true;
    panel.current?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onOpenChange(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onOpenChange]);

  return (
    <>
      <button
        ref={toggle}
        type="button"
        onClick={() => onOpenChange(!open)}
        aria-expanded={open}
        aria-controls="view-panel"
        className="flex shrink-0 items-center gap-2 rounded border border-ink-800 px-2.5 py-1.5 text-sm text-ink-300 transition-colors hover:border-ink-700 hover:text-ink-100"
      >
        {/* Drawn rather than lettered: three rules read as a menu at any size, where a character
            borrowed from a font may or may not be there. aria-hidden because the label says it. */}
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" className="shrink-0">
          <g stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M1.5 3.5h11" />
            <path d="M1.5 7h11" />
            <path d="M1.5 10.5h11" />
          </g>
        </svg>
        {/* The current view, so a closed panel still says where you are. */}
        <span>{viewLabel(value)}</span>
      </button>

      {/* The dimmed page. Present only while open, so it cannot swallow a click when it is not
          there to be seen. */}
      {open ? (
        <div
          onClick={() => onOpenChange(false)}
          aria-hidden="true"
          className="fixed inset-0 z-40 bg-ink-950/60 backdrop-blur-[1px]"
        />
      ) : null}

      <div
        ref={panel}
        id="view-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Views"
        tabIndex={-1}
        // Off-screen rather than unmounted, so it slides. `invisible` and `inert` keep the closed
        // panel out of the tab order — a menu that is not on screen must not be reachable by
        // keyboard, which is the bug that makes an animated drawer worse than a plain one.
        inert={!open}
        className={`fixed left-0 top-0 z-50 flex h-full w-64 flex-col gap-1 border-r border-ink-700 bg-ink-900 px-3 py-5 shadow-2xl shadow-black/60 outline-none transition-transform duration-200 motion-reduce:transition-none ${
          open ? 'translate-x-0' : 'invisible -translate-x-full'
        }`}
      >
        <h2 className="wordmark mb-6 px-2 text-base font-semibold">What Remains</h2>

        <nav aria-label="Views" className="flex flex-col gap-1">
          {VIEWS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => {
                onChange(entry.id);
                onOpenChange(false);
              }}
              aria-current={value === entry.id ? 'page' : undefined}
              title={entry.hint}
              className={`rounded px-3 py-2 text-left text-sm transition-colors ${
                value === entry.id
                  ? 'bg-ink-850 text-ink-100'
                  : 'text-ink-400 hover:bg-ink-850 hover:text-ink-200'
              }`}
            >
              {entry.label}
              <span className="mt-0.5 block text-[0.7rem] text-ink-600">{entry.hint}</span>
            </button>
          ))}
        </nav>
      </div>
    </>
  );
}
