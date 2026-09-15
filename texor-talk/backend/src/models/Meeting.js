/**
 * A meeting.
 *
 * `code` is the human handle — `abc-defg-hij`, shared in invites and typed into
 * the join box. It is guessable by design, the way a phone number is, so it
 * grants nothing: it names a meeting, and this document decides who may enter
 * it. The SFU room is keyed by the same code and guarded by the same check, so
 * there is no second identifier to keep secret.
 *
 * A recurring meeting is one document, reused by every occurrence, so the code
 * a team has pinned in their calendar keeps working week after week.
 */
import mongoose from 'mongoose';

const { Schema } = mongoose;

/** Someone invited to the meeting. Externals have an email but no Texor id. */
const inviteeSchema = new Schema(
  {
    texorId: { type: String, default: null },
    email: { type: String, required: true, lowercase: true, trim: true },
    name: { type: String, default: '' },
    role: { type: String, enum: ['cohost', 'participant'], default: 'participant' },
    response: {
      type: String,
      enum: ['needs-action', 'accepted', 'declined', 'tentative'],
      default: 'needs-action',
    },
    respondedAt: { type: Date, default: null },
  },
  { _id: false },
);

/**
 * Who was actually in the call, and when.
 *
 * One entry per person per meeting rather than per join: a participant whose
 * wifi drops and who comes back thirty seconds later attended once, and an
 * attendance report full of duplicate rows helps nobody. `joins` counts the
 * reconnects for anyone who does need the detail.
 */
const attendanceSchema = new Schema(
  {
    texorId: { type: String, required: true },
    name: { type: String, default: '' },
    picture: { type: String, default: '' },
    email: { type: String, default: '' },
    role: { type: String, enum: ['host', 'cohost', 'participant', 'guest'], default: 'participant' },
    firstJoinedAt: { type: Date, required: true },
    lastSeenAt: { type: Date, required: true },
    leftAt: { type: Date, default: null },
    joins: { type: Number, default: 1 },
  },
  { _id: false },
);

const recurrenceSchema = new Schema(
  {
    freq: {
      type: String,
      enum: ['none', 'daily', 'weekdays', 'weekly', 'monthly'],
      default: 'none',
    },
    interval: { type: Number, default: 1, min: 1, max: 52 },
    // At most one of these is set; both empty means "forever".
    count: { type: Number, default: null, min: 1, max: 365 },
    until: { type: Date, default: null },
  },
  { _id: false },
);

const settingsSchema = new Schema(
  {
    muteOnEntry: { type: Boolean, default: true },
    videoOffOnEntry: { type: Boolean, default: false },
    screenShare: { type: String, enum: ['everyone', 'hosts'], default: 'everyone' },
    allowChat: { type: Boolean, default: true },
    allowExternalGuests: { type: Boolean, default: true },
  },
  { _id: false },
);

const meetingSchema = new Schema(
  {
    code: { type: String, required: true, unique: true, index: true },

    title: { type: String, required: true, trim: true, maxlength: 140 },
    agenda: { type: String, default: '', maxlength: 2000 },

    hostTexorId: { type: String, required: true, index: true },
    hostName: { type: String, default: '' },
    hostEmail: { type: String, default: '' },
    cohostTexorIds: { type: [String], default: [] },

    // Set when the meeting was started from a channel, which is what lets the
    // channel show a join card and the meeting show where it came from.
    channel: { type: Schema.Types.ObjectId, ref: 'Channel', default: null, index: true },

    /**
     * Who may join without being let in by a host.
     *   invited — only the host, co-hosts and named invitees
     *   texor   — anyone with a Texor Account
     *   anyone  — anyone holding the code, including external guests
     */
    access: { type: String, enum: ['invited', 'texor', 'anyone'], default: 'texor' },

    /** Who has to knock. Hosts and co-hosts never do. */
    lobby: { type: String, enum: ['off', 'external', 'everyone'], default: 'external' },

    invitees: { type: [inviteeSchema], default: [] },

    // Null on an instant meeting — it starts the moment someone opens it.
    scheduledStart: { type: Date, default: null, index: true },
    scheduledEnd: { type: Date, default: null },
    timezone: { type: String, default: 'UTC' },
    recurrence: { type: recurrenceSchema, default: () => ({}) },

    settings: { type: settingsSchema, default: () => ({}) },

    // Copied from org policy when the meeting is created, so tightening the
    // policy later does not cut off a meeting already in someone's calendar.
    maxDurationMinutes: { type: Number, default: 0 },
    maxParticipants: { type: Number, default: 0 },

    status: {
      type: String,
      enum: ['scheduled', 'live', 'ended', 'cancelled'],
      default: 'scheduled',
      index: true,
    },
    startedAt: { type: Date, default: null },
    endedAt: { type: Date, default: null },
    endedReason: { type: String, default: '' },

    attendance: { type: [attendanceSchema], default: [] },

    // Removing someone has to outlive the click, or they rejoin from the link
    // they still have open. Checked on every join for the life of the meeting.
    removedTexorIds: { type: [String], default: [] },

    /**
     * Everyone who has been inside this meeting at least once.
     *
     * The waiting room is a door, not a turnstile. Once a host has let somebody
     * in, stepping out for coffee — or a browser crashing — must not put them
     * back at the door and make a host admit the same person again. Removal is
     * checked first, so ejecting someone still overrides this.
     */
    admittedTexorIds: { type: [String], default: [] },

    createdBy: { type: String, required: true },
  },
  { timestamps: true },
);

// The two listings that matter: "my meetings, soonest first" and "what is live".
meetingSchema.index({ hostTexorId: 1, scheduledStart: -1 });
meetingSchema.index({ 'invitees.texorId': 1, scheduledStart: -1 });
meetingSchema.index({ status: 1, scheduledStart: -1 });

/** host › cohost › participant › guest. The caller decides what each may do. */
meetingSchema.methods.roleOf = function roleOf(texorId, email = '') {
  if (!texorId) return 'guest';
  if (this.hostTexorId === texorId) return 'host';
  if (this.cohostTexorIds.includes(texorId)) return 'cohost';

  const invited = this.invitees.find(
    (invitee) => invitee.texorId === texorId || (email && invitee.email === email.toLowerCase()),
  );
  if (invited) return invited.role === 'cohost' ? 'cohost' : 'participant';

  return 'guest';
};

meetingSchema.methods.hasBeenAdmitted = function hasBeenAdmitted(texorId) {
  return this.admittedTexorIds.includes(texorId);
};

meetingSchema.methods.isRemoved = function isRemoved(texorId) {
  return this.removedTexorIds.includes(texorId);
};

meetingSchema.methods.isHost = function isHost(texorId) {
  return this.hostTexorId === texorId || this.cohostTexorIds.includes(texorId);
};

/** Everyone currently in the call, by the server's reckoning. */
meetingSchema.methods.liveAttendance = function liveAttendance() {
  return this.attendance.filter((entry) => !entry.leftAt);
};

export const Meeting = mongoose.model('Meeting', meetingSchema);
export default Meeting;
