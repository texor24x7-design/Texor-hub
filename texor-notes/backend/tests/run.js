/**
 * Runs the end-to-end suites against a throwaway server and a throwaway
 * database.
 *
 * The suites wipe collections, so they must never see the database you develop
 * against. This runner is what makes that structurally true rather than a rule
 * someone has to remember:
 *
 *   · the Mongo URI is rewritten to `<yourdb>_test`, and the suites refuse to
 *     start unless the name ends that way
 *   · a second API process is started on its own port, so the dev server you
 *     already have running is untouched
 *   · the test database is dropped afterwards, whether the run passed or failed
 *
 *   npm test
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { once } from 'node:events';
import mongoose from 'mongoose';
import { connectForTests } from './db.mjs';

const TEST_PORT = 4104;
const TEST_API = `http://localhost:${TEST_PORT}`;

function testUri(uri) {
  if (!uri) {
    console.error('MONGODB_URI is not set. Run with --env-file=.env');
    process.exit(1);
  }

  const url = new URL(uri);
  const name = url.pathname.replace(/^\//, '');

  if (!name) {
    console.error('MONGODB_URI has no database name, so a test one cannot be derived from it.');
    process.exit(1);
  }
  // Re-running the runner against its own output must not give `notes_test_test`.
  if (name.endsWith('_test')) return url.toString();

  url.pathname = `/${name}_test`;
  return url.toString();
}

/**
 * Refuse to start if a previous run is still up.
 *
 * Two runners share a port and a database, and the second one fails somewhere
 * deep in a suite with an assertion that looks like a real bug. Saying so here
 * costs one request and saves that hunt.
 */
async function assertPortFree() {
  try {
    await fetch(`${TEST_API}/api/health`, { signal: AbortSignal.timeout(1500) });
  } catch {
    return; // Nothing listening, which is what we want.
  }

  console.error(
    `\n  Something is already serving ${TEST_API}.\n` +
    `  Another \`npm test\` is probably still running — wait for it, or stop it.\n`,
  );
  process.exit(1);
}

await assertPortFree();

const uri = testUri(process.env.MONGODB_URI);
const dbName = new URL(uri).pathname.replace(/^\//, '');

console.log(`\n  test database : ${dbName}`);
console.log(`  test api      : ${TEST_API}\n`);

const server = spawn(
  process.execPath,
  ['src/server.js'],
  {
    env: {
      ...process.env,
      MONGODB_URI: uri,
      PORT: String(TEST_PORT),
      LOG_LEVEL: 'error',
      // A key is only ever trusted because a deployment said so. The suites
      // that exercise that path set it themselves, on a key they create.
      TRUSTED_KEY_EMAILS: 'trusted@texor.app',
      APP_ORIGIN: TEST_API,
      CORS_ORIGINS: TEST_API,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);

let serverOutput = '';
server.stdout.on('data', (chunk) => { serverOutput += chunk; });
server.stderr.on('data', (chunk) => { serverOutput += chunk; });

async function waitForHealth(attempts = 40) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (server.exitCode !== null) {
      console.error('The test server exited before it was ready:\n', serverOutput);
      process.exit(1);
    }
    try {
      const response = await fetch(`${TEST_API}/api/health`);
      if (response.ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => { setTimeout(resolve, 500); });
  }

  console.error('The test server never became healthy:\n', serverOutput);
  server.kill('SIGKILL');
  process.exit(1);
}

function runSuite(file, cwd = process.cwd()) {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [`tests/${file}`],
      { cwd, env: { ...process.env, MONGODB_URI: uri, TEST_API }, stdio: 'inherit' },
    );
    child.on('exit', (exitCode) => resolve(exitCode ?? 1));
  });
}

/**
 * The frontend's own suites, run from its directory so they can reach its
 * `node_modules` — React, and the swc that turns JSX into something Node will
 * load.
 */
const FRONTEND = new URL('../../frontend/', import.meta.url).pathname.replace(/\/$/, '');

async function teardown() {
  server.kill('SIGTERM');
  // Give the workers a moment to go with it, then insist.
  await Promise.race([once(server, 'exit'), new Promise((r) => { setTimeout(r, 4000); })]);
  if (server.exitCode === null) server.kill('SIGKILL');

  try {
    // The same bounded retry the suites use: a cluster that blinks during
    // teardown should not leave a test database behind, and should not fail a
    // deployment either.
    await connectForTests(uri);
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    console.log(`  dropped ${dbName}\n`);
  } catch (error) {
    console.error(`  could not drop ${dbName}: ${error.message}\n`);
  }
}

let failures = 0;

/**
 * Pure logic first, before the server is even waited on.
 *
 * These need no database and no HTTP, so running them up front means a broken
 * rule fails in a second rather than after a full media negotiation.
 */
for (const file of ['notes-doc.test.mjs', 'access.test.mjs']) {
  failures += (await runSuite(file)) === 0 ? 0 : 1;
}

/**
 * Does every component still render?
 *
 * `next build` accepts a component that throws the moment it is rendered — a
 * dependency array is valid syntax whatever is inside it — so the build alone
 * is not evidence the app works. One render each, no browser needed.
 */
if (existsSync(`${FRONTEND}/tests`)) {
  for (const file of [
    'render.test.mjs', 'autosave.test.mjs', 'note-export.test.mjs', 'styles.test.mjs',
  ]) {
    failures += (await runSuite(file, FRONTEND)) === 0 ? 0 : 1;
  }
}

await waitForHealth();

for (const file of ['notes.test.mjs', 'labels.test.mjs', 'sharing.test.mjs', 'public-api.test.mjs']) {
  failures += (await runSuite(file)) === 0 ? 0 : 1;
}

await teardown();

if (failures > 0) {
  console.error(`  ${failures} suite${failures === 1 ? '' : 's'} failed\n`);
  process.exit(1);
}

console.log('  all suites passed\n');
process.exit(0);
