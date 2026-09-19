import mongoose from 'mongoose';
import env from './env.js';
import logger from '../utils/logger.js';

mongoose.set('strictQuery', true);

export async function connectDatabase() {
  mongoose.connection.on('connected', () => logger.info('mongodb connected'));
  mongoose.connection.on('error', (error) => logger.error('mongodb error', error));

  await mongoose.connect(env.MONGODB_URI, { serverSelectionTimeoutMS: 10_000 });
  // autoIndex only ever adds. An index the schemas no longer declare (a legacy
  // unique { owner, number } on invoices) keeps rejecting writes with E11000 —
  // every draft is (null, null) there — so drop whatever the schemas do not name.
  const dropped = Object.entries(await mongoose.syncIndexes()).filter(([, names]) => names?.length);
  if (dropped.length) logger.info('dropped stale indexes', Object.fromEntries(dropped));
  return mongoose.connection;
}

export const disconnectDatabase = () => mongoose.disconnect();

export default mongoose;
