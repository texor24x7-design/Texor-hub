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

**The lobby asks once per meeting, not once per join.** Anyone who has been
inside is recorded in `admittedTexorIds` and walks straight back in — stepping
out for coffee, a browser crashing, or wifi dropping must not put someone back
at the door and make a host admit the same person again. Removal is checked
first, so ejecting somebody still overrides their standing pass.

A knock is a row in `knocks` with a TTL, so an abandoned one disappears on its
own. The person waiting polls their own knock; hosts are pushed the list down
their media socket as it changes. If nobody is in the meeting at all, knocking is
refused outright rather than leaving someone in front of a door nobody is
behind.

---

## Guests

Somebody with no Texor Account can join a meeting by typing a name, if three
independent gates all agree:

1. org policy allows external guests
2. the meeting's own settings allow them
3. the meeting's `access` is **`anyone`**

The third is the important one. `texor` means "anyone with a Texor Account",
which is a statement that signing in is required — letting somebody past that
with a typed name would make the setting a lie. Opening a meeting to people
without accounts has to be a decision somebody took.

### What a guest pass is

**Not a session.** A Texor session says "this is who you are, everywhere in this
product". A guest pass says something far narrower:

> this browser may act as the name "Sam" in exactly one meeting, until it ends

It is scoped to a single meeting id, so it cannot be replayed against another
meeting even if it leaks, and it is short-lived and swept by a TTL index rather
than left to a cleanup job. Guests get a synthetic id of the form
`guest:<random>` so everything keyed on a participant id — attendance, knocks,
peers, the audit log — works unchanged while remaining obviously not a Texor
`sub`.

### What a guest cannot do

Everything under `/api` requires a Texor Account **except** five routes: join,
poll their own knock, cancel it, leave, and surrender the pass. That list is
explicit and the default is the strict one, so a route added later is closed to
guests unless somebody deliberately opens it. Each of those five re-checks, once
the meeting is loaded, that the pass is for *that* meeting.

They cannot list meetings, read the full meeting record, download the calendar
invite, see the waiting list, read channels, or reach the admin console. The
guest test suite asserts all of it.

### Guests are always external

A guest has no email and therefore no domain to match, so they are external **by
definition** — never falling through to "nobody is external" when
`ORG_EMAIL_DOMAINS` is unset. In practice that means `forceLobbyForExternal`
holds them in the lobby *even when the host has turned the lobby off*: policy
tightens what a host chose, never the reverse.

Hosts see them in the waiting list marked "Joining by name — no Texor Account",
which is the thing worth knowing before admitting somebody.

### Names

A typed name is shown to everyone in the meeting by somebody who has proved
nothing, so it is stripped of control characters, the bidirectional overrides
that let text render over its neighbours, and runs of whitespace that can push a
name out of its own label. It cannot stop somebody typing a colleague's name —
no name field can — which is why guests are labelled as guests wherever they
appear rather than trusted to identify themselves honestly.

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

### Muting someone

A host can mute anyone. The producer is paused **on the server**, so the audio
stops being forwarded whatever the muted person's browser does about it; they
are also told, so their own button matches reality rather than showing a live
microphone that is going nowhere. `Mute all` does the same to everyone at once
and skips hosts, since otherwise a host silences themselves with their own
button.

**There is deliberately no "unmute someone else", and there will not be.** A
host who could switch on another person's microphone could listen to a room they
are not in. No arrangement of the interface makes that acceptable, and every
serious product draws the line in the same place: a host can mute, and can ask.
The action does not exist on the server, so it cannot be reached by a client
that decides to try.

### Handing the meeting over

A meeting has exactly one host, and that host leaving should not cost the room
its ability to admit people, mute anyone or end cleanly. `POST
/api/meetings/:code/host` moves it to somebody **already in the call** — handing
it to an absent person recreates the problem it exists to solve.

The outgoing host becomes a **co-host**, not a plain participant: they called
the meeting, and stripping them on the way out would be strange if they come
back. Both roles change live, so neither has to rejoin to get their controls.

A host clicking Leave is asked what they mean — hand over, just leave, or end it
for everyone — but **only when it is genuinely a question**: they are the host
and somebody else is still there. Participants, co-hosts, and a host alone in
the room simply leave, because a dialog with no real choice in it is just an
obstacle.

### Removing someone

Both halves happen on the server:

1. The database blocks them from rejoining, for the life of the meeting.
2. The SFU closes their socket and their transports.

Their media stops at our end whether or not their browser cooperates. There is
nothing to ask nicely, and no chance of removing the wrong person by matching on
a display name.

---

## The stage

How the call is arranged is the viewer's choice, not the room's:

| Layout | What it does |
|---|---|
| `auto` | Promotes whoever is presenting or talking, but stays a grid at three people or fewer, where promoting one gains nothing and loses the others |
| `tiled` | Everyone the same size, never rearranged |
| `spotlight` | One person large, the rest in a strip |

Precedence for the large tile is **pin → screen share → active speaker**. A pin
is an explicit instruction, so it outranks everything and holds when somebody
else starts talking.

Any tile with video can be opened fullscreen, from its own button or by
double-clicking it — most useful on a shared screen. In fullscreen the video
switches from `cover` to `contain`: cropping is right in a grid, where the
alternative is letterboxing every face, but someone who asked for fullscreen
wants the whole picture, and cropping a shared screen cuts off the edges of the
thing they enlarged it to read.

On iOS no element can go fullscreen — only a `<video>`, through
`webkitEnterFullscreen`. The tile's name overlay cannot come with it there, and
native video fullscreen is the whole of what is on offer.

## Ending a meeting

A host can end a live meeting from the meetings list without joining it first —
a host who notices a meeting still open after everyone wandered off should not
have to walk back into the room to close the door.

Two details worth keeping:

- **Host only.** `endMeetingNow` refuses anyone else, so a button offered to a
  participant would always fail. A control that cannot work is worse than none.
- **The card is a container, not a `<button>`.** It used to be one big button.
  A button inside a button is invalid markup and the two click targets fight
  over every press, so joining and ending are now siblings.

The confirmation says how many people are still in the call, because ending
drops all of them and there is no undo.

## Duration

Shown in three places, from two fields the server already sent (`startedAt`,
`endedAt`) — no new endpoint, no polling.

| Where | What |
|---|---|
| The call bar | a live clock, ticking each second |
| The meetings list | `12 min in` on each live meeting |
| A meeting's details | `ran for 45:12`, and time in call per person |

All of it is `lib/duration.js`, which takes `now` as an argument rather than
reading the clock. That is what makes "two minutes before the limit" a test
rather than a two-hour wait.

**The timer is its own component.** A one-second tick inside `CallView` would
re-render the stage, every tile and every `<video>` element once a second. As a
leaf it re-renders a `<span>`.

**A countdown appears only near the end.** Most meetings have no
`maxDurationMinutes` at all, and where there is one the room ticker really will
end the call — so saying nothing would be worse. But a countdown running the
whole meeting is a pressure device, so it stays silent until ten minutes remain,
then gets more insistent at two.

**The digits are `aria-hidden`.** A screen reader announcing a changing number
every second would talk over the meeting. The same fact sits beside it in an
`sr-only` span, read on request. Only the countdown warning is `aria-live`, and
its text changes once a minute rather than once a second.

A clock skewed a few seconds ahead of the server reads `0:00` rather than
counting up towards zero.

## Presence

There is no heartbeat endpoint. **A connected socket is a participant who is
present**, which is both simpler and more truthful than a timer: a browser that
crashes drops its connection, the server sees the close, and they leave the
roster at once rather than lingering as a ghost until a timeout expires.

That principle has to be applied everywhere, and not applying it caused a real
bug. `attendance.lastSeenAt` is a periodic write, and the sweep that closes out
absent people reads it — so for a while the sweep could decide that a room full
of connected people had all left, and end the meeting under them. The trigger
was usually somebody *new joining*, because that is a request which loads the
meeting and therefore runs the sweep.

Two things now hold it together:

- The room ticker writes `lastSeenAt` for everyone with an open socket.
- **Anything that loads a meeting consults the live room first.** A timestamp is
  a record of a write; a socket is a fact, and the fact wins.

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

A knock is pushed to every host's call panel the moment it is created, not on
the next tick of anything. A push is a single delivery, though, so there are two
backstops: the panel pulls the list whenever a host opens it (`getKnocks`), and
the room ticker re-pushes every few seconds. A host should never be looking at
an empty panel while somebody waits.

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
| `maxQuality` | A host changes the meeting's video quality, on the settings page or during the call |

**Limits are snapshotted at creation.** A meeting keeps the caps it was created
with, so tightening the policy next month does not retroactively shorten a
meeting already sitting in somebody's calendar.

`maxQuality` is the exception, and deliberately so: it is a **live ceiling**
rather than a snapshot, because it is the one setting that governs what a
meeting costs to run while it is running. A meeting stored above a ceiling that
has since come down is not broken by it — it is clamped to the best tier now
allowed. See [Quality and what it costs](media.md#quality-and-what-it-costs).

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
