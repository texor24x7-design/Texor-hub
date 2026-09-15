/**
 * The one place a test suite is allowed to open a database.
 *
 * Two jobs, and they were previously copy-pasted into every suite that needed
 * them — which is how a safety check stops being one, because the fifth copy is
 * the one somebody forgets.
 *
 *   · **refuse to run against anything but a `_test` database.** These suites
 *     wipe collections. This one once ran against a developer's real database
 *     and deleted a meeting they had just created.
 *   · **survive a database that is briefly unavailable**, rather than failing a
 *     deployment over it.
 */
import mongoose from 'mongoose';

/**
 * A hard stop, not a convention.
 *
 * `npm test` builds a `_test` URI; running a suite directly against `.env` will
 * refuse here rather than destroy anything.
 */
export function assertTestDatabase(uri) {
  const name = (() => {
    try { return new URL(uri).pathname.replace(/^\//, ''); } catch { return ''; }
  })();

  if (!name.endsWith('_test')) {
    console.error(
      `\n  REFUSING TO RUN.\n` +
      `  This suite deletes collections and the target database is "${name || '(unparsed)'}".\n` +
      `  It must end in _test. Use \`npm test\`, which creates an isolated one.\n`,
    );
    process.exit(1);
  }

  return uri;
}

/**
 * Connect, with a few attempts.
 *
 * A hosted cluster is not always available the instant it is asked. A replica
 * set mid-election reports `ReplicaSetNoPrimary` and every member as `Unknown`,
 * and it is over in seconds — but a single attempt turns that few seconds into
 * a failed deployment, which is what happened.
 *
 * The retry is deliberately small: three tries over roughly ten seconds. It is
 * there to ride out a blip, not to paper over a database that is genuinely
 * unreachable, and a suite that hangs for minutes retrying is worse than one
 * that fails quickly and says so.
 */
export async function connectForTests(uri, { attempts = 3, gapMs = 2000 } = {}) {
  assertTestDatabase(uri);

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await mongoose.connect(uri, {
        // Shorter than the 30s default: a suite should not sit in silence for
        // half a minute before telling anybody what is wrong.
        serverSelectionTimeoutMS: 8000,
        // Suites are sequential and do one thing at a time. The default pool of
        // 100 is a hundred connections per suite that nothing ever uses, on a
        // cluster that is also serving the application.
        maxPoolSize: 5,
      });
      return mongoose.connection;
    } catch (error) {
      if (attempt === attempts) {
        console.error(
          `\n  Could not reach the test database after ${attempts} attempts.\n` +
          `  ${error.message}\n`,
        );
        throw error;
      }

      console.log(`  database not ready (attempt ${attempt}/${attempts}), retrying…`);
      await new Promise((resolve) => { setTimeout(resolve, gapMs * attempt); });
    }
  }

  // Unreachable: the loop either returns or throws.
  return null;
}

export default { assertTestDatabase, connectForTests };
