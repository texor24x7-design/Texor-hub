# Texor Talk API reference

Base URL in development: `http://localhost:4002`

Authentication is the `talk_sid` cookie, established by the Texor SSO flow.
Browser calls need `credentials: 'include'`.

Errors share the ecosystem-wide shape:

```json
{ "error": { "code": "forbidden", "message": "You are not a member of this channel." } }
```

---

## Authentication

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/auth/login?returnTo=/channels` | Redirects to Texor |
| `GET` | `/api/auth/callback` | Texor returns here with a code |
| `POST` | `/api/auth/logout` | `{ ok, redirectTo }` |
| `GET` | `/api/auth/me` | `{ user }` or `{ user: null }`. `user.isAdmin` gates the admin console |

---

## Channels

All require a session.

### `GET /api/channels`

Every public channel, plus private channels you belong to. Each carries
`isMember`. Sorted by most recent message.

### `POST /api/channels`

```json
{ "name": "Design Team", "topic": "Everything visual", "visibility": "public" }
```

The name is slugified into the channel address — `Design Team` becomes
`design-team`. `409` if that slug is taken. The creator is added as the first
member.

### `GET /api/channels/:id`

`403` if the channel is private and you are not a member.

### `POST /api/channels/:id/join`

Public channels only. `403` on a private channel — a member has to add you.
Idempotent, so a double-click cannot add you twice.

### `POST /api/channels/:id/leave`

---

## Messages

### `GET /api/channels/:id/messages`

| Query | Notes |
|---|---|
| `before` | ISO date — for paging back through history |
| `limit` | 1–100, default 50 |

Returned oldest-first, ready to render. Deleted messages are omitted.

### `POST /api/channels/:id/messages`

```json
{ "body": "Morning all 👋" }
```

Requires membership — being able to *read* a public channel is not enough to
post in it. The author's name and picture are captured at write time.

### `DELETE /api/channels/:id/messages/:messageId`

Soft delete, and only your own messages. `404` for someone else's, which avoids
confirming that a message you cannot see exists.

---

## Meetings

All require a session. `:code` is the human meeting code, `bcd-fghj-kmn`.
See [meetings.md](./meetings.md) for the rules behind these.

### `GET /api/meetings`

| Query | Notes |
|---|---|
| `scope` | `upcoming` (default) · `live` · `past` · `all` |
| `limit` | 1–100, default 25 |

Anything you host, co-host, were invited to, or have attended. Each meeting
carries a `viewer` block — your role, whether you may edit, your RSVP.

`roomName` is never in any of these responses. It is handed out only by `join`,
as part of an evaluated admission.

### `POST /api/meetings`

```json
{
  "title": "Weekly review",
  "agenda": "Roadmap and risks",
  "scheduledStart": "2026-09-21T09:00:00Z",
  "scheduledEnd": "2026-09-21T09:45:00Z",
  "timezone": "Europe/London",
  "access": "texor",
  "recurrence": { "freq": "weekly", "interval": 1, "count": 8 },
  "invitees": [{ "email": "mo@texor.app", "role": "participant" }],
  "channelId": null
}
```

Everything but `title` is optional — with nothing else, you get an instant
meeting that starts when someone opens it. `access` is `invited` · `texor` ·
`anyone`. Passing `channelId` posts the joining link into that channel.

`403` if org policy restricts who may create meetings.

### `GET /api/meetings/:code`

`403` on an `invited`-only meeting you are not on. Other invitees' email
addresses are omitted unless you are the host.

### `PATCH /api/meetings/:code` · `DELETE /api/meetings/:code`

Host and co-hosts only. `DELETE` cancels; for a recurring meeting it cancels the
whole series.

### `GET /api/meetings/:code/invite.ics`

`text/calendar`. An RFC 5545 `VEVENT` with a stable `UID`, a `SEQUENCE` from the
document version, and an `RRULE` when the meeting repeats.

---

## Guests

The only two routes that work with no credential at all.

### `GET /api/meetings/:code/guest`

```json
{ "meeting": { "code": "…", "title": "…", "hostName": "…", "status": "live" },
  "guests": { "allowed": true, "reason": null, "willWait": true } }
```

Deliberately thin — enough to draw a join screen for somebody who has proved
nothing. No agenda, no invitees, no participants, no join link.

### `POST /api/meetings/:code/guest`

```json
{ "name": "Sam Rivera" }
```

Issues a guest pass as an httpOnly cookie scoped to this meeting, and returns
`{ guest: { texorId: "guest:…", displayName, isGuest } }`. `403` unless the
meeting's access is `anyone` and both org policy and the meeting allow external
guests. See [meetings.md](./meetings.md#guests) for what the pass does and does
not permit.

### `POST /api/meetings/:code/guest/leave`

Surrenders the pass and clears the cookie.

---

## Joining

### `POST /api/meetings/:code/join`

The whole access decision. Answers one of two ways:

```json
{ "status": "admitted", "media": { "role": "host", "isModerator": true, "canShareScreen": true,
                                   "startMuted": false, "startCameraOff": false }, "meeting": {} }
{ "status": "waiting",  "knockId": "…", "expiresAt": "…", "meeting": {} }
```

Refusals carry a code worth acting on rather than only printing:

| Status | `code` | Means |
|---|---|---|
| `403` | `forbidden` | Not invited, removed, or external guests are not allowed |
| `409` | `host_not_present` | Nobody is in the meeting to admit you |
| `409` | `meeting_full` | At the participant cap |
| `410` | `meeting_ended` · `meeting_cancelled` · `meeting_over` | |
| `425` | `too_early` | `details.opensAt` says when it opens |

### `GET /api/meetings/:code/knocks/:knockId/status`

Polled by the person waiting. `waiting` · `denied` · `expired`, or `admitted`
with the same `media` grant as a direct join. `403` if the knock is not yours.

### `DELETE /api/meetings/:code/knocks/:knockId`

Give up waiting.

### `GET /api/meetings/:code/knocks`

Host and co-hosts. Everyone currently waiting, oldest first.

### `POST /api/meetings/:code/knocks/:knockId`

```json
{ "decision": "admit" }
```

Host and co-hosts. `404` if the knock is no longer waiting — which is what makes
two hosts clicking at once produce one decision rather than two.

---

## In the call

Presence is the media socket, not an endpoint — see
[media.md](./media.md#the-signalling-protocol). An open socket is a participant
who is present, and the roster, waiting list, role changes, removals and the end
of the meeting are pushed down it.

### `POST /api/meetings/:code/leave` · `POST /api/meetings/:code/end`

`end` is host and co-hosts only, and ends it for everybody.

### `POST /api/meetings/:code/participants/:texorId/role`

```json
{ "role": "cohost" }
```

**Host only** — co-hosts cannot make co-hosts. Takes effect immediately for
someone already in the call; `appliedLive` says whether it reached a live socket.

### `DELETE /api/meetings/:code/participants/:texorId`

Blocks a rejoin, and closes their media socket and transports at once.

---

## Invitations

### `POST /api/meetings/:code/invitees`

```json
{ "invitees": [{ "email": "sam@partner.com", "name": "Sam", "role": "participant" }] }
```

Host and co-hosts. Already-invited addresses are skipped rather than duplicated.
`403` if an address is external and policy forbids external guests.

### `DELETE /api/meetings/:code/invitees/:email`

### `POST /api/meetings/:code/rsvp`

```json
{ "response": "accepted" }
```

`accepted` · `declined` · `tentative`. `404` if you are not on the list.

---

## Administration

Every route requires admin — `ADMIN_EMAILS`, or `policy.adminTexorIds`.
`403` otherwise.

### `GET /api/admin/policy` · `PUT /api/admin/policy`

`GET` also returns an `environment` block: the media announced address, RTC port
range and live worker stats, plus the admin emails and internal domains. Those
come from deployment config and are not editable here.

`PUT` takes any subset of the policy and responds with `changed` — the fields
that actually differed.

### `GET /api/admin/audit`

| Query | Notes |
|---|---|
| `action`, `actorTexorId`, `meetingCode` | Filters |
| `since`, `until` | ISO dates |
| `before` | Cursor — a `seq` from a previous page's `nextBefore` |
| `limit` | 1–200, default 50 |

Newest first. Cursor paging rather than offsets, because the log only grows at
the head and offsets would shift rows under the reader between clicks.

### `GET /api/admin/audit/verify`

```json
{ "verification": { "ok": true, "events": 412, "firstSeq": 1, "lastSeq": 412, "head": "9f3a…",
                    "tamperedSeqs": [], "missingSeqs": [] } }
```

Re-hashes every row and checks the sequence for gaps. See the limits of what
this proves in [meetings.md](./meetings.md#the-audit-log).

### `GET /api/admin/meetings`

Every meeting in the organisation. `status` is `live` (default) · `scheduled` ·
`ended` · `cancelled` · `all`.

---

## Health

`GET /api/health` → `{ "status": "ok", "service": "talk" }`
