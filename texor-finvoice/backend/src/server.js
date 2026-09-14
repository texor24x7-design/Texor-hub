import { createServer } from 'node:http';
import env from './config/env.js';
import logger from './utils/logger.js';
import { connectDatabase, disconnectDatabase } from './config/db.js';
import { createApp } from './app.js';

async function main() {
  await connectDatabase();

  const server = createServer(createApp());
  await new Promise((resolve) => server.listen(env.PORT, resolve));

  logger.info('finvoice api listening', {
    port: env.PORT,
    appOrigin: env.appOrigin,
    texorIssuer: env.TEXOR_ISSUER,
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
  logger.error('failed to start finvoice', error);
  process.exit(1);
});
