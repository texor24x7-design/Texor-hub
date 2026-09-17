# Live captions and transcripts

Texor Talk transcribes its own meetings. There is no speech API behind it, no
key to paste in, and no audio leaving the deployment. The recogniser is
[whisper.cpp](https://github.com/ggerganov/whisper.cpp) — open source, MIT
licensed — compiled into `node_modules` by `npm install` and run inside the API
process, exactly as the SFU is.

```
  Browser                                   texor-talk backend (:4002)
  ───────                                   ──────────────────────────
  microphone track
    │
    ├─▶ AudioWorklet ──▶ 16 kHz mono frames
    │     (caption-tap.js)      │
    │                     lib/vad.js  finds where an utterance starts and ends
    │                           │
    │                     binary frame ──WebSocket──▶  whisper.cpp (C++, in process)
    │                                                        │
    │                                            text + language + confidence
    │                                                        │
    └────────────  caption broadcast  ◀──────────────────────┤
                                                             │
                                                    Transcript (MongoDB)
```

The audio for captions is a **second read of the local microphone track**, not
the audio arriving from the SFU. Three reasons, and the third is the one that
matters most:

- this side of the wire the audio has not been through Opus, packet loss or
  discontinuous transmission, and recognition is markedly more accurate on it
- the words need no speaker attribution guesswork — the socket carrying them
  *is* one authenticated person
- muting stops the capture at the source, rather than stopping it somewhere
  downstream of a microphone that is still being read

---

## Setup

Two steps beyond `npm install`, both in `backend/`:

```bash
npm run captions:setup     # rebuild whisper.cpp for this CPU, then fetch the model
npm run captions:check     # speak a sentence through it and report the speed
```

`captions:setup` is `captions:build` followed by `captions:model`, which can be
run separately.

### Why the rebuild is not optional

`smart-whisper`'s `binding.gyp` passes no instruction-set flags, so a default
`npm install` compiles ggml's scalar fallback kernels even on a machine with
AVX2 sitting idle. The difference is not marginal. Transcribing the same 4.4
second clip on a six-core i7-9750H:

| build | inference | vs. real time |
|---|---|---|
| stock `npm install` | 15.5s | **3.5× slower** than the speech |
| `npm run captions:build` | 1.5s | 2.9× faster |

At the first number captions do not work: utterances arrive faster than they can
be recognised, and the queue spends the meeting shedding them. `captions:build`
detects what the CPU actually supports — it will not emit AVX2 on a machine
without it — and `WHISPER_BUILD_FLAGS` overrides the detection when the binary
is built somewhere other than where it runs.

### Which model

`npm run captions:model -- <name>`, or set `WHISPER_MODEL`.

| | size | notes |
|---|---|---|
| `tiny` | 75 MB | Fastest. Visibly weaker on accents and on anything but English |
| `base` | 148 MB | **The default.** Multilingual, real time on a modern CPU |
| `small` | 488 MB | Better on accented and code-switched speech, ~3× the work |
| `medium` | 1.5 GB | Better again, and needs a GPU to keep up with a meeting |

Use the plain names rather than the `.en` ones unless the deployment is certain
to be English-only. An `.en` model cannot transcribe anything else at all, and
it fails by confidently producing English-looking nonsense rather than by saying
it cannot.

---

## Languages

`WHISPER_LANGUAGE` defaults to `auto`, which detects the language **per
utterance** rather than per meeting. This is the setting to leave alone: a
meeting is not in one language, and people switching between two mid-conversation
is the ordinary case rather than the exotic one. The detected language is stored
on each utterance, so a transcript records that one line was Telugu and the next
was English.

Pin it to a language code only when a deployment is genuinely monolingual. It is
slightly faster and slightly more accurate when that is true, and quietly wrong
when it is not.

---

## Who decides

Three gates, and all three must be open:

| | Who sets it | Where |
|---|---|---|
| **The organisation allows captions** | An admin | `/admin` → `allowCaptions` |
| **The organisation keeps transcripts** | An admin | `/admin` → `storeTranscripts` |
| **This meeting is captioning** | A host, live | The transcript panel in the call |

The org can only ever turn things *off*: a host cannot switch on something the
organisation has withdrawn, and an organisation that allows captions does not
thereby turn them on in anybody's meetings.

`allowCaptions` and `storeTranscripts` are deliberately separate. "Help people
follow the conversation" and "keep a durable, attributed record of what everyone
said" are different asks with different answers, and collapsing them into one
switch would force the larger answer on anybody who wanted the smaller one.

### Everybody is told

Turning captions on broadcasts to every participant, naming who did it and
saying whether a transcript is being kept. That notice is the consent — nobody
should have to notice a small indicator to discover they are being recorded. The
switch itself is audited on both edges (`captions.started`, `captions.stopped`),
as are exports and deletions.

### Muting

A muted participant is never transcribed, and this is enforced twice. The
browser tears the audio tap down — not pauses it, tears it down — so nothing is
reading the device at all. The server independently refuses audio from any peer
with no live, unpaused microphone producer, so a modified or broken client
cannot transcribe somebody who believes they are muted.

The server check is strict, which can cost the last word of a sentence when
somebody mutes the instant they stop speaking. That is the right way round.

---

## What the recogniser gets wrong, and what is done about it

Whisper does not return "nothing" for audio with no speech in it. It returns its
best guess, and on silence, breath, a keyboard or a fan that guess comes from
the most common phrases in its training data — subtitle files. Left unfiltered, a
stored transcript of a quiet meeting is page after page of `Thank you.`,
`Thanks for watching!` and `[BLANK_AUDIO]`.

`backend/src/utils/transcript.js` is the filter, and every rule in it is
exercised by `backend/tests/transcript.test.mjs`:

- **Bracketed annotations are stripped**, not rejected — `[Music] so as I was
  saying` is a real sentence with a label stuck to the front of it
- **Runaway repetition is collapsed.** Three in a row is something a person says;
  beyond that it is the decoder stuck in a loop
- **Filler phrases are only dropped when something else already says the audio
  was thin.** "Thank you" is a thing people say in meetings, so it is dropped on
  low confidence, a very short clip, or —
- **— text too sparse for the clip it came from.** The signal that catches what
  the others miss: two seconds of pure digital silence came back as `" you"`,
  with high confidence. One short word stretched over two seconds is not somebody
  speaking slowly, it is a void being filled
- **And text too *dense* for the clip.** Three words a second is not physically
  plausible; if the text could not fit in the audio, it was invented

---

## Segmentation

Whisper transcribes a clip. It does not find the clip, and finding it is most of
what decides whether captions are any good — hand the model a fixed window and
you get sentences cut in half at both ends, which it then fills in by guessing.
So bad segmentation reads as bad recognition, and the wrong thing gets blamed.

`frontend/src/lib/vad.js` does this in the browser, and is pure so it can be
driven with synthetic audio by `frontend/tests/vad.test.mjs`:

- the speech threshold is **measured, not fixed**. A headset in a quiet room sits
  thirty decibels below a laptop microphone next to a fan, and one number cannot
  be right for both. The noise floor is tracked from the quiet stretches and
  speech is whatever rises well clear of it
- an **absolute floor** underneath that, so a perfectly silent input cannot drive
  the measured floor to zero and make rounding error count as talking
- **200 ms of pre-roll**, because the detector needs a frame or two to be sure and
  by then the first consonant has gone past. A clipped first word is the most
  noticeable caption error there is
- a **600 ms hangover** ends a turn; shorter clips sentences, longer runs two
  remarks together
- a **10 second ceiling** cuts a monologue into consecutive clips rather than one
  that grows forever — and the tail is not thrown away, the next clip opens from
  the frame that closed the last
- a **flush** on mute or hang-up, so the last thing said before somebody leaves is
  not simply lost

---

## Keeping up

Recognition is serial: `whisper_full()` mutates decoder state on the model
context, so two transcriptions against one context is a data race in C++ that
corrupts output or segfaults much later. One model, one job at a time, and
`n_threads` spreads the work across cores.

That makes a backlog possible, so the queue is small and sheds rather than
grows. An unbounded queue turns a busy meeting into captions that fall further
behind for the rest of the call — the words still arrive, minutes after they
were said, which is worse than useless because it looks like the feature works.

- **interim results are dropped first.** They are a redraw of a sentence still
  being spoken, and the final for that same utterance says it properly
- **finals are never dropped to make room for finals** — that would put holes in
  the stored record in arrival order
- **anything waiting longer than `CAPTIONS_STALE_MS` is abandoned unheard.** A
  caption for a sentence fifteen seconds gone lands in a different conversation

`/api/captions` and the deployment panel in `/admin` both report
`realtimeFactor`: inference time divided by the length of the audio. Below 1 and
captions keep up with a room. Above it, start with `captions:build`, then
`CAPTIONS_INTERIM=false`, then a smaller model.

---

## The transcript

One document per meeting, in the `transcripts` collection, holding utterances in
the order they were spoken. Rendered, it is the conversation:

```
surya: endhuko telidu.
john: I don't know either.
```

Consecutive utterances from one person are joined into a turn, because somebody
speaking for thirty seconds produces six or seven utterances and printing each
on its own line with their name repeated seven times is technically accurate and
unreadable.

Appends are `$push`, never read-modify-write: several people talk at once and
each utterance finishes recognition on its own schedule, so loading the document
and saving it back would silently drop whichever lost the race.

Each utterance stores `offsetMs` from the start of the meeting as well as the
wall-clock time, because a reader three weeks later cannot place `14:42:07` but
can find `[12:03]`.

### Reading it

| | |
|---|---|
| `GET /api/meetings/:code/transcript` | The conversation as data |
| `GET /api/meetings/:code/transcript.txt` | The same, as a timestamped file |
| `DELETE /api/meetings/:code/transcript` | Soft-delete. Owner only |

Access is by **attendance**, not invitation: being invited to a meeting you did
not attend does not entitle you to a record of what the people who did attend
said. Guests never get one — a guest is a name typed into a box with a pass that
expires in hours. Somebody who was not there receives `404`, not `403`, because
meeting codes are guessable by design and a `403` would be a way to enumerate
real meetings and learn which of them were captioned.

There is deliberately **no route that edits a transcript**. One that anybody
could rewrite is not a record of anything.

Deleting is restricted to the meeting's owner rather than to whoever is
currently hosting — a stand-in host, promoted because they arrived first, should
not be able to destroy the record of what a room full of people said. The row is
soft-deleted so the audit line above it still refers to something.

### Retention

`transcriptRetentionDays` in `/admin`, enforced by a TTL index rather than by a
job somebody has to remember to run. `0` keeps transcripts indefinitely.

Changing it **re-applies to transcripts already stored**. "We keep transcripts
for thirty days" is a statement about the material the organisation is holding;
a setting that only governed future meetings would leave every existing
transcript kept forever.

Switching `storeTranscripts` off does *not* delete what is already there.
Withdrawing permission to record in future is a different decision from
destroying the record of what already happened, and the second should never be a
side effect of the first.

---

## The wire format

One utterance, as a binary WebSocket frame on the meeting's existing socket:

```
┌────────────┬──────────────────┬──────────────────────────────┐
│ 4 bytes BE │ JSON header      │ Int16LE PCM, 16 kHz mono     │
│ header len │ {utteranceId,…}  │                              │
└────────────┴──────────────────┴──────────────────────────────┘
```

Binary rather than base64 into the JSON messages the socket already carries,
which would be a third more bytes on the one message type where the payload is
large. Int16 rather than the Float32 the audio graph produces halves it again
and costs nothing that matters.

The header carries **no speaker and no timestamp**. Both are things the server
works out for itself — the speaker is whoever authenticated this socket, the
timing comes from the sample count — so neither is something a client could get
wrong or lie about, and neither can be forged into a permanent record of who
said what and when.

`frontend/src/lib/captions.js` encodes; `backend/src/media/audio-frame.js`
decodes; `backend/tests/transcript.test.mjs` round-trips the browser's encoder
through the server's decoder, because a format agreed in two files and verified
in neither is how captions end up silently never appearing.

Per-peer audio is capped at three times what continuous speech can produce.
Every other message on the socket is a small object from an allowlist; audio is
the exception, because the payload *is* the cost.

---

## Settings

All optional — the defaults are the intended configuration.

| | default | |
|---|---|---|
| `CAPTIONS_ENABLED` | `true` | Switch the whole feature off for this deployment |
| `WHISPER_MODEL` | `base` | Model name, or a path to a `.bin` |
| `WHISPER_MODELS_DIR` | `.models` | Where `captions:model` writes |
| `WHISPER_LANGUAGE` | `auto` | Per-utterance detection. Leave it alone |
| `WHISPER_THREADS` | physical cores | Hyperthreads do not help ggml |
| `CAPTIONS_INTERIM` | `true` | Re-transcribe mid-sentence. First thing to turn off on a slow box |
| `CAPTIONS_MAX_QUEUE` | `12` | How far behind before work is shed |
| `CAPTIONS_STALE_MS` | `15000` | How late is too late to say |
| `CAPTIONS_MAX_UTTERANCE_MS` | `10000` | Longest single clip |
| `WHISPER_BUILD_FLAGS` | detected | Override for `captions:build` |

---

## Testing

| | |
|---|---|
| `backend/tests/transcript.test.mjs` | Noise filtering, turns, rendering, the wire format |
| `frontend/tests/vad.test.mjs` | Segmentation, driven with synthetic audio |
| `frontend/tests/caption-lines.test.mjs` | Interim/final replacement and grouping |
| `backend/tests/captions.test.mjs` | Sockets, permissions, storage, retrieval |
| `npm run captions:check` | Real speech through the real engine |

The suites assert the pipeline and its guarantees, never what whisper *heard* —
that is not a deterministic function of a fixture, and a test asserting
particular words would fail for reasons that have nothing to do with this code.
`captions:check` is where recognition itself is verified, because it can report
what came back and how fast rather than merely passing or failing.
