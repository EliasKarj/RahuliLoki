import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { DEFAULT_FILES, adoptOldData } from '../src/adoptOldData.ts';

const OLD = '/appdata/valuuttaloki';
const NEW = '/appdata/What Remains';

/** A filesystem that is a set of paths, so a test can state exactly what exists. */
function fakeFs(present: string[]) {
  const files = new Set(present);
  const copies: Array<[string, string]> = [];
  const made: string[] = [];
  return {
    files,
    copies,
    made,
    io: {
      exists: (path: string) => files.has(path),
      copy: (from: string, to: string) => {
        copies.push([from, to]);
        files.add(to);
      },
      mkdir: (path: string) => {
        made.push(path);
        files.add(path);
      },
    },
  };
}

describe('adoptOldData', () => {
  it('carries settings and the database across, renaming the database', () => {
    const fs = fakeFs([OLD, join(OLD, 'settings.json'), join(OLD, 'valuuttaloki.db')]);
    const result = adoptOldData({ from: OLD, to: NEW, fs: fs.io });

    expect(result.copied).toEqual(['settings.json', 'what-remains.db']);
    expect(fs.copies).toEqual([
      [join(OLD, 'settings.json'), join(NEW, 'settings.json')],
      [join(OLD, 'valuuttaloki.db'), join(NEW, 'what-remains.db')],
    ]);
  });

  it('takes the write-ahead log with the database', () => {
    // A database copied without its -wal can be missing the newest commits, which for this app
    // means the newest snapshots — the ones someone would notice were gone.
    const fs = fakeFs([
      OLD,
      join(OLD, 'settings.json'),
      join(OLD, 'valuuttaloki.db'),
      join(OLD, 'valuuttaloki.db-wal'),
      join(OLD, 'valuuttaloki.db-shm'),
    ]);
    const result = adoptOldData({ from: OLD, to: NEW, fs: fs.io });

    expect(result.copied).toEqual([
      'settings.json',
      'what-remains.db',
      'what-remains.db-wal',
      'what-remains.db-shm',
    ]);
  });

  it('never copies over an install that has already been used', () => {
    // Someone who has launched the renamed app and signed in has newer state than the old
    // folder holds; running twice would put a stale session back over a fresh one.
    const fs = fakeFs([OLD, join(OLD, 'settings.json'), NEW, join(NEW, 'settings.json')]);
    const result = adoptOldData({ from: OLD, to: NEW, fs: fs.io });

    expect(result).toEqual({ copied: [], skipped: 'already-populated' });
    expect(fs.copies).toEqual([]);
  });

  it('does nothing at all on a machine that never ran the old app', () => {
    const fs = fakeFs([]);
    expect(adoptOldData({ from: OLD, to: NEW, fs: fs.io })).toEqual({
      copied: [],
      skipped: 'no-old-directory',
    });
  });

  it('refuses to copy a directory onto itself', () => {
    const fs = fakeFs([OLD, join(OLD, 'settings.json')]);
    expect(adoptOldData({ from: OLD, to: OLD, fs: fs.io }).skipped).toBe('no-old-directory');
    expect(fs.copies).toEqual([]);
  });

  it('leaves the old directory alone', () => {
    // Copied, not moved: if this migration turns out to be wrong in some way nobody has thought
    // of, the original is still there to go back to.
    const fs = fakeFs([OLD, join(OLD, 'settings.json'), join(OLD, 'valuuttaloki.db')]);
    adoptOldData({ from: OLD, to: NEW, fs: fs.io });

    expect(fs.files.has(join(OLD, 'settings.json'))).toBe(true);
    expect(fs.files.has(join(OLD, 'valuuttaloki.db'))).toBe(true);
  });

  it('skips what is missing rather than failing', () => {
    const fs = fakeFs([OLD, join(OLD, 'valuuttaloki.db')]);
    const result = adoptOldData({ from: OLD, to: NEW, fs: fs.io });

    expect(result.copied).toEqual(['what-remains.db']);
    expect(result.skipped).toBeNull();
  });

  it('names the old database under the old name and the new one under the new', () => {
    // Guards the rename itself: a typo here is a migration that silently copies nothing.
    expect(DEFAULT_FILES.map(([from]) => from)).toContain('valuuttaloki.db');
    expect(DEFAULT_FILES.map(([, to]) => to)).toContain('what-remains.db');
  });
});
