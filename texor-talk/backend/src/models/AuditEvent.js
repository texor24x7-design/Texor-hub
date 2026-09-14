/**
 * The audit log.
 *
 * Append-only by contract: nothing in this codebase updates or deletes a row.
 * Two properties make tampering detectable rather than merely discouraged.
 *
 *   `seq`   a gapless counter handed out by an atomic $inc on a separate
 *           document. Deleting a row leaves a hole; inserting one is
 *           impossible without colliding on the unique index.
 *   `hash`  a SHA-256 over the event's own content. Editing any field in place
 *           makes the row stop hashing to its stored value.
 *
 * Together they catch edits and deletions. They do not defeat someone with
 * write access who rewrites the entire log and recomputes every hash — that
 * needs the chain head anchored somewhere outside this database, which is a
 * deployment decision rather than a code one. `verifyChain` reports the head so
 * it can be anchored.
 */
import mongoose from 'mongoose';

const { Schema } = mongoose;

const auditEventSchema = new Schema(
  {
    seq: { type: Number, required: true, unique: true, index: true },

    action: { type: String, required: true, index: true },

    actorTexorId: { type: String, default: null, index: true },
    actorName: { type: String, default: '' },
    actorEmail: { type: String, default: '' },

    meeting: { type: Schema.Types.ObjectId, ref: 'Meeting', default: null, index: true },
    meetingCode: { type: String, default: null, index: true },

    // Who the action was done *to* — the admitted guest, the removed co-host.
    targetTexorId: { type: String, default: null },
    targetName: { type: String, default: '' },

    metadata: { type: Schema.Types.Mixed, default: {} },

    ip: { type: String, default: '' },
    userAgent: { type: String, default: '' },

    at: { type: Date, required: true },
    hash: { type: String, required: true },
  },
  // No timestamps: `at` is the event time and is inside the hash, so a second
  // clock field would only invite the two to disagree.
  { timestamps: false },
);

auditEventSchema.index({ at: -1 });
auditEventSchema.index({ action: 1, at: -1 });

/**
 * The counter that hands out sequence numbers.
 *
 * Separate collection, one document, incremented atomically — so two requests
 * landing at the same millisecond cannot be issued the same `seq`.
 */
const counterSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    value: { type: Number, default: 0 },
  },
  { timestamps: false },
);

export const AuditCounter = mongoose.model('AuditCounter', counterSchema);
export const AuditEvent = mongoose.model('AuditEvent', auditEventSchema);
export default AuditEvent;
