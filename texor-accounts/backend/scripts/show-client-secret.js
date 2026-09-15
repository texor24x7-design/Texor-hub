/**
 * Prints a registered client's secret, so a product can be reconfigured without
 * rotating — and without breaking every other deployment that still holds the
 * current one.
 *
 *   node --env-file=.env scripts/show-client-secret.js talk
 *
 * This is possible because client secrets are stored under AES-256-GCM with the
 * key held outside the database, not hashed. That is a deliberate choice: a
 * hash would mean the only way to recover from "which secret does production
 * have?" is to rotate, and rotating logs out every deployment of that product
 * at once — including the ones that were working.
 *
 * It needs both the database and SECRET_ENCRYPTION_KEY, so it grants nothing to
 * anyone who does not already hold both. Output goes to stdout: redirect it to
 * a secrets manager rather than leaving it in your shell history.
 */
import mongoose from 'mongoose';
import env from '../src/config/env.js';
import Client from '../src/models/Client.js';
import { decryptSecret } from '../src/utils/crypto.js';

const clientId = process.argv[2];

if (!clientId) {
  console.error('Usage: node --env-file=.env scripts/show-client-secret.js <clientId>');
  process.exit(1);
}

await mongoose.connect(env.MONGODB_URI);

try {
  // The envelope is `select: false` on the model, so it has to be asked for.
  const client = await Client.findOne({ clientId }).select('+clientSecretEncrypted').exec();

  if (!client) {
    const all = await Client.find().select('clientId').lean();
    console.error(`No client "${clientId}".`);
    console.error(`Registered: ${all.map((entry) => entry.clientId).join(', ') || '(none)'}`);
    process.exit(1);
  }

  if (!client.clientSecretEncrypted) {
    console.error(`"${clientId}" is a public client — it has no secret.`);
    process.exit(1);
  }

  let secret;
  try {
    secret = decryptSecret(client.clientSecretEncrypted, env.SECRET_ENCRYPTION_KEY);
  } catch {
    console.error(
      'Could not decrypt. SECRET_ENCRYPTION_KEY does not match the key this\n' +
      'secret was written with — check you are pointed at the right environment.',
    );
    process.exit(1);
  }

  console.log(`\n# ${clientId} — paste into that product's backend .env\n`);
  console.log(`TEXOR_CLIENT_ID=${client.clientId}`);
  console.log(`TEXOR_CLIENT_SECRET=${secret}`);
  if (client.resourceIndicator) console.log(`TEXOR_RESOURCE=${client.resourceIndicator}`);
  console.log('');
  console.log(`# registered redirect URIs — TEXOR_REDIRECT_URI must be one of these exactly:`);
  for (const uri of client.redirectUris) console.log(`#   ${uri}`);
  if (client.secretRotatedAt) {
    console.log(`#\n# last rotated ${client.secretRotatedAt.toISOString()}`);
  }
  console.log('');
} finally {
  await mongoose.disconnect();
}
