import mongoose from 'mongoose';
import env from './env.js';
import logger from '../utils/logger.js';

mongoose.set('strictQuery', true);

export async function connectDatabase() {
  mongoose.connection.on('connected', () => logger.info('mongodb connected'));
  mongoose.connection.on('error', (error) => logger.error('mongodb error', error));

  await mongoose.connect(env.MONGODB_URI, { serverSelectionTimeoutMS: 10_000 });
  return mongoose.connection;
}

export const disconnectDatabase = () => mongoose.disconnect();

export default mongoose;
