/**
 * Bringing the old application-data folder across after the rename.
 *
 * Electron derives `userData` from the application's name, so renaming the app from
 * valuuttaloki to What Remains moves the folder the settings and the database live in. Nothing
 * warns about that. The app would simply launch into a first-run screen — no session, no
 * account, no history — while a league's worth of snapshots sat intact in a directory it no
 * longer looks at. A rename is not a reason to lose data, and "it is still on disk" is no
 * comfort to someone staring at an empty chart.
 *
 * So on boot, exactly once, the old folder's files are copied into the new one.
 *
 * ## Copied, not moved
 *
 * The old directory is left untouched. If this migration is wrong in some way nobody has
 * thought of yet, the original is still there to go back to; a move would spend the only copy
 * to save a few megabytes.
 *
 * ## Only into an empty folder
 *
 * A file that already exists in the new location is never overwritten. Someone who has already
 * launched the renamed app and signed in has newer state than the old folder holds, and a
 * migration that ran twice would put a stale session back over a fresh one.
 */

import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export interface AdoptOptions {
  /** The old app's userData directory — appData/valuuttaloki. */
  from: string;
  /** The new one, from `app.getPath('userData')`. */
  to: string;
  /**
   * What to carry across, as (old name, new name). The database is renamed on the way; the
   * settings file keeps its name.
   *
   * `-wal` and `-shm` are SQLite's write-ahead log and shared-memory index. They are only
   * meaningful next to their database, and a copy taken without them can be missing the most
   * recent commits — which for this app is the most recent snapshots, the ones someone would
   * notice first.
   */
  files?: ReadonlyArray<readonly [string, string]>;
  /** Injected for the tests; defaults to the real filesystem. */
  fs?: {
    exists: (path: string) => boolean;
    copy: (from: string, to: string) => void;
    mkdir: (path: string) => void;
  };
}

export const DEFAULT_FILES = [
  ['settings.json', 'settings.json'],
  ['valuuttaloki.db', 'what-remains.db'],
  ['valuuttaloki.db-wal', 'what-remains.db-wal'],
  ['valuuttaloki.db-shm', 'what-remains.db-shm'],
] as const;

export interface AdoptResult {
  /** New-directory names that were written, in the order they were copied. */
  copied: string[];
  /** Why nothing was copied, when nothing was. */
  skipped: 'no-old-directory' | 'already-populated' | null;
}

export function adoptOldData(options: AdoptOptions): AdoptResult {
  const io = options.fs ?? {
    exists: existsSync,
    copy: (from: string, to: string) => copyFileSync(from, to),
    mkdir: (path: string) => {
      mkdirSync(path, { recursive: true });
    },
  };
  const files = options.files ?? DEFAULT_FILES;

  if (options.from === options.to || !io.exists(options.from)) {
    return { copied: [], skipped: 'no-old-directory' };
  }

  // Settings are the marker for "this install has been used". The database alone is not: the
  // migrator creates an empty one before anything has been configured, so keying off it would
  // make the migration skip itself on the very first launch it exists for.
  if (io.exists(join(options.to, 'settings.json'))) {
    return { copied: [], skipped: 'already-populated' };
  }

  io.mkdir(options.to);

  const copied: string[] = [];
  for (const [oldName, newName] of files) {
    const source = join(options.from, oldName);
    const target = join(options.to, newName);
    if (!io.exists(source) || io.exists(target)) continue;
    io.copy(source, target);
    copied.push(newName);
  }

  return { copied, skipped: null };
}
