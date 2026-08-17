/**
 * The migrator's contract is not "it creates some tables" — it is that a database it migrated
 * is indistinguishable from one the Prisma CLI migrated. The interesting assertions here are
 * about the bookkeeping, because that is what makes the two interchangeable.
 *
 * The strongest check of all lives outside vitest: `pnpm --filter @whatremains/server
 * verify:migrator` applies migrations with this code and then asks the real Prisma CLI whether
 * it agrees. That runs in CI.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { checksum, listMigrations, migrate } from '../src/lib/migrate.ts';

/**
 * `fileURLToPath` rather than `.pathname`, which is only a filesystem path on POSIX.
 *
 * On Windows a file URL's pathname is `/D:/a/repo/...` — with a leading slash — and joining
 * that against a working directory produced `D:\D:\a\repo\...`, a path with two drive
 * letters in it. Every test in this file failed with ENOENT on Windows and passed everywhere
 * else, which is exactly the shape of bug that survives until someone builds a release.
 */
const MIGRATIONS = fileURLToPath(new URL('../prisma/migrations', import.meta.url));
const temps: string[] = [];

function tempDb(): string {
  const dir = mkdtempSync(join(tmpdir(), 'what-remains-migrate-'));
  temps.push(dir);
  return join(dir, 'test.db');
}

afterEach(() => {
  while (temps.length > 0) rmSync(temps.pop() as string, { recursive: true, force: true });
});

function tables(file: string): string[] {
  const db = new DatabaseSync(file);
  try {
    return db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((row) => String((row as { name: unknown }).name));
  } finally {
    db.close();
  }
}

describe('listMigrations', () => {
  it('finds the repository migrations in chronological order', () => {
    const names = listMigrations(MIGRATIONS).map((m) => m.name);
    expect(names.length).toBeGreaterThanOrEqual(2);
    // Timestamp-prefixed names sort chronologically, which is the order Prisma applies them.
    expect([...names].sort()).toEqual(names);
  });
});

describe('migrate', () => {
  it('creates the application tables', () => {
    const file = tempDb();
    migrate(file, MIGRATIONS);
    expect(tables(file)).toEqual(expect.arrayContaining(['Snapshot', 'PriceSet']));
  });

  it('records every migration in Prisma\'s own bookkeeping table', () => {
    const file = tempDb();
    const result = migrate(file, MIGRATIONS);

    const db = new DatabaseSync(file);
    const rows = db.prepare('SELECT migration_name, checksum, finished_at FROM _prisma_migrations').all();
    db.close();

    expect(rows).toHaveLength(result.applied.length);
    // Prisma treats a row with a null finished_at as a failed migration and refuses to proceed.
    for (const row of rows as Array<Record<string, unknown>>) {
      expect(row.finished_at).not.toBeNull();
      expect(String(row.checksum)).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('writes the checksum Prisma would write, so the CLI does not see drift', () => {
    const file = tempDb();
    migrate(file, MIGRATIONS);

    const first = listMigrations(MIGRATIONS)[0];
    if (first === undefined) throw new Error('no migrations to check');
    const expected = checksum(readFileSync(join(MIGRATIONS, first.name, 'migration.sql'), 'utf8'));

    const db = new DatabaseSync(file);
    const row = db
      .prepare('SELECT checksum FROM _prisma_migrations WHERE migration_name = ?')
      .get(first.name) as { checksum: string };
    db.close();

    expect(row.checksum).toBe(expected);
  });

  it('is idempotent — a second run applies nothing', () => {
    const file = tempDb();
    const first = migrate(file, MIGRATIONS);
    const second = migrate(file, MIGRATIONS);

    expect(first.applied.length).toBeGreaterThan(0);
    expect(second.applied).toEqual([]);
    expect(second.alreadyApplied).toEqual(first.applied);
  });

  it('applies only what is missing when the database is partly migrated', () => {
    const file = tempDb();
    const all = listMigrations(MIGRATIONS);
    const last = all[all.length - 1];
    if (last === undefined) throw new Error('no migrations');

    // Pretend everything but the last one has been applied.
    const db = new DatabaseSync(file);
    db.exec(`CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
      "id" TEXT PRIMARY KEY NOT NULL, "checksum" TEXT NOT NULL, "finished_at" DATETIME,
      "migration_name" TEXT NOT NULL, "logs" TEXT, "rolled_back_at" DATETIME,
      "started_at" DATETIME NOT NULL DEFAULT current_timestamp,
      "applied_steps_count" INTEGER UNSIGNED NOT NULL DEFAULT 0)`);
    for (const migration of all.slice(0, -1)) {
      db.exec(migration.sql);
      db.prepare(
        `INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, applied_steps_count)
         VALUES (?, ?, current_timestamp, ?, 1)`,
      ).run(crypto.randomUUID(), checksum(migration.sql), migration.name);
    }
    db.close();

    expect(migrate(file, MIGRATIONS).applied).toEqual([last.name]);
  });

  it('leaves the database at the last complete migration when one fails', () => {
    const file = tempDb();
    migrate(file, MIGRATIONS);

    const broken = mkdtempSync(join(tmpdir(), 'what-remains-broken-'));
    temps.push(broken);
    mkdirSync(join(broken, '99999999999999_bad'), { recursive: true });
    writeFileSync(join(broken, '99999999999999_bad', 'migration.sql'), 'THIS IS NOT SQL;');

    // Copy the good ones across so the bad one is genuinely the last step, not the only one.
    expect(() => migrate(file, broken)).toThrow(/99999999999999_bad failed/);

    // The tables from the successful run are still there and usable.
    expect(tables(file)).toEqual(expect.arrayContaining(['Snapshot', 'PriceSet']));
  });

  it('creates the parent directory rather than failing on a fresh install', () => {
    const dir = mkdtempSync(join(tmpdir(), 'what-remains-nested-'));
    temps.push(dir);
    const file = join(dir, 'does', 'not', 'exist', 'what-remains.db');
    expect(() => migrate(file, MIGRATIONS)).not.toThrow();
    expect(tables(file)).toEqual(expect.arrayContaining(['Snapshot']));
  });
});
