/**
 * Apply Prisma's migrations without the Prisma CLI.
 *
 * `prisma migrate deploy` needs @prisma/engines, which is 36 MB of platform binaries whose only
 * job in a shipped application is to run a handful of CREATE TABLE statements once at startup.
 * Bundling that into a desktop app — three platforms, every release — to execute SQL that is
 * already sitting in the repository as plain text is a poor trade.
 *
 * So this reads the same `prisma/migrations/*​/migration.sql` files and applies them with
 * `node:sqlite`, which Node 22 ships in the box.
 *
 * The important property is that it is not a *different* migration system. It writes the same
 * `_prisma_migrations` bookkeeping rows, with the same checksums, so a database migrated here
 * and a database migrated by the CLI are indistinguishable — `prisma migrate status` accepts
 * either, and a developer can keep using `pnpm db:migrate` while the shipped app uses this.
 * The tests assert exactly that rather than trusting the claim.
 */

import { createHash, randomUUID } from 'node:crypto';
import { readdirSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/** Prisma's own bookkeeping table, verbatim. Matching it is the whole point. */
const BOOKKEEPING = `
CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
  "id"                    TEXT PRIMARY KEY NOT NULL,
  "checksum"              TEXT NOT NULL,
  "finished_at"           DATETIME,
  "migration_name"        TEXT NOT NULL,
  "logs"                  TEXT,
  "rolled_back_at"        DATETIME,
  "started_at"            DATETIME NOT NULL DEFAULT current_timestamp,
  "applied_steps_count"   INTEGER UNSIGNED NOT NULL DEFAULT 0
)`;

export interface MigrationResult {
  applied: string[];
  alreadyApplied: string[];
}

/** Prisma checksums the file's bytes with SHA-256 and stores it lowercase hex. */
export function checksum(sql: string): string {
  return createHash('sha256').update(sql, 'utf8').digest('hex');
}

/**
 * Migration directories in the order Prisma applies them.
 *
 * The names are timestamp-prefixed, so lexicographic order is chronological order. Anything
 * without a migration.sql is ignored rather than guessed at.
 */
export function listMigrations(migrationsDir: string): Array<{ name: string; sql: string }> {
  return readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .flatMap((name) => {
      try {
        return [{ name, sql: readFileSync(join(migrationsDir, name, 'migration.sql'), 'utf8') }];
      } catch {
        return [];
      }
    });
}

/**
 * Bring `databaseFile` up to date with `migrationsDir`.
 *
 * Each migration runs inside a transaction together with its bookkeeping row, so a failure
 * halfway through leaves the database at the last complete migration rather than in a state no
 * migration describes.
 */
export function migrate(databaseFile: string, migrationsDir: string): MigrationResult {
  mkdirSync(dirname(databaseFile), { recursive: true });

  const db = new DatabaseSync(databaseFile);
  try {
    // Foreign keys are off by default in SQLite and Prisma's schemas assume them on.
    db.exec('PRAGMA foreign_keys = ON');
    db.exec(BOOKKEEPING);

    const done = new Set(
      db
        .prepare('SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL')
        .all()
        .map((row) => String((row as { migration_name: unknown }).migration_name)),
    );

    const applied: string[] = [];
    const alreadyApplied: string[] = [];

    for (const migration of listMigrations(migrationsDir)) {
      if (done.has(migration.name)) {
        alreadyApplied.push(migration.name);
        continue;
      }

      db.exec('BEGIN');
      try {
        db.exec(migration.sql);
        db.prepare(
          `INSERT INTO _prisma_migrations
             (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
           VALUES (?, ?, current_timestamp, ?, NULL, NULL, current_timestamp, 1)`,
        ).run(randomUUID(), checksum(migration.sql), migration.name);
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw new Error(`migration ${migration.name} failed: ${(error as Error).message}`, {
          cause: error,
        });
      }
      applied.push(migration.name);
    }

    return { applied, alreadyApplied };
  } finally {
    db.close();
  }
}
