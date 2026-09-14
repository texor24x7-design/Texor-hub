# Meetings

Texor Talk runs meetings the way Google Meet does: a code, a link, a waiting
room, and a host who decides who comes in.

The video and audio are ours too. The media server is
[mediasoup](https://mediasoup.org) — open source, imported as a dependency — and
it runs inside the API process. There is no conferencing service behind this, no
account to create and nothing to configure for the rules below to be real. See
[media.md](./media.md) for the SFU itself.

```
  Texor Account          Texor Talk
  ─────────────          ──────────
  who you are    ──▶     may you join this meeting?
                         what may you do in it?
                                   │
                                   ▼
                         the same process forwards the packets
```

That last line is the important one. Every rule on this page is enforced by the
process that owns the media, so there is no configuration that can quietly
downgrade the lobby or the host roles to suggestions.

---

## The code

`bcd-fghj-kmn` — the human handle, shared in invites and typed into the join
box. Ten characters from a twenty-letter alphabet, so guessing one at random is
not a way in.

It is still only a handle, and it grants nothing. It names a meeting; the
meeting document decides who may enter it. There is no second, secret
identifier to keep safe, because the SFU room is keyed by the same code and
guarded by the same check.

---

## Joining

One endpoint, `POST /api/meetings/:code/join`, makes the whole decision. It is
one function ([`evaluateJoin`](../backend/src/services/meeting.service.js)) on
purpose: spread across a controller these checks drift, and "who can get into a
meeting" must not have two slightly different versions of itself.

In order:

1. **Is the meeting alive?** Cancelled and ended meetings refuse everyone but
   the host.
2. **Were they removed?** Removal outlives the click. Someone removed from a
   meeting cannot rejoin from the link they still have open.
3. **Are they allowed at all?** External guests need both org policy and the
   meeting to allow them. An `invited`-only meeting refuses anyone not on the
   list.
4. **Is it the right time?** A scheduled meeting opens
   `MEETING_JOIN_EARLY_MINUTES` before it starts and closes two hours after it
   ends. Hosts are never held back — somebody has to be able to open the room.
5. **Is there room?** Against the meeting's participant cap.
6. **Has it run long?** Against the meeting's duration cap.
7. **Lobby.** See below.

Refusals come back as error codes the frontend acts on rather than just prints —
`too_early` renders a start time, `host_not_present` says to come back.

### The waiting room

Whether someone knocks is the meeting's `lobby` setting, tightened by policy:

| `lobby` | Who knocks |
|---|---|
| `off` | Nobody |
| `external` | Guests from outside the organisation, and anyone not invited |
| `everyone` | Everybody except the host and co-hosts |

Org policy can only ever tighten this. `forceLobbyForExternal` means a host who
switched the waiting room off still cannot wave an outside guest straight in.

A knock is a row in `knocks` with a TTL, so an abandoned one disappears on its
own. The person waiting polls their own knock; hosts are pushed the list down
their media socket as it changes. If nobody is in the meeting at all, knocking is
refused outright rather than leaving someone in front of a door nobody is
behind.

---

## Roles

| Role | How you get it | What it adds |
|---|---|---|
| `host` | Created the meeting | Everything, including changing roles |
| `cohost` | Promoted by the host, or invited as one | Admit, remove, end, moderate the call |
| `participant` | On the invitee list | — |
| `guest` | Holding the code, nothing more | Knocks wherever the lobby applies |

Roles are recomputed from the meeting document on every request. A client told
it is a host on Monday is not a host on Tuesday because it says so.

A promotion takes effect **immediately**, including for someone already in the
call: the role is a field on their peer at the SFU, and changing it is one
assignment. The API reports `appliedLive` so a caller knows whether it reached a
live socket or only the stored record.

This is what owning the media layer buys. When moderator status lived in a token
minted for somebody else's service, a promotion could not reach the token the
user was already holding, and only applied on their next join.

### Removing someone

Both halves happen on the server:

1. The database blocks them from rejoining, for the life of the meeting.
2. The SFU closes their socket and their transports.

Their media stops at our end whether or not their browser cooperates. There is
nothing to ask nicely, and no chance of removing the wrong person by matching on
a display name.

---

## Presence

There is no heartbeat endpoint. **A connected socket is a participant who is
present**, which is both simpler and more truthful than a timer: a browser that
crashes drops its connection, the server sees the close, and they leave the
roster at once rather than lingering as a ghost until a timeout expires.

The roster, the waiting list, mute state, role changes, removals and the end of
the meeting are all pushed down the same socket, so a client learns about them
when they happen rather than on its next poll.

One timer remains, server-side: a ticker that pings for liveness (catching a
connection that died without a close frame), enforces the duration cap, and
closes out a meeting everyone has left. One timer for the whole server, rather
than a request per participant every fifteen seconds.

---

## Scheduling

A scheduled meeting carries `scheduledStart`, `scheduledEnd`, a timezone, and a
recurrence rule: `daily`, `weekdays`, `weekly`, `monthly`, with an interval and
an optional `count` or `until`.

**A recurring meeting is one document.** The same code opens next week's call,
which is what makes a code pinned in a calendar keep working. `currentOccurrence`
computes the occurrence that matters right now — the one in progress, or the
next one due — and returns null once the series runs out, so a finished
recurring meeting stops accepting joins without anyone having to cancel it.

There is no scheduler process. The bookkeeping that a cron job would do —
sweeping stale attendance, rolling a recurring meeting forward to its next
occurrence, ending a meeting everyone left — happens when a request loads the
meeting. Any request pays a trivial cost so that what it then reads is true,
rather than the whole product depending on a timer that might not be running.

### Calendar invites

`GET /api/meetings/:code/invite.ics` returns an RFC 5545 `VEVENT`.

- `METHOD:REQUEST` with a stable `UID` and a `SEQUENCE` from the document
  version, so re-sending after a change updates the calendar entry rather than
  adding a second one. A cancelled meeting goes out as `METHOD:CANCEL`.
- Times are UTC with a `Z`. The alternative is shipping a `VTIMEZONE` block with
  the host's full daylight-saving history to arrive at the same instant; the
  meeting's own zone travels in `X-TEXOR-TIMEZONE` for anything that wants to
  display it.
- Lines fold at 75 **octets**, counted in UTF-8 and never splitting a character.

---

## Policy

One document, enforced on the server at the moment it matters — never suggested
to the browser. The console at `/admin` is a view onto it and nothing more.

| Setting | Enforced when |
|---|---|
| `whoCanCreateMeetings`, `creatorAllowlist` | A meeting is created |
| `allowExternalGuests` | Joining, and inviting |
| `forceLobbyForExternal` | Joining — tightens the meeting's own lobby |
| `lobbyDefault`, `screenShareDefault`, `defaultMuteOnEntry`, `defaultVideoOffOnEntry` | Copied into a meeting as it is created |
| `maxDurationMinutes` | The room ticker ends the call when it is reached |
| `maxParticipants` | Joining |

**Limits are snapshotted at creation.** A meeting keeps the caps it was created
with, so tightening the policy next month does not retroactively shorten a
meeting already sitting in somebody's calendar.

### Admins

Two sources, and the environment wins:

- `ADMIN_EMAILS` — deployment configuration, and therefore not editable from
  inside the console. This is the escape hatch if someone removes themselves, or
  every other admin leaves on the same day.
- `policy.adminTexorIds` — added through the console.

`/api/auth/me` returns `isAdmin` so the navigation knows whether to draw the
link. That is tidiness, not a control: every `/api/admin` route checks again for
itself.

---

## The audit log

Append-only by contract — nothing in this codebase updates or deletes a row.
Joins, admissions, removals, role changes, invitations, cancellations and policy
edits all land in it.

Two properties make tampering **detectable**:

- **`seq`** — a gapless counter handed out by an atomic `$inc` on a separate
  document. Deleting a row leaves a hole; inserting one collides on the unique
  index.
- **`hash`** — SHA-256 over the event's own content, in a fixed field order.
  Editing any field in place makes the row stop hashing to its stored value.

`GET /api/admin/audit/verify` re-reads the log and reports both checks, plus a
`head` hash.

**What this does not do.** It does not defeat someone with write access to the
database who rewrites the entire log and recomputes every hash. Closing that
needs the `head` anchored somewhere outside this database — an object store with
retention lock, a log shipper, a notary. That is a deployment decision rather
than a code one, which is why `verify` reports the head rather than only a
verdict.

Audit writes never throw. A failed audit write is worth an error in the log and
a look in the morning; it is not worth failing the join a user is in the middle
of.

---

## Meetings and channels

A meeting can be started from a channel. It is created with `channelId`, which
makes the backend post the joining link into the channel, so everyone reading
gets it without anyone pasting anything. A private channel starts an
`invited`-only meeting.

---

## What is not here

Deliberately, in this version:

- **Recording and transcription.** Not built. With our own SFU the route is a
  `PlainTransport` piping RTP into ffmpeg, plus storage with a retention policy
  and consent handling — a real piece of work, but one that needs no third party
  either.
- **Dial-in and breakout rooms.**
- **Raised hands as state.** `✋` is in the reaction set, but it floats away like
  the others rather than putting someone in a queue a host can work through.
- **Per-occurrence exceptions.** Cancelling a recurring meeting cancels the
  series. Moving a single week means editing the meeting.
- **Email delivery.** Invitees are recorded and the `.ics` is generated, but
  nothing sends mail — there is no mail transport in this product yet.
