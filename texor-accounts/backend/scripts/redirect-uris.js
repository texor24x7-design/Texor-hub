/**
 * Lists, adds and removes a client's registered redirect URIs.
 *
 *   node --env-file=.env scripts/redirect-uris.js talk
 *   node --env-file=.env scripts/redirect-uris.js talk --add http://localhost:4002/api/auth/callback
 *   node --env-file=.env scripts/redirect-uris.js talk --remove http://localhost:4002/api/auth/callback
 *
 * A redirect URI is matched by the provider as an **exact string** — scheme,
 * host, port, path, trailing slash and all. There is no prefix matching and no
 * wildcards, by design: a loose match is how authorization codes get delivered
 * to somewhere they should not. So a product that runs in more than one place
 * needs every one of them registered here, and "it works in production but not
 * locally" is nearly always this list.
 */
import mongoose from 'mongoose';
import env from '../src/config/env.js';
import Client from '../src/models/Client.js';

const [clientId, flag, uri] = process.argv.slice(2);

if (!clientId) {
  console.error('Usage: node --env-file=.env scripts/redirect-uris.js <clientId> [--add|--remove <uri>]');
  process.exit(1);
}

if (flag && !['--add', '--remove'].includes(flag)) {
  console.error(`Unknown option "${flag}". Use --add or --remove.`);
  process.exit(1);
}

if (flag && !uri) {
  console.error(`${flag} needs a URI.`);
  process.exit(1);
}

/**
 * Rejected here rather than by the provider at sign-in time.
 *
 * A URI with a fragment, or a relative one, is accepted by this script's
 * `$addToSet` quite happily and then never matches anything — the failure shows
 * up later as the same `invalid_redirect_uri` this script exists to fix.
 */
function assertUsable(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    console.error(`"${value}" is not an absolute URL.`);
    process.exit(1);
  }

  if (parsed.hash) {
    console.error('A redirect URI cannot contain a fragment.');
    process.exit(1);
  }

  const local = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  if (parsed.protocol !== 'https:' && !local) {
    console.error(`Refusing to register a non-HTTPS URI for ${parsed.hostname}.`);
    process.exit(1);
  }

  return { parsed, local };
}

await mongoose.connect(env.MONGODB_URI);

try {
  const client = await Client.findOne({ clientId }).exec();

  if (!client) {
    const all = await Client.find().select('clientId').lean();
    console.error(`No client "${clientId}". Registered: ${all.map((c) => c.clientId).join(', ')}`);
    process.exit(1);
  }

  if (flag === '--add') {
    const { local } = assertUsable(uri);

    if (client.redirectUris.includes(uri)) {
      console.log(`\nAlready registered — nothing to do.\n`);
    } else {
      client.redirectUris.push(uri);
      await client.save();
      console.log(`\nAdded to ${clientId}: ${uri}`);
      if (local) {
        console.log(
          '\nNote: this client now accepts a redirect to a local address. With PKCE\n' +
          'in use that is a small exposure, but it is not nothing — remove it from\n' +
          'the production client once you no longer need local sign-in against it.',
        );
      }
      console.log('');
    }
  }

  if (flag === '--remove') {
    const before = client.redirectUris.length;
    client.redirectUris = client.redirectUris.filter((entry) => entry !== uri);

    if (client.redirectUris.length === before) {
      console.log(`\nNot registered — nothing to remove.\n`);
    } else if (client.redirectUris.length === 0) {
      console.error('\nRefusing to remove the last redirect URI — the client could never sign anyone in.\n');
      process.exit(1);
    } else {
      await client.save();
      console.log(`\nRemoved from ${clientId}: ${uri}\n`);
    }
  }

  const fresh = await Client.findOne({ clientId }).select('redirectUris').lean();
  console.log(`${clientId} redirect URIs:`);
  for (const entry of fresh.redirectUris) console.log(`   ${entry}`);
  console.log('');
} finally {
  await mongoose.disconnect();
}
