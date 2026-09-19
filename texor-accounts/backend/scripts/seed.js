/**
 * Bootstraps a fresh Texor Account database.
 *
 *   npm run seed
 *
 * Creates the first administrator and registers the launch products as
 * first-party OAuth clients. Safe to re-run: existing records are left alone,
 * and secrets are only printed for clients created by this run (an existing
 * client's secret cannot be recovered — rotate it instead).
 */
import mongoose from 'mongoose';
import env from '../src/config/env.js';
import { connectDatabase } from '../src/config/db.js';
import User from '../src/models/User.js';
import Client from '../src/models/Client.js';
import { hashPassword } from '../src/utils/password.js';
import { registerClient } from '../src/services/client.service.js';

const DEV = !env.isProduction;
/**
 * In development a product's frontend and backend are two processes on two
 * ports, so the OAuth callback and the app's public URL are different origins.
 * In production they sit behind one hostname, with the API under /api.
 */
const webOrigin = (slug, port) => (DEV ? `http://localhost:${port}` : `https://${slug}.texor.app`);
const apiOrigin = (slug, port) => (DEV ? `http://localhost:${port}` : `https://${slug}.texor.app`);

const PRODUCTS = [
  {
    clientId: 'finvoice',
    clientName: 'Finvoice',
    description: 'Invoicing and billing for Texor.',
    webPort: 3001,
    apiPort: 4001,
    resourceIndicator: 'https://api.finvoice.texor.app',
  },
  {
    clientId: 'talk',
    clientName: 'Texor Talk',
    description: 'Team messaging and calls.',
    webPort: 3002,
    apiPort: 4002,
    resourceIndicator: 'https://api.talk.texor.app',
  },
  {
    clientId: 'payroll',
    clientName: 'Texor Payroll',
    description: 'Payroll runs, payslips and compliance.',
    webPort: 3003,
    apiPort: 4003,
    resourceIndicator: 'https://api.payroll.texor.app',
  },
  {
    clientId: 'notes',
    clientName: 'Texor Notes',
    description: 'Notes, labels and shared thinking.',
    webPort: 3004,
    apiPort: 4004,
    resourceIndicator: 'https://api.notes.texor.app',
  },
];

async function seedAdmin() {
  if (!env.SEED_ADMIN_EMAIL || !env.SEED_ADMIN_PASSWORD) {
    console.log('· skipping admin (SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD not set)');
    return;
  }

  const email = env.SEED_ADMIN_EMAIL.toLowerCase();
  const existing = await User.findOne({ email }).exec();

  if (existing) {
    if (!existing.roles.includes('admin')) {
      existing.roles.push('admin');
      await existing.save();
      console.log(`· promoted ${email} to admin`);
    } else {
      console.log(`· admin ${email} already exists`);
    }
    return;
  }

  await User.create({
    email,
    passwordHash: await hashPassword(env.SEED_ADMIN_PASSWORD),
    emailVerified: true,
    emailVerifiedAt: new Date(),
    name: { given: 'Texor', family: 'Admin' },
    roles: ['user', 'admin'],
  });

  console.log(`· created admin ${email}`);
}

async function seedProducts() {
  const created = [];

  for (const product of PRODUCTS) {
    const existing = await Client.findOne({ clientId: product.clientId }).exec();
    if (existing) {
      console.log(`· client "${product.clientId}" already registered`);
      continue;
    }

    const web = webOrigin(product.clientId, product.webPort);
    const api = apiOrigin(product.clientId, product.apiPort);

    const { clientSecret } = await registerClient({
      clientId: product.clientId,
      clientName: product.clientName,
      description: product.description,
      // The product's *backend* completes the code exchange, so the callback
      // points at the backend route, not at a page in the frontend.
      redirectUris: [`${api}/api/auth/callback`],
      // Both spellings of the app's home page. `post_logout_redirect_uri` is
      // matched as an exact string, and a product built from `APP_ORIGIN`
      // sends the bare origin while a person typing it by hand tends to add
      // the slash. Registering one and sending the other is a confusing
      // `invalid_request` at sign-out, so both are registered.
      postLogoutRedirectUris: [web, `${web}/`],
      appUrl: web,
      allowedScopes: ['openid', 'profile', 'email', 'offline_access'],
      resourceIndicator: product.resourceIndicator,
      tokenEndpointAuthMethod: 'client_secret_basic',
      isFirstParty: true,
    });

    created.push({ clientId: product.clientId, clientSecret, api });
    console.log(`· registered client "${product.clientId}"`);
  }

  return created;
}

async function main() {
  await connectDatabase();

  console.log(`\nSeeding Texor Account (${env.NODE_ENV})\n`);
  await seedAdmin();
  const created = await seedProducts();

  if (created.length) {
    console.log('\n─────────────────────────────────────────────────────────────');
    console.log('Client secrets — shown once. Paste into each product backend .env:\n');
    for (const item of created) {
      console.log(`# ${item.clientId}`);
      console.log(`TEXOR_ISSUER=${env.issuer}`);
      console.log(`TEXOR_CLIENT_ID=${item.clientId}`);
      console.log(`TEXOR_CLIENT_SECRET=${item.clientSecret}`);
      console.log(`TEXOR_REDIRECT_URI=${item.api}/api/auth/callback\n`);
    }
    console.log('─────────────────────────────────────────────────────────────\n');
  }

  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error('seed failed:', error.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
