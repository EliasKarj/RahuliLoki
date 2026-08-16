/**
 * The command-line entry point: start the server, then wait for a signal.
 *
 * All the wiring lives in server.ts so the desktop shell can run the same thing in-process.
 * What is left here is the part that only makes sense for a process someone launched from a
 * terminal — reading the real environment, printing a fatal error, exiting on SIGTERM.
 *
 * The process is deliberately willing to start in a broken state. A missing POESESSID leaves
 * the API and the existing history perfectly usable, and /api/health says exactly what is
 * wrong. Refusing to boot would take the charts down over a credential the operator is
 * probably already in the middle of replacing.
 */

import { describeError } from './lib/logger.ts';
import { startServer } from './server.ts';

const server = await startServer().catch((error: unknown) => {
  console.error('failed to start:', describeError(error).message);
  process.exit(1);
});

let shuttingDown = false;
const shutdown = async (signal: string): Promise<void> => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.error(`shutting down on ${signal}`);
  await server.close();
  process.exit(0);
};

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
