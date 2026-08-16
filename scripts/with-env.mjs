/**
 * Run a command with the workspace-root .env loaded.
 *
 * The Prisma CLI looks for a .env next to the schema and in its working directory, and this is
 * a workspace: the one .env lives at the repo root while `prisma` runs from `server/`. So every
 * documented database command — `pnpm db:migrate`, `db:deploy`, `db:studio` — failed with
 * "Environment variable not found: DATABASE_URL" for anyone following the README, even though
 * their .env was exactly where the README told them to put it.
 *
 * The server itself never had this problem: it boots through `node --env-file-if-exists=../.env`.
 * This shim gives the Prisma CLI the same treatment rather than asking people to keep a second
 * copy of the credential file inside server/.
 *
 *   node ../scripts/with-env.mjs prisma migrate deploy
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envFile = resolve(root, '.env');

// Absent is fine: CI and Docker set DATABASE_URL in the real environment instead.
if (existsSync(envFile)) process.loadEnvFile(envFile);

const [command, ...args] = process.argv.slice(2);
if (command === undefined) {
  console.error('usage: node scripts/with-env.mjs <command> [args...]');
  process.exit(2);
}

const result = spawnSync(command, args, {
  stdio: 'inherit',
  // On Windows the package binaries are .cmd shims, which execvp cannot run directly.
  shell: process.platform === 'win32',
});

if (result.error) {
  console.error(`failed to run ${command}:`, result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
