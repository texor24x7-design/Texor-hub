# Texor Talk data model

Eight collections in the `talk` database — four for messaging, four for meetings.

## `users`

A local projection of a Texor Account.

| Field | Notes |
|---|---|
| `texorId` | The `sub` claim. The same value in Finvoice and Payroll for the same person |
| `email`, `displayName`, `picture` | Cached from the ID token, refreshed on each sign-in |
| `status`, `statusText` | Talk's own presence state |

## `sessions`

Talk's own session. Identical in shape to every other product's: an opaque
`talk_sid` cookie, with the Texor tokens held server-side and refreshed
automatically. See [texor-sso.md](./texor-sso.md).

## `channels`

| Field | Notes |
|---|---|
| `slug` | Unique. Derived from the name — `Design Team` → `design-team` |
| `name`, `topic` | |
| `visibility` | `public` · `private` |
| `createdBy` | A Texor id |
| `memberTexorIds[]` | **Texor ids, not local user ids** |
| `lastMessageAt`, `messageCount` | Denormalised, so the channel list is one query |

### Why membership is Texor ids

A channel can list someone who has been invited but has never opened Talk. They
exist in Texor before they exist here, so storing local `users._id` would mean
inventing a placeholder record for every invitee.

`canBeReadBy()` is the single read-access rule: public channels are readable by
anyone signed in, private ones only by members. It is checked on every request
rather than trusted from a previous one, so removing someone from a private
channel takes effect immediately rather than at their next page load.

## `messages`

| Field | Notes |
|---|---|
| `channel` → `channels` | |
| `authorTexorId` | The source of truth for who wrote it |
| `authorName`, `authorPicture` | Denormalised at write time |
| `body` | Up to 4000 characters |
| `editedAt`, `deletedAt` | |

### Why the author is denormalised

Rendering a thousand-message backlog is one query. Without the copy it would be
a join against `users` — or worse, a call to the identity provider — per
distinct author. `authorTexorId` remains authoritative if the two ever disagree,
which they will when someone changes their display name.

### Why deletes are soft

`deletedAt` hides a message from every read path but keeps the row. A deleted
message in a shared channel is something a team may need to account for later;
a hard delete makes that impossible.

### Indexes

- `{ slug: 1 }` unique
- `{ memberTexorIds: 1 }`, `{ visibility: 1 }` — the channel list query
- `{ channel: 1, createdAt: -1 }` — the only message query that matters at scale

## `meetings`

| Field | Notes |
|---|---|
| `code` | Unique. The human handle, `bcd-fghj-kmn`, and the SFU room key |
| `hostTexorId`, `cohostTexorIds[]` | |
| `access` | `invited` · `texor` · `anyone` — who joins without being let in |
| `lobby` | `off` · `external` · `everyone` — who knocks |
| `invitees[]` | `{ texorId, email, name, role, response }`. Email, because an invitee may not have opened Talk yet |
| `scheduledStart`, `scheduledEnd`, `timezone` | Null on an instant meeting |
| `recurrence` | `{ freq, interval, count, until }` |
| `settings` | Mute on entry, camera off, screen share, chat, external guests |
| `maxDurationMinutes`, `maxParticipants` | **Snapshotted from policy at creation** |
| `status` | `scheduled` · `live` · `ended` · `cancelled` |
| `attendance[]` | One row per person, not per join |
| `removedTexorIds[]` | Blocks a rejoin for the life of the meeting |
| `admittedTexorIds[]` | Everyone let in at least once — they skip the lobby on return |
| `breakouts` | The breakout plan: `{ status, rooms[{ key, name, members[] }], nextRoomKey, selfSelect, openedAt, closesAt, openedByTexorId }` |
| `channel` → `channels` | Set when the meeting was started from a channel |

### Why breakout membership is not a column on attendance

It would answer the wrong question. Where somebody *is* right now comes from the
socket map, which is ground truth and costs nothing; what the document has to
record is where they **belong** when they come back — after a refresh, or after
a server restart that took every room in memory with it. A discriminator on the
attendance row would also invite per-room filtering of presence, and presence
being meeting-wide is what keeps a meeting from declaring itself empty the
moment everybody steps into a breakout. See
[breakouts.md](./breakouts.md#presence-the-part-that-was-dangerous).

`nextRoomKey` only ever counts up. A key labels the chat that happened in that
room, so a retired key must never be handed to a new one.

### Why there is only one identifier

Meetings used to carry a second, secret `roomName` — the room on the external
conferencing service, kept out of every response so that knowing a code did not
let anyone walk in on that side. With the SFU inside this process there is
nothing to keep secret: the media socket runs the same `evaluateJoin` as the
REST API, so the code names a meeting and the document decides the rest.

A database created before that change still has the old unique index on
`roomName`, which would make every meeting after the first fail with a duplicate
key error. `npm run migrate:media` drops it.

### Why a recurring meeting is one document

The same code opens next week's call, which is what makes a code pinned in a
calendar keep working. `currentOccurrence()` computes which occurrence is live or
next; `rollForward()` puts an ended weekly meeting back to `scheduled` once its
occurrence is behind us.

### Why attendance is one row per person

Somebody whose wifi drops and who comes back thirty seconds later attended once.
An attendance report full of duplicate rows helps nobody, so a reconnect updates
the existing row and increments `joins`.

### Why limits are snapshotted

Tightening org policy next month must not retroactively shorten a meeting
already in somebody's calendar.

## `knocks`

Waiting-room requests. `{ meeting, texorId, name, email, picture, status,
decidedBy…, expiresAt }`.

Its own collection rather than an array on the meeting, because a knock is polled
hard from two sides at once — the person waiting, and every host looking at the
admit list — and because a TTL index is the cheapest way to make an abandoned
knock disappear on its own.

A partial unique index on `{ meeting, texorId }` where `status: 'waiting'` means
re-knocking updates one row instead of filling a host's list with the same face
five times.

## `callmessages`

What was said in a call, one row per message, kept per room.

| Field | Notes |
|---|---|
| `meeting` → `meetings`, `roomKey`, `roomName` | `roomKey` is `''` for the main room. The name is denormalised so a transcript reads the way it read at the time |
| `authorTexorId`, `authorName`, `isGuest` | Denormalised for the same reason as `messages` |
| `kind` | `message`, or `announcement` for a host talking into every room |
| `body` | |
| `expiresAt` | Stamped **at write time** from the organisation's retention setting, with a TTL index on it |

Stamping the expiry when the row is written rather than computing it in the
sweep means an admin shortening the period changes what happens next and never
rewrites a transcript that already exists.

Indexes: `{ meeting, roomKey, createdAt }` — the only query there is — and
`{ expiresAt }` with `expireAfterSeconds: 0`.

## `policies`

One document, keyed `org`, created with its defaults on first read via an upsert
— so two requests racing on a cold database cannot both create it. See
[meetings.md](./meetings.md#policy).

## `auditevents` and `auditcounters`

Append-only. Nothing in this codebase updates or deletes a row.

| Field | Notes |
|---|---|
| `seq` | Unique, gapless. From an atomic `$inc` on the counter document |
| `hash` | SHA-256 over the event's own content, fixed field order |
| `action` | `meeting.joined`, `lobby.admitted`, `policy.updated`, … |
| `actor*`, `target*`, `meeting`, `meetingCode`, `metadata`, `ip`, `at` | |

`seq` catches deletions and insertions; `hash` catches edits. Together they make
tampering detectable — not impossible. What that does and does not prove is set
out in [meetings.md](./meetings.md#the-audit-log).

The counter is a separate collection so that two requests landing in the same
millisecond cannot be issued the same `seq`.

### Indexes

- `{ code: 1 }`, `{ roomName: 1 }` unique on meetings
- `{ hostTexorId: 1, scheduledStart: -1 }`, `{ 'invitees.texorId': 1, scheduledStart: -1 }` — the "my meetings" query
- `{ status: 1, scheduledStart: -1 }` — what is live
- `{ expiresAt: 1 }` TTL on knocks
- `{ seq: 1 }` unique, `{ at: -1 }`, `{ action: 1, at: -1 }` on audit events

## A note on delivery

The chat view polls every five seconds. A websocket is the eventual answer;
polling keeps the first version simple and works through any proxy without
configuration. The API is unchanged by that switch when it happens.
