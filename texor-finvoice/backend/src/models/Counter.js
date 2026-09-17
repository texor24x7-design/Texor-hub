/**
 * Named, atomically incremented counters.
 *
 * Document numbers and audit sequences both need "the next integer, and nobody
 * else gets the same one". A `$inc` on a single document is that guarantee in
 * one round trip, including inside a transaction.
 */
import mongoose from 'mongoose';

const counterSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    value: { type: Number, default: 0 },
  },
  { timestamps: false },
);

export const Counter = mongoose.model('Counter', counterSchema);

export async function nextValue(key, { session } = {}) {
  const counter = await Counter.findOneAndUpdate(
    { key },
    { $inc: { value: 1 } },
    { upsert: true, returnDocument: 'after', session },
  );
  return counter.value;
}

export default Counter;
