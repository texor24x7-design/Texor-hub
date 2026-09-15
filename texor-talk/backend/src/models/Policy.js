/**
 * Org-wide meeting policy — one document, always.
 *
 * Every rule here is enforced on the server at the moment it matters, not
 * suggested to the browser. The console at /admin is a view onto this document
 * and nothing more.
 */
import mongoose from 'mongoose';

const { Schema } = mongoose;

const policySchema = new Schema(
  {
    // The singleton key. Its uniqueness is what keeps there being exactly one.
    key: { type: String, default: 'org', unique: true, immutable: true },

    /** anyone — every Texor account. allowlist — only `creatorAllowlist`. */
    whoCanCreateMeetings: { type: String, enum: ['anyone', 'allowlist'], default: 'anyone' },
    creatorAllowlist: { type: [String], default: [] },

    /** Applies to anyone whose email is outside ORG_EMAIL_DOMAINS. */
    allowExternalGuests: { type: Boolean, default: true },
    /** Overrides a host who set the lobby to off, for external guests only. */
    forceLobbyForExternal: { type: Boolean, default: true },

    lobbyDefault: { type: String, enum: ['off', 'external', 'everyone'], default: 'external' },

    // 0 means no limit, for both of these.
    maxDurationMinutes: { type: Number, default: 0, min: 0, max: 24 * 60 },
    maxParticipants: { type: Number, default: 0, min: 0, max: 1000 },

    /**
     * The best quality any meeting in this organisation may use.
     *
     * Hosts choose at or below this. It is the one limit that costs money to
     * raise — an SFU forwards every stream to every participant, so bandwidth
     * is headcount multiplied by bitrate — which makes it the natural place for
     * a plan to apply.
     */
    maxQuality: { type: String, enum: ['saver', 'standard', 'high'], default: 'high' },

    defaultMuteOnEntry: { type: Boolean, default: true },
    defaultVideoOffOnEntry: { type: Boolean, default: false },
    screenShareDefault: { type: String, enum: ['everyone', 'hosts'], default: 'everyone' },

    /**
     * Admins beyond the ones seeded by ADMIN_EMAILS. The env list cannot be
     * edited away from in here, which is the lockout escape hatch.
     */
    adminTexorIds: { type: [String], default: [] },

    updatedByTexorId: { type: String, default: null },
    updatedByName: { type: String, default: '' },
  },
  { timestamps: true },
);

export const Policy = mongoose.model('Policy', policySchema);
export default Policy;
