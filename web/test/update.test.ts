import { describe, expect, it } from 'vitest';
import {
  displayVersion,
  readDismissed,
  shouldShowUpdate,
  writeDismissed,
  type UpdateInfo,
} from '../src/lib/update.ts';

const available: UpdateInfo = {
  current: '1.0.2',
  latest: 'v1.1.0',
  available: true,
  url: 'https://github.com/EliasKarj/WhatRemains/releases/tag/v1.1.0',
  checkedAt: '2026-01-01T00:00:00.000Z',
};

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(initial));
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => void map.delete(key),
    setItem: (key: string, value: string) => void map.set(key, value),
  } as Storage;
}

describe('shouldShowUpdate', () => {
  it('shows an available update nobody has dismissed', () => {
    expect(shouldShowUpdate(available, null)).toBe(true);
  });

  it('says nothing when there is no update, or no answer at all', () => {
    expect(shouldShowUpdate({ ...available, available: false }, null)).toBe(false);
    expect(shouldShowUpdate(null, null)).toBe(false);
    expect(shouldShowUpdate(undefined, null)).toBe(false);
  });

  it('says nothing without somewhere to send the person', () => {
    // An update with no link is an instruction to go and search for it.
    expect(shouldShowUpdate({ ...available, url: null }, null)).toBe(false);
  });

  it('stays dismissed for the version that was dismissed', () => {
    expect(shouldShowUpdate(available, 'v1.1.0')).toBe(false);
  });

  it('comes back for the next release', () => {
    // The failure this guards against is a dismissal that outlives its release and silently
    // turns the check off forever.
    expect(shouldShowUpdate({ ...available, latest: 'v1.2.0' }, 'v1.1.0')).toBe(true);
  });
});

describe('the dismissal', () => {
  it('round-trips', () => {
    const storage = memoryStorage();
    writeDismissed('v1.1.0', storage);
    expect(readDismissed(storage)).toBe('v1.1.0');
  });

  it('survives storage that throws or is missing', () => {
    const hostile = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    } as unknown as Storage;

    expect(() => writeDismissed('v1.1.0', hostile)).not.toThrow();
    expect(readDismissed(hostile)).toBeNull();
    expect(readDismissed(null)).toBeNull();
  });
});

describe('displayVersion', () => {
  it('drops the tag prefix', () => {
    expect(displayVersion('v1.1.0')).toBe('1.1.0');
    expect(displayVersion('1.1.0')).toBe('1.1.0');
  });
});
