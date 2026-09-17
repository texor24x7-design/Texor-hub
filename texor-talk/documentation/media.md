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

### Screen shares

No simulcast, deliberately: everybody watching should see exactly what the
person sharing sees, and layers would mean some of them quietly getting a worse
one. The ceiling comes from the meeting's quality tier (see
[Quality and what it costs](#quality-and-what-it-costs)) and is far above a
camera's — a 1080p desktop at 30fps with text and scrolling will use all of it,
and starving it shows up as **dropped frames rather than softness**.

Four settings decide what a share looks like, and all four have to agree:

| | Effect |
|---|---|
| `getDisplayMedia({ video: { width, height } })` | **How many pixels are captured** |
| `getDisplayMedia({ video: { frameRate } })` | How many frames are captured |
| `track.contentHint` | What the **encoder** protects |
| `degradationPreference` | What the **sender** protects |

### Capture size is the one that was missing

For a long time only `frameRate` was asked for, so the browser handed back the
display's native resolution. On a retina panel or a 4K monitor that is three or
four times 1080p, and encoding it into a few Mbps is a fraction of a bit per
pixel. The encoder's only move is to discard detail until it fits — so the share
arrives soft and blocky **while the bitrate graph looks perfectly healthy**.

None of it shows on a developer's machine, because a localhost transport has no
ceiling to press against. It is a production-only failure by construction.

Capture is now capped by the tier's `screenMaxHeight` (1080p, or 720p on Data
saver), as `max` rather than `ideal` so a small screen is never scaled *up*.
Downscaling at capture beats letting the encoder do it: the scaler is cleanly
resizing a sharp source, where the encoder is throwing away high-frequency
detail it cannot afford — which is precisely what turns text to mush.

Getting any one of them wrong wastes the other two. This product previously
capped capture at 15fps and set neither hint, so browsers — which treat captured
screens as detail content by default — held resolution and dropped frames. The
result was a share that looked sharp and moved like a slideshow.

The trade-off is exposed rather than assumed, because it is a judgement about
the content: **Keep it smooth** (motion, 30fps, `maintain-framerate`) for demos
and video, **Keep it sharp** (detail, `maintain-resolution`) for code and
spreadsheets. Smooth is the default — a softer picture still reads, whereas a
slideshow is unusable for anything you are actively doing.

### The camera competes with the share

Both are senders on one transport with one bandwidth estimate. A camera at its
full ceiling plus a screen at its own is asking for the sum of the two, and a
real uplink often cannot cover it. The browser's allocator then divides what
there is, and the screen share — the thing everybody in the meeting is actually
looking at — is starved along with everything else.

So the camera stands down while a screen is up: `PRESENTING_CAMERA_BITRATE`
(300 kbps) instead of its tier ceiling, restored the moment the share stops.
Nobody studies a presenter's face at full resolution while a screen is up, and
the tile it is drawn in is small. The screen producer also carries
`networkPriority: 'high'`, so it wins the split rather than sharing it evenly.

This is the usual cause of "the share bitrate is low *sometimes*" — the sometimes
being whenever the presenter also has their camera on.

**More than one person can share at once.** Each share is an ordinary producer
attributed to its owner, so they all coexist; the stage shows the most recent
and offers a switcher when there are several. The roster is re-sent whenever a
producer starts or stops, so a share whose `newProducer` went missing is
repaired immediately rather than at the next tick.

### Screen audio

A share sends its audio as a **separate producer**, labelled `screenAudio`, so
it can be stopped independently and so the far side can tell program audio from
a microphone.

Every browser processing step is switched **off** for it — echo cancellation,
noise suppression, automatic gain. Those exist to make a voice picked up by a
microphone intelligible; applied to music or a video they pump, duck and sound
underwater. Opus is configured differently too: stereo, and `opusDtx: false`,
because discontinuous transmission saves bandwidth by going quiet in pauses,
which is right for speech and clips the tails off everything in music.

**Whether there is any audio at all is the browser's decision, not ours.**
Chrome offers tab audio when a tab is picked, and system audio only on Windows;
Firefox and Safari offer neither. `audio: true` asks and never guarantees, so
the track is often simply absent — the share proceeds without it and says so
rather than failing.

**Two things that would otherwise go wrong, and how they are avoided:**

- *Echo.* A presenter never receives their own producers back — the SFU does not
  forward a peer its own media — so there is no round trip to hear. The
  remaining path is their microphone picking up their own speakers, which is
  what echo cancellation on the **microphone** (left on, unlike the screen
  track) is for.
- *The hall of mirrors.* The presenter is never shown their own screen feed.
  Sharing a whole screen that contains a window showing that screen is infinite
  regress, so they get a "You are presenting" card instead. They can already see
  what they are sharing; it is on their screen.

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

## Quality and what it costs

Bitrate is the main running cost of this product, and it is not a deployment
setting. An SFU forwards every stream to every participant, so the bandwidth a
meeting burns is roughly **headcount × bitrate** — one person raising quality
raises the bill for everybody in the room with them.

So it has two levels, and the separation is the whole design:

| | Who sets it | Where |
|---|---|---|
| **Ceiling** | an admin | `/admin` → *Highest video quality* (`Policy.maxQuality`) |
| **Tier** | the host | the meeting's settings page, or the bar during the call (`Meeting.quality`) |

A host may pick anything **at or below** the ceiling. Raising it above is
refused with the plan named in the message; the ceiling is the only place a
limit can go up, which is what makes it a commercial lever rather than a
preference.

The tiers live in `services/quality.service.js`:

| Tier | Camera | Screen | Screen fps |
|---|---|---|---|
| Data saver | 0.4 Mbps | 1 Mbps | 15 |
| Standard | 1 Mbps | 2.5 Mbps | 30 |
| High | 1.5 Mbps | 5 Mbps | 30 |

Named tiers rather than raw numbers, because "1800000" is not a decision anyone
can make well, and the names survive the numbers behind them being tuned.

### Clamping, not rejecting

`effectiveTier(requested, ceiling)` returns the best tier allowed, never an
error. Downgrading the organisation's plan therefore does not break meetings
already scheduled at a tier that is no longer available — they quietly run at
the best tier now permitted. Anything unrecognised lands on Standard.

New meetings start at Standard (or the ceiling, if that is lower). Nobody should
be spending the most by default.

### Changing it mid-call

The host's choice applies **live**, because the moment anyone wants this is the
moment somebody says the screen share is stuttering. Three things move in this
order, and the order matters:

1. the tier is stored on the meeting, so it survives a rejoin
2. every peer's send transport gets a new `setMaxIncomingBitrate` — **before**
   anyone is told to send more, or the first client to react has its extra
   bitrate thrown away by the SFU
3. a `quality` message goes to the whole room

Clients react by rewriting `maxBitrate` on their existing senders with
`RTCRtpSender.setParameters`. Bitrate is a parameter on a sender, not part of
the negotiated session, so **there is no renegotiation and no black frame** —
the encoder simply starts targeting a different number on its next frame.
Re-producing would have worked too, and would have shown every viewer a gap.

Two constraints on that rewrite:

- the **number of encodings must not change**. `setParameters` rejects a list of
  a different length than the sender was created with, so the ladder is rebuilt
  against the new ceiling and keeps its shape — the small simulcast layers stay
  proportionally small instead of all collapsing onto the top.
- **frame rate is not a sender parameter.** It is a constraint on the track, so
  a screen share additionally gets `applyConstraints({ frameRate })`. Some
  capture sources refuse this mid-share; that is caught, and the tier's bitrate
  still applies.

### Enforcement is on the send side only

Capping what somebody may *receive* would punish them for the number of people
in the room, which is not their doing. The cost is controlled at the source:
`createTransport` sets `maxIncomingBitrate` on send transports, and
`maxSendBitrate(tier)` covers a microphone, a camera and a screen at once plus
headroom — a cap a legitimate sender bumps into produces exactly the stuttering
this exists to prevent.

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

## Who is talking

Decided by the SFU, not by each browser. Every client watching its own audio
levels would give a different answer at a different moment, and none of them
would agree about somebody they cannot hear. The router sees every stream, so it
is the only place the question has one answer.

It uses an **`AudioLevelObserver`**, and the choice matters. mediasoup also
offers `ActiveSpeakerObserver`, which runs a proper dominant-speaker algorithm —
but it emits `dominantspeaker` and nothing else. There is **no silence event**,
so it can say who started talking and never that everybody stopped: a highlight
driven by it is set once and then sits on whoever last spoke for the rest of the
call. That was a real bug here. `AudioLevelObserver` reports `volumes` while
there is sound and `silence` when there is not, which is both halves.

- `threshold: -50` dBov. Speech from a laptop microphone sits around −35; a
  quiet room with noise suppression on sits below −60. Set it much lower and a
  fan or a keyboard holds the highlight.
- Only `mic` producers are added to the observer. A shared screen playing a
  video would otherwise win it permanently.
- Changes are deduplicated — `volumes` fires every interval for as long as
  somebody talks, and without that a long anecdote is thousands of identical
  messages to everyone in the meeting.
- The client turns the highlight **off** on a delay and **on** immediately.
  Silence is reported in the gaps between words as well as at the end of a
  sentence, so clearing at once makes the ring strobe mid-thought.

The rule lives in `src/media/speaking.js` with no imports, so
`tests/speaker.test.mjs` drives the observer's events directly — the one thing a
headless harness cannot do is generate real audio energy.

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
| `muteParticipant`, `muteEveryone` | Host actions. There is no unmute-others |
| `raiseHand`, `lowerHand` | A raised hand is state, not a reaction |
| `chat` | In-call message |
| `reaction` | One of a fixed set of emoji |
| `setCaptions` | Host action. Transcribe this meeting, or stop |

**Server → client**

`welcome` · `peerJoined` · `peerLeft` · `newProducer` · `producerClosed` ·
`producerPaused` · `producerResumed` · `consumerClosed` · `knocks` ·
`knockResolved` · `roleChanged` · `peerRoleChanged` · `chat` · `reaction` ·
`removed` · `ended` · `refused` · `activeSpeaker` · `handChanged` ·
`forceMuted` · `caption` · `captions`

### The one message that is not JSON

Caption audio travels as **binary frames on this same socket** — see
[captions.md](./captions.md#the-wire-format). A second connection just for audio
would need its own authentication, its own lifetime and its own reconnect, and
would be a way to send audio for a meeting you are no longer in.

Here the frame is attributable by construction: this socket already *is* one
authenticated person in one meeting, so the header carries no speaker field for
a client to lie in — and no timestamp either, since the server derives the
timing from the sample count.

`welcome` carries a `captions` block alongside `rtpCapabilities`, because the
client has to know whether the meeting is being transcribed before it decides
whether to open an audio tap on somebody's microphone.

### Deltas converge, they do not merely fire

`peerJoined`, `peerLeft` and `newProducer` are *deltas*, and a delta is a single
delivery: `send` drops it silently when that socket is not open at the instant
it fires — mid-reconnect, for example. Nothing then corrects it, so one
participant carries a wrong roster for the rest of the call. That happened: two
people saw three participants and the third saw two.

So every membership change now sends the delta **and** an authoritative `roster`
message, and the room ticker re-sends that roster every few seconds. The deltas
give immediacy; the roster gives correctness. On receipt the client replaces its
membership list — anyone absent has genuinely gone — while keeping the
`MediaStreamTrack`s it already holds, and consumes any producer in the roster it
is not yet receiving, which repairs a missed `newProducer` the same way.

This is the same lesson as the lobby: **a push is a single delivery, so anything
built only from pushes needs a reconciliation pass behind it.**

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
