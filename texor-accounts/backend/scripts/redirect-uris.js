/**
 * Lists, adds and removes a client's registered redirect URIs.
 *
 *   node --env-file=.env scripts/redirect-uris.js talk
 *   node --env-file=.env scripts/redirect-uris.js talk --add https://api.talk.texor.app/api/auth/callback
 *   node --env-file=.env scripts/redirect-uris.js talk --add https://talk.texor.app --logout
 *   node --env-file=.env scripts/redirect-uris.js talk --remove <uri> [--logout]
 *
 * ── Two separate lists ──
 *
 * `redirect_uris` is where the provider sends somebody after **signing in**;
 * `post_logout_redirect_uris` is where it sends them after **signing out**.
 * They are registered independently and it is entirely possible — and a common
 * way to lose an afternoon — to update one for production and leave the other
 * pointing at a laptop. `--logout` selects the second list.
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

const args = process.argv.slice(2);
const logout = args.includes('--logout');
const [clientId, flag, uri] = args.filter((entry) => entry !== '--logout');

/** Which of the two lists this invocation is about. */
const field = logout ? 'postLogoutRedirectUris' : 'redirectUris';
const label = logout ? 'post-logout redirect URI' : 'redirect URI';

if (!clientId) {
  console.error(
    'Usage: node --env-file=.env scripts/redirect-uris.js <clientId> [--add|--remove <uri>] [--logout]',
  );
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
    console.error(`A ${label} cannot contain a fragment.`);
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

    if (client[field].includes(uri)) {
      console.log(`\nAlready registered — nothing to do.\n`);
    } else {
      client[field].push(uri);
      /**
       * Both spellings, for the logout list only.
       *
       * The provider matches these as exact strings, and whether a product
       * sends a trailing slash depends on how its own origin was written down.
       * Registering both removes a failure that is invisible in the URL bar.
       */
      if (logout) {
        const withSlash = uri.endsWith('/') ? uri.slice(0, -1) : `${uri}/`;
        if (!client[field].includes(withSlash)) client[field].push(withSlash);
      }
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
    const before = client[field].length;
    client[field] = client[field].filter((entry) => entry !== uri);

    if (client[field].length === before) {
      console.log(`\nNot registered — nothing to remove.\n`);
    } else if (!logout && client[field].length === 0) {
      console.error('\nRefusing to remove the last redirect URI — the client could never sign anyone in.\n');
      process.exit(1);
    } else {
      await client.save();
      console.log(`\nRemoved from ${clientId}: ${uri}\n`);
    }
  }

  // Always print both lists: the whole point of this script is that people
  // update one and forget the other.
  const fresh = await Client.findOne({ clientId })
    .select('redirectUris postLogoutRedirectUris')
    .lean();

  console.log(`${clientId} — sign-in redirect URIs:`);
  for (const entry of fresh.redirectUris) console.log(`   ${entry}`);
  if (fresh.redirectUris.length === 0) console.log('   (none)');

  console.log(`\n${clientId} — post-logout redirect URIs:`);
  for (const entry of fresh.postLogoutRedirectUris) console.log(`   ${entry}`);
  if (fresh.postLogoutRedirectUris.length === 0) {
    console.log('   (none — signing out will fail with "post_logout_redirect_uri not registered")');
  }
  console.log('');
} finally {
  await mongoose.disconnect();
}
