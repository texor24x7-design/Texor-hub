/**
 * Boot sequence: database, signing keys, provider, HTTP listener.
 */
import { createServer } from 'node:http';
import env from './config/env.js';
import logger from './utils/logger.js';
import { connectDatabase, disconnectDatabase } from './config/db.js';
import { createProvider } from './oidc/provider.js';
import { createApp } from './app.js';
import { PROVIDER_IDS, enabledProviders } from './federation/providers.js';

async function main() {
  await connectDatabase();

  const provider = await createProvider();
  const app = createApp(provider);
  const server = createServer(app);

  await new Promise((resolve) => server.listen(env.PORT, resolve));

  // Stated at boot because the alternative is silence: an unconfigured provider
  // simply does not render a button, which looks identical to a broken one.
  const federated = enabledProviders().map((entry) => entry.id);
  logger.info('social sign-in', {
    configured: federated,
    unconfigured: PROVIDER_IDS.filter((id) => !federated.includes(id)),
    hint: federated.length === 0
      ? 'No buttons will appear on the sign-in screen. Run `npm run check:providers`.'
      : undefined,
  });

  logger.info('texor-accounts listening', {
    port: env.PORT,
    issuer: env.issuer,
    discovery: `${env.issuer}/.well-known/openid-configuration`,
    accountUi: env.accountsWebOrigin,
    env: env.NODE_ENV,
  });

  const shutdown = async (signal) => {
    logger.info(`received ${signal}, shutting down`);
    server.close();
    await disconnectDatabase();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((error) => {
  logger.error('failed to start texor-accounts', error);
  process.exit(1);
});
