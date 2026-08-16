/**
 * Prove that the standalone migrator and the Prisma CLI produce the same database.
 *
 * The migrator exists so a shipped desktop build does not have to carry 36 MB of Prisma engines
 * to run a few CREATE TABLEs. That is only a good trade if the result is genuinely
 * interchangeable — otherwise it is a second, divergent migration system, which is much worse
 * than 36 MB.
 *
 * So this does not test the migrator against my idea of what Prisma writes. It migrates a
 * database with the migrator, then hands it to the real CLI and asks two questions:
 *
 *   migrate status  — do you consider this database up to date?
 *   migrate diff    — does its schema differ from schema.prisma at all?
 *
 * Run by CI. Anything other than "no" to the second question is a bug in the migrator.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { migrate } from '../dist/lib/migrate.js';

const serverDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const migrations = join(serverDir, 'prisma', 'migrations');
const schema = join(serverDir, 'prisma', 'schema.prisma');

const work = mkdtempSync(join(tmpdir(), 'valuuttaloki-verify-'));
const dbFile = join(work, 'verify.db');

function prisma(args, env = {}) {
  return spawnSync('pnpm', ['exec', 'prisma', ...args], {
    cwd: serverDir,
    encoding: 'utf8',
    env: { ...process.env, DATABASE_URL: `file:${dbFile}`, ...env },
  });
}

let failures = 0;
const check = (label, passed, detail = '') => {
  console.log(`${passed ? '  ok  ' : ' FAIL '} ${label}${detail ? `\n        ${detail.trim()}` : ''}`);
  if (!passed) failures += 1;
};

try {
  const result = migrate(dbFile, migrations);
  check(`migrator applied ${result.applied.length} migration(s)`, result.applied.length > 0);

  const status = prisma(['migrate', 'status', '--schema', schema]);
  const statusText = `${status.stdout ?? ''}${status.stderr ?? ''}`;
  check(
    'Prisma CLI reports the database up to date',
    /up to date|No pending migrations/i.test(statusText),
    statusText,
  );

  // The real question: does the resulting schema match schema.prisma exactly?
  const diff = prisma([
    'migrate',
    'diff',
    '--from-url',
    `file:${dbFile}`,
    '--to-schema-datamodel',
    schema,
    '--exit-code',
  ]);
  const diffText = `${diff.stdout ?? ''}${diff.stderr ?? ''}`;
  // --exit-code: 0 means no difference, 2 means there is one.
  check('schema matches schema.prisma with no drift', diff.status === 0, diffText);

  // Running it again must be a no-op, or a restart would try to re-apply everything.
  const again = migrate(dbFile, migrations);
  check('a second run applies nothing', again.applied.length === 0);
} finally {
  rmSync(work, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed: the migrator and the Prisma CLI disagree.`);
  process.exit(1);
}
console.log('\nThe migrator and the Prisma CLI agree.');
