/**
 * Runs the suites against a throwaway API process and a throwaway database.
 *
 * The suites wipe collections, so they must never see the database you develop
 * against:
 *
 *   · the Mongo URI is rewritten to `<yourdb>_test`, and `db.mjs` refuses to
 *     connect to anything whose name does not end that way
 *   · a second API process is started on its own port, so a running dev server
 *     is untouched
 *   · the test database is dropped afterwards, pass or fail
 *
 *   npm test                 every suite
 *   npm test -- tax money    only suites whose file name contains a word
 */
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import mongoose from 'mongoose';
import { connectForTests } from './db.mjs';

const TEST_PORT = Number(process.env.TEST_PORT) || 4101;
const TEST_API = `http://localhost:${TEST_PORT}`;

/** Pure logic — no server, no database. */
const UNIT = ['money.test.mjs', 'india.test.mjs', 'tax.test.mjs', 'render.test.mjs', 'signature.test.mjs', 'ratelimit.test.mjs', 'attendance.test.mjs', 'icons.test.mjs', 'pay.test.mjs', 'components.test.mjs'];
/** End to end, against the spawned API. */
const E2E = ['foundation.test.mjs', 'documents.test.mjs', 'operations.test.mjs', 'industries.test.mjs', 'sweep.test.mjs', 'notes.test.mjs', 'razorpay.test.mjs', 'ledger.test.mjs', 'packages.test.mjs', 'people.test.mjs', 'customise.test.mjs'];

const only = process.argv.slice(2);
const selected = (file) => only.length === 0 || only.some((word) => file.includes(word));

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
  if (name.endsWith('_test')) return url.toString();
  url.pathname = `/${name}_test`;
  return url.toString();
}

async function assertPortFree() {
  try {
    await fetch(`${TEST_API}/api/health`, { signal: AbortSignal.timeout(1500) });
  } catch {
    return;
  }
  console.error(`\n  Something is already serving ${TEST_API}.\n  Another \`npm test\` is probably still running.\n`);
  process.exit(1);
}

function runSuite(file, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [`tests/${file}`], { env: { ...process.env, ...env }, stdio: 'inherit' });
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

let failures = 0;

for (const file of UNIT.filter(selected)) failures += (await runSuite(file)) === 0 ? 0 : 1;

const e2e = E2E.filter(selected);
if (e2e.length) {
  await assertPortFree();
  const uri = testUri(process.env.MONGODB_URI);
  const dbName = new URL(uri).pathname.slice(1);
  console.log(`\n  test database : ${dbName}\n  test api      : ${TEST_API}\n`);

  // Start clean: a previous run killed mid-way may have left data behind.
  await connectForTests(uri);
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();

  // Google credentials in a developer's .env must not change what the suites see:
  // whether Gmail is on is a property of the deployment, not of this machine.
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI, ...cleanEnv } = process.env;

  const server = spawn(process.execPath, ['src/server.js'], {
    env: { ...cleanEnv, MONGODB_URI: uri, PORT: String(TEST_PORT), LOG_LEVEL: 'error', DELIVERY_DRY_RUN: '1', SWEEP_INTERVAL_MINUTES: '0', APP_ORIGIN: 'http://localhost:3101', CORS_ORIGINS: 'http://localhost:3101' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  server.stdout.on('data', (c) => { output += c; });
  server.stderr.on('data', (c) => { output += c; });

  let healthy = false;
  for (let attempt = 0; attempt < 60 && !healthy; attempt += 1) {
    if (server.exitCode !== null) break;
    try { healthy = (await fetch(`${TEST_API}/api/health`)).ok; } catch { /* not yet */ }
    if (!healthy) await new Promise((r) => { setTimeout(r, 500); });
  }

  if (!healthy) {
    console.error('The test server never became healthy:\n', output);
    failures += 1;
  } else {
    for (const file of e2e) failures += (await runSuite(file, { MONGODB_URI: uri, TEST_API })) === 0 ? 0 : 1;
  }

  server.kill('SIGTERM');
  await Promise.race([once(server, 'exit'), new Promise((r) => { setTimeout(r, 4000); })]);
  if (server.exitCode === null) server.kill('SIGKILL');
  if (output.includes('"level":"error"')) console.log('\n  server errors during the run:\n', output.split('\n').filter((l) => l.includes('"level":"error"')).slice(0, 10).map((l) => l.slice(0, 600)).join('\n'));

  try {
    await connectForTests(uri);
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    console.log(`  dropped ${dbName}\n`);
  } catch (error) {
    console.error(`  could not drop ${dbName}: ${error.message}\n`);
  }
}

if (failures > 0) {
  console.error(`  ${failures} suite${failures === 1 ? '' : 's'} failed\n`);
  process.exit(1);
}
console.log('  all suites passed\n');
process.exit(0);
