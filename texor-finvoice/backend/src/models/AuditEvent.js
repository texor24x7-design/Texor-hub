/**
 * What happened in a workspace, and who did it.
 *
 * Append-only: nothing updates or deletes a row. Written by services after the
 * change they describe has committed.
 */
import mongoose from 'mongoose';

const { Schema } = mongoose;

const auditEventSchema = new Schema(
  {
    workspace: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
    at: { type: Date, default: () => new Date() },
    action: { type: String, required: true },
    module: { type: String, default: '' },
    recordId: { type: Schema.Types.ObjectId, default: null },
    summary: { type: String, default: '' },
    actor: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    actorName: { type: String, default: '' },
    metadata: { type: Schema.Types.Mixed, default: {} },
    ip: { type: String, default: '' },
  },
  { timestamps: false },
);

auditEventSchema.index({ workspace: 1, at: -1 });
auditEventSchema.index({ workspace: 1, recordId: 1, at: -1 });

export const AuditEvent = mongoose.model('AuditEvent', auditEventSchema);
export default AuditEvent;
