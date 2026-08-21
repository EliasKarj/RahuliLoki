/**
 * The view list, and the one thing the old rail did that a closed panel cannot.
 *
 * The rail said which view you were in by highlighting it, permanently. A panel that is shut says
 * nothing at all — so the button that opens it wears the current view's name instead, and that
 * label is the whole of the replacement. If it ever went wrong the page would stop telling anyone
 * where they are, quietly, which is exactly the sort of regression a screenshot does not catch.
 */

import { describe, expect, it } from 'vitest';
import { VIEWS, viewLabel, type View } from '../src/components/SideNav.tsx';

describe('the views', () => {
  it('has one entry per view the app can show', () => {
    expect(VIEWS.map((view) => view.id)).toEqual(['dashboard', 'economy', 'kingsmarch']);
  });

  it('says what each one is for, because the panel shows the hint under the name', () => {
    for (const view of VIEWS) {
      expect(view.label.length).toBeGreaterThan(0);
      expect(view.hint.length).toBeGreaterThan(0);
    }
  });
});

describe('viewLabel', () => {
  it('names every view, so the closed button always says where you are', () => {
    for (const view of VIEWS) expect(viewLabel(view.id)).toBe(view.label);
  });

  it('falls back to a word rather than an empty button', () => {
    // Unreachable while the type holds, but this is what a button with no text looks like: a
    // hamburger icon and a gap, on a page that no longer says which view is open.
    expect(viewLabel('nonexistent' as View)).toBe('Menu');
  });
});
