/**
 * One-off migration: remove the legacy `roomName` field and its unique index.
 *
 * When meetings ran on an external Jitsi deployment, each meeting carried a
 * random `roomName` — a secret second identifier, so that knowing a meeting
 * code did not let anyone open the room directly on the Jitsi side.
 *
 * With the SFU inside this process there is nothing to keep secret: the room is
 * keyed by the meeting code and guarded by the same `evaluateJoin` that guards
 * every other way in. The field is gone from the schema.
 *
 * The index is not gone, though. MongoDB keeps an index after the field stops
 * being written, and this one is `unique` — so every new meeting would write
 * `roomName: null`, the second one would collide with the first, and creating a
 * meeting would fail with a duplicate key error that names a field no longer in
 * the code. Dropping the index is the whole migration.
 *
 *   node --env-file=.env scripts/drop-legacy-media-index.js
 *
 * Safe to run more than once, and safe to run on a database that never had it.
 */
import mongoose from 'mongoose';

const uri = process.env.MONGODB_URI;

if (!uri) {
  console.error('MONGODB_URI is not set. Run with --env-file=.env');
  process.exit(1);
}

await mongoose.connect(uri);
const meetings = mongoose.connection.db.collection('meetings');

const indexes = await meetings.indexes();
const legacy = indexes.filter((index) => JSON.stringify(index.key).includes('roomName'));

if (legacy.length === 0) {
  console.log('Nothing to do — no roomName index on `meetings`.');
} else {
  for (const index of legacy) {
    await meetings.dropIndex(index.name);
    console.log(`Dropped index ${index.name}`);
  }
}

const { modifiedCount } = await meetings.updateMany(
  { roomName: { $exists: true } },
  { $unset: { roomName: '' } },
);

console.log(`Cleared roomName from ${modifiedCount} meeting${modifiedCount === 1 ? '' : 's'}.`);

await mongoose.disconnect();
