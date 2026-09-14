# The media layer

Texor Talk carries its own audio and video. There is no conferencing service
behind it, no account to create, no app id or secret to paste in, and no domain
to point at. The media server is [mediasoup](https://mediasoup.org) — open
source, ISC licensed — imported as a dependency, and the API process spawns and
owns it.

```
  Browser                              texor-talk backend (:4002)
  ───────                              ──────────────────────────
  mediasoup-client   ──WebSocket──▶    signalling  (same talk_sid cookie)
    Device                                  │
    send transport   ──WebRTC/SRTP──▶   mediasoup workers (C++, one per core)
    recv transport   ◀──────────────       Router per meeting
                                            Producers / Consumers
```

Two processes, and both are ours. Nothing in this diagram is a third party.

---

## Why an SFU

Three ways to move media between people, and only one of them scales.

| | How it works | Where it breaks |
|---|---|---|
| **Mesh** | Everyone sends to everyone | Each person uploads N−1 copies. Falls over at about five people |
| **MCU** | Server decodes, mixes, re-encodes | One video mixer per meeting. CPU cost is enormous |
| **SFU** | Server forwards packets without decoding | The right answer, and what this is |

An SFU never looks inside the media. It receives one stream from each
participant and forwards it to the others, so a participant uploads once no
matter how many people are listening, and the server spends almost no CPU per
stream because it is routing packets rather than transcoding them.

That is also why this can run inside the Node process at all: the heavy lifting
is packet forwarding in a C++ worker, not video encoding.

### Simulcast

Each participant sends their camera at three resolutions at once, and the SFU
forwards whichever one each *viewer* can carry. That is what makes a grid of
twelve people work: without it the sender picks one quality for everybody, and a
single person on hotel wifi drags the whole call down to theirs.

Screen shares deliberately do not use simulcast — one high-quality layer,
because legible text matters more than adapting resolution.

**Do not put `scalabilityMode` on these encodings.** An earlier version set
`S1T3` on every layer and Chrome refused the whole transceiver with *"Attempted
to set RtpParameters scalabilityMode to an unsupported value for the current
codecs"* — which surfaced as screen sharing simply not working. `S1T3` is not a
real value: the registry spells temporal-only layering `L1T3`, and the
`S`-prefixed modes are VP9/AV1 spatial modes. Even the correct `L1T3` is only
accepted by codecs that implement it, and which codec gets negotiated is not
known when the encodings are written. Simulcast does not need it.

The values live in `frontend/src/lib/encodings.js` so the test suite imports the
same ones the browser uses, and `produceVideo` retries once without encodings if
a browser refuses them — losing the layering rather than the track.

---

## Configuration

The whole of it:

```bash
MEDIA_ANNOUNCED_ADDRESS=127.0.0.1   # the one that matters
MEDIA_RTC_MIN_PORT=40000
MEDIA_RTC_MAX_PORT=40100
# MEDIA_WORKERS=4                   # defaults to the CPU count
MEDIA_LOG_LEVEL=warn
MEDIA_MAX_BITRATE=1500000
```

### `MEDIA_ANNOUNCED_ADDRESS`

The single setting that decides whether a call works.

It is written into the ICE candidates handed to the browser, so it has to be an
address that browser can actually reach. Get it wrong and the symptom is not an
error — it is a call where everyone connects, sees each other's names, and hears
nothing. The signalling worked; the media had nowhere to go.

| Where you are running | Set it to |
|---|---|
| One machine, development | `127.0.0.1` |
| Testing across a LAN | That machine's LAN address, e.g. `192.168.1.20` |
| A server | Its **public** address |
| Behind NAT, or in a container | The public address, not the internal one |

The admin console flags a local-only address on its Deployment tab, and the API
warns at boot when running in production with one.

### Ports

The SFU binds `MEDIA_RTC_MIN_PORT`–`MEDIA_RTC_MAX_PORT` for media, **UDP and
TCP**, and these must be open in the firewall. Roughly two ports per participant
is a safe allowance; the default range of 100 is plenty for development and
should be widened for a real deployment.

TCP is offered as a fallback for networks that block UDP outright. It is worse
for real-time media, but it is the difference between a bad call and no call on
a corporate network.

### Workers

One mediasoup worker is one CPU core, and cannot use more than one. The pool
defaults to the machine's core count and meetings are handed out round-robin, so
load spreads across cores instead of piling onto one.

A worker that dies takes every meeting on it with it. There is no way to recover
those calls in place, so the process logs it and exits rather than limping on
with a fraction of its capacity silently gone.

---

## Access control

This is where owning the media layer pays for itself.

The signalling socket carries the same `talk_sid` session cookie as every other
request. The server resolves the real Texor identity from it and then runs the
**same `evaluateJoin`** the REST API runs — one notion of who someone is, one
set of rules, no second system to keep in step.

Concretely, these are enforced by the process that owns the media:

- **The lobby.** Someone who has not been admitted has no socket, and without a
  socket there is no transport and no way to send or receive anything.
- **Roles.** `role` is a field on the peer. A promotion to co-host takes effect
  immediately, on the call in progress.
- **Removal.** The server closes the socket and the transports. Their media
  stops at our end whether or not their browser cooperates.
- **Screen sharing.** A hosts-only meeting *refuses the producer*. Hiding the
  button is a hint; refusing the track is the rule.
- **Capacity and duration.** Checked on join, and by the room ticker.

> **What changed.** An earlier version of this product embedded a third-party
> conferencing service and authenticated with a JWT minted for it. That worked,
> but the access rules were only real if that deployment was configured to check
> the tokens — and a misconfiguration there silently downgraded the lobby and
> host roles to advisory. There is nothing left to misconfigure: the rules are
> enforced in the same process that forwards the packets.

---

## Presence

A connected socket is a participant who is present. That is more truthful than a
timer, and it is why there is no heartbeat endpoint: a browser that crashes
drops its TCP connection, the server sees the close, and the person leaves the
participant list immediately rather than lingering as a ghost.

A ping/pong on the room ticker catches the case where a connection dies without
a close frame ever arriving.

---

## The signalling protocol

JSON over one WebSocket at `/ws/meeting?code=<meeting code>`. A message with an
`id` is a request and gets exactly one reply carrying the same `id`; a message
without one is a notification.

**Client → server**

| Action | Purpose |
|---|---|
| `setCapabilities` | What this browser can decode |
| `createTransport` | `{ direction: 'send' \| 'recv' }` |
| `connectTransport` | DTLS parameters |
| `produce` | Start sending a track — `{ kind, rtpParameters, source }` |
| `closeProducer`, `pauseProducer`, `resumeProducer` | Stop, mute, unmute |
| `consume`, `resumeConsumer` | Start receiving someone else's track |
| `admitKnock`, `removePeer`, `endMeeting` | Host actions |
| `chat` | In-call message |
| `reaction` | One of a fixed set of emoji |

**Server → client**

`welcome` · `peerJoined` · `peerLeft` · `newProducer` · `producerClosed` ·
`producerPaused` · `producerResumed` · `consumerClosed` · `knocks` ·
`knockResolved` · `roleChanged` · `peerRoleChanged` · `chat` · `reaction` ·
`removed` · `ended` · `refused`

**Reactions are allowlisted server-side.** Whatever arrives is broadcast
verbatim to every participant, so the emoji must be one of the fixed set in
`REACTIONS`; anything else is refused rather than sanitised. They are never
stored and never replayed to someone who joins later — a reaction is a moment in
the call, and a durable record of everything everyone clapped at would be a
different feature with different privacy questions attached.

---

### Three ordering details that matter

**Listeners before `welcome`.** mediasoup-client replies the instant it has the
router's capabilities. If the server attaches its `message` handler even one
`await` after sending `welcome`, that first reply is dropped by the socket and
the client waits forever for an answer to a request nobody received.

**Consumers start paused.** A consumer is created paused and resumed only once
the client has attached the track to an element. Otherwise the first seconds of
video arrive before there is anywhere to draw them, and the stream appears
frozen until the next keyframe.

**The roster is seeded before tracks are consumed.** `welcome` lists everyone
already present and what they are sending, and the client must record that list
*before* it starts consuming — because each consumed track arrives as a callback
that attaches to a peer in that list. Seeding it afterwards overwrites the
tracks that just arrived, and a new joiner sees blank tiles until somebody
toggles their camera and produces again. This was a real bug; the late-joiner
test in `tests/media.test.mjs` is what now holds the server's half of the
contract in place.

---

## Testing it without a browser

`mediasoup-client` ships a `FakeHandler` that stands in for the browser's WebRTC
stack. Real clients, real sockets, real transports and real producers and
consumers against the running SFU — everything except DTLS handshaking and RTP
on the wire. That is what the media test suite uses.

What it cannot cover, and what still needs a real browser: camera and microphone
capture, the DTLS handshake, actual packet flow, and echo cancellation.

---

## Troubleshooting

**Everyone connects, nobody can hear anything** — `MEDIA_ANNOUNCED_ADDRESS`. It
is almost always this. The browser is sending media to an address it cannot
reach.

**Works on one machine, fails across the network** — the same thing, plus check
the RTC port range is open for UDP.

**`npm install` fails building the worker** — mediasoup compiles a C++ worker
and needs Python 3 and a C++17 toolchain. On macOS that is the Xcode command
line tools; on Debian, `build-essential` and `python3-pip`.

**Camera or microphone never prompts** — browsers only release devices on a
secure origin. `localhost` counts; a LAN address like `192.168.1.5:3002` does
not, so testing across devices needs HTTPS on the frontend too.

**Duplicate key error on `roomName` when creating a meeting** — a database from
before this change still has the old unique index. Run
`npm run migrate:media` once.
