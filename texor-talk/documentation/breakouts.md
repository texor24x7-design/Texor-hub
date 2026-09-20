# Breakout rooms

A host splits a meeting into smaller rooms, people talk, and everyone comes
back. This describes what a breakout actually is, what it costs, and the one
thing in the design that was dangerous.

---

## A breakout is a second room, not a filter

The media layer keeps one mediasoup Router per room, and media can only be
forwarded between transports on the same Router. So two people in different
breakouts cannot hear each other for the same reason two people in different
*meetings* cannot: there is no path between them. Nothing has to remember to
filter anything.

That is worth stating plainly, because the alternative design — one room, and a
`breakoutId` on every message, roster entry, reaction and active-speaker event —
is a rule that every future feature has to re-obey. Miss it once and somebody
hears a conversation they were not in. Here, being in the wrong room is not a
bug that leaks audio; it is a bug that shows you an empty room.

Rooms are keyed by a **room key**: the meeting code for the main room,
`abc-defg-hij#b2` for a breakout. The meeting code stays beside it on every
room, because almost everything that asks a question about a meeting means the
meeting rather than one of its rooms.

> A sentence that used to appear in `media.md` and in `room.js` — *"a Router is
> the meeting"* — is no longer true. A Router is a room; a meeting is one or
> more of them.

---

## What it costs

Less than not splitting. An SFU's cost is the number of streams it forwards,
and splitting reduces it: twenty people in one room is 20 × 19 = 380 forwarded
streams, while four rooms of five is 4 × 5 × 4 = 80.

There is still a cap — an admin sets it, default 20 — but it is a bound on how
many Routers one meeting can open by accident, not a bandwidth control. The
admin copy says so.

---

## Opening, assigning, closing

Three REST calls, all guarded by the same `requireHost` as every other meeting
edit, so co-hosts and whoever is standing in for an absent host can use them:

```
POST   /api/meetings/:code/breakouts    open, with the whole assignment
PATCH  /api/meetings/:code/breakouts    reassign, rename, extend, self-select
DELETE /api/meetings/:code/breakouts    close, and bring everyone back
```

The plan lives on the meeting document:

```js
breakouts: {
  status: 'closed' | 'open',
  rooms: [{ key: 'b1', name: 'Room 1', members: [texorId] }],
  nextRoomKey: 3,
  selfSelect: false,
  openedAt, closesAt, openedByTexorId,
}
```

**Membership is on the room, not on the attendance row.** A room column on
attendance would invite exactly the per-room filtering the design avoids, and
it would answer the wrong question anyway: where somebody *is* this second
comes from the socket map, which is ground truth and free. What the document is
for is the question the socket map cannot answer — where somebody belongs when
they come back.

**Keys are never reused.** A key labels the chat that happened in the room, so
handing a retired key to a new room would file two conversations under one
heading. Counting today's rooms is not enough to prevent that, since the retired
ones are gone from that list and their transcripts are not, so the next number
is kept on the document as `nextRoomKey`.

The proposed split is worked out in the browser (`lib/breakouts.js`), because a
host has to see it and change it before anything opens — putting the wrong two
people together is obvious on screen and invisible in an API. It deals
round-robin rather than slicing, since people are listed in the order they
joined and chunking would put everyone who arrived first together, which is
usually the grouping the host is trying to break up. The server validates
whatever finally arrives: no duplicate members, everybody in attendance, room
count within the cap.

---

## The move, and why your camera stays on

Moving is reconnecting. The client closes its socket, opens another with
`?room=b2`, and rebuilds its device, transports, producers and consumers —
which is the path a dropped connection already took, minus the second of
backoff in front of it. It **carries the live camera and microphone tracks
across**, so the browser is never asked for permission again and the capture
light does not blink. It costs about a second of silence, and the screen says
"Moving you to Room 2" rather than "Reconnecting", because a move the host asked
for is not a failure and must not look like one.

`moveTo` is an instruction to go and ask, never a grant of entry. The new socket
is authorised from the meeting's own plan when it connects:

```js
resolveRoom({ meeting, texorId, role, requested })
```

Three properties matter:

- **No `?room=` means "put me where I belong."** That is what makes a refresh —
  and a full server restart, where every room in memory is gone — land everybody
  back in their room with no client state and no recovery code.
- **The main room is always allowed.** Nobody is ever stuck in a breakout.
- **The key is built by the server, never taken from the client.** The request
  supplies an id, the id is looked up in *this* meeting's plan, and anything
  unrecognised is refused rather than concatenated — so no query string can
  address another meeting's room.

A host may walk into any room of their own meeting; that is what visiting is,
and it is not audited. Everybody else gets the room they were assigned, unless
the host has turned self-selection on. Choosing your own room *is* audited,
because it is a per-person act.

---

## Presence: the part that was dangerous

Presence is meeting-wide, and before breakouts it was also room-wide, because a
meeting was one room. The function everything reads is:

```js
connectedTexorIds(code)  // the union across every room of this meeting
```

It is ground truth for whether a meeting is live, how many people are in it,
whether it has been abandoned, whether the occupied-time clock is running, and
who is holding the host's custody.

Read one room at a time, **the main room looks empty the moment everybody is in
a breakout** — and an empty room ends the sitting: custody is cleared and every
pass in `admittedTexorIds` is thrown away. Under "everyone knocks", the next
person to reconnect would be back at the door, and nobody would ever connect it
to the host having opened breakout rooms twenty minutes earlier.

So `connectedTexorIds` itself became the union, rather than a second function
added beside it. That choice is the safety: no caller wants the narrow answer,
so a call site missed during the change is *already correct*, where adding a new
function would have left every missed call site a live bug that only appears
once breakouts ship. Capacity, abandonment and the clock all reason from
meeting-wide attendance and needed no room discriminator at all — they became
correct the moment presence was a union.

A move never calls `markLeft`. The old socket is replaced rather than closed, so
the disconnect handler finds it is no longer the peer of record and returns
early: the attendance row, the clock and custody are untouched.

The media suite holds this down from both ends — a breakout emptying while
people are still in the main room must not end the meeting, hand it to a
stand-in, or cancel anybody's pass.

---

## The timer

A host can give the rooms a deadline. The countdown people watch is drawn by
their own browser from `closesAt`; the server broadcasts no warnings. That is
why there is no "five minutes left" message to send twice, no flag recording
that it was sent, and nothing to put right after a restart — the server only has
to close, which is one `if` in the room ticker that already runs every five
seconds.

Closing keeps the rooms. Their names still label the chat that happened in them,
and reopening the same groups is one click.

---

## Chat is kept now

In-call chat used to be broadcast and forgotten. It is stored per room, because
a host who splits a meeting into six rooms cannot be in all of them and finding
out what was said is most of the reason to send people away to talk.

This is a change of privacy posture, not a feature, so it does not ship alone:

- an admin can turn it off entirely (`keepCallChat`);
- an admin sets how long it is kept (`chatRetentionDays`, default 30), enforced
  by a TTL index on `expiresAt`;
- every message is stamped with its own deletion date **at write time**, so
  shortening the period changes what happens next and never rewrites a
  transcript that already exists;
- the line at the top of the chat panel says messages are saved and for how
  long. People decide what to type based on that line.

A transcript is readable by the host, and by the people who were in that room:

```
GET /api/meetings/:code/chat?room=b1
```

The room key is not a capability. The write happens after the broadcast and its
failure is logged rather than raised, because a storage problem must not cost
somebody their message — and since a message now costs a write, there is a rate
limit of ten in ten seconds, far above typing and far below a loop.

---

## Talking to every room, and asking for help

`breakoutAnnounce` is a host talking into every room at once — as text, not
audio. Piping a live track into six Routers is a capability this codebase does
not have (`pipeToRouter` is used nowhere), and "five minutes left" does not need
one. An announcement is stored in each room it lands in, so it reads back in the
transcript where it interrupted.

`breakoutHelp` reaches every host wherever they are. That works only because
presence is the union: a host sitting in another breakout is still reachable,
which is the same reason a knock at the meeting's door reaches a host who has
wandered into Room 3.

---

## Lifecycle

| Event | What happens |
|---|---|
| **Open** | One document write, then an in-memory `moveTo` to everyone affected. Assigned people who are offline need nothing — they are placed when they connect |
| **A room empties** | Nothing. Its Router closes itself; membership is unaffected and people can come back |
| **Host visits** | Transient, no document write. An unrelated reassignment does not yank them back mid-sentence — but if the room they are in is dropped from the plan, they return with everyone |
| **Someone joins mid-breakout** | They land in the main room; the host assigns them, which sends a `moveTo` |
| **Refresh** | No `?room=`, so back to your assignment. A host who refreshes while visiting lands in the main room, because hosts have no assignment |
| **Server restart** | Every room in memory is gone; every client reconnects and is placed from the document. This is what persisting membership buys, and it needs no recovery code |
| **Meeting ends** | The plan is cleared and every room is closed |
| **Recurring meeting rolls forward** | Last week's groups are not this week's, for the same reason last week's passes are not |
| **Someone is removed** | Dropped from every room's members in the save that removes them |

---

## Audit

- `breakouts.opened` carries the **whole assignment** in its metadata — one row
  inside the hash chain rather than fifty. The chain is hashed in order, so
  fifty rows for one click would be fifty chances to leave a record half
  written, and the thing worth keeping is the split.
- `breakouts.closed` records the reason (`host` or `time`) and how long they ran.
- `breakouts.self_selected` records a person choosing their own room, which is a
  genuine per-person act. Host visits are not recorded.

---

## What is not here

- **Cross-room audio** — a host speaking into every room at once. `pipeToRouter`
  is used nowhere in this codebase, so it is a new capability rather than a
  re-keying. The text broadcast covers it for now.
- **Pre-assigning rooms** before the meeting starts, from the invitee list.
- **Chat backfill on joining a room**, and participant-facing transcripts.
- **Per-room attendance reporting.** The audit metadata already holds the
  membership; the report can be built when somebody asks for it.
- **Per-room headcount caps, per-room hosts, recording a breakout**, and a
  visiting host's room surviving their own refresh.
