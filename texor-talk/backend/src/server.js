import { createServer } from 'node:http';
import env from './config/env.js';
import logger from './utils/logger.js';
import { connectDatabase, disconnectDatabase } from './config/db.js';
import { createApp } from './app.js';
import { closeWorkers, startWorkers } from './media/worker.js';
import { attachSignalling } from './media/signalling.js';

async function main() {
  await connectDatabase();

  // The SFU comes up before the port does. A browser that can reach the API but
  // finds no media workers behind it would fail at the worst possible moment —
  // after the user has already granted camera access.
  await startWorkers();

  const server = createServer(createApp());
  attachSignalling(server);

  // `listen` reports failure by emitting 'error', not by rejecting. Without
  // this the common case — the port already taken — surfaces as an uncaught
  // exception that skips the shutdown path entirely and strands the media
  // workers that were started a moment ago.
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(env.PORT, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });

  logger.info('talk api listening', {
    port: env.PORT,
    appOrigin: env.appOrigin,
    texorIssuer: env.TEXOR_ISSUER,
    mediaAnnouncedAddress: env.media.announcedAddress,
    env: env.NODE_ENV,
  });

  const shutdown = async (signal) => {
    logger.info(`received ${signal}, shutting down`);
    server.close();
    await closeWorkers();
    await disconnectDatabase();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch(async (error) => {
  logger.error('failed to start talk', error);
  // The media workers are spawned before the port is bound, so a failure to
  // listen would otherwise leave a set of orphaned C++ processes behind —
  // holding their RTC ports, and making the next attempt fail differently.
  await closeWorkers().catch(() => {});
  process.exit(1);
});
