# Texor Talk

Meetings and team messaging for the Texor ecosystem. `talk.texor.app`

Signs people in with their Texor Account — the same account that opens Finvoice
and Payroll.

```
texor-talk/
├── backend/         Express 5 + MongoDB API        (:4002)
├── frontend/        Next.js 16 app                  (:3002)
└── documentation/   setup, SSO, API, data model
```

## Quick start

Texor Account must be running first — see
[`texor-accounts`](../texor-accounts). Its `npm run seed` prints this product's
client secret.

```bash
cd backend
cp .env.example .env          # paste TEXOR_CLIENT_SECRET from the seed output
npm install
npm run check:texor
npm run dev                   # http://localhost:4002

cd ../frontend
cp .env.example .env
npm install
npm run dev                   # http://localhost:3002
```

If you already signed in to another Texor product in this browser, opening
<http://localhost:3002> drops you straight into the app with no password prompt.

## What it does

**Meetings** — a meeting platform that carries its own audio and video. The
media server is [mediasoup](https://mediasoup.org), an open-source SFU imported
as a dependency and run inside the API process. No conferencing service, no
account to create, nothing to point at.

- Join by code or link — `bcd-fghj-kmn`, the way Google Meet works
- A waiting room, with hosts admitting or refusing each person
- Host, co-host, participant and guest, decided per request from the meeting
- Scheduling, recurring meetings, and `.ics` calendar invites
- Org policy an admin sets and the server enforces
- An append-only audit log whose rows are hashed and numbered without gaps
- Simulcast, so one person on bad wifi does not drag the call down for everyone

**Live captions** — speech recognised by
[whisper.cpp](https://github.com/ggerganov/whisper.cpp), compiled into
`node_modules` and run inside the API process. No speech API, no key, and no
audio leaving the deployment.

- Captions over the stage, attributed to whoever is speaking
- 99 languages, detected per utterance — a meeting that switches between Telugu
  and English mid-sentence is the ordinary case, not the exotic one
- A stored transcript that reads as the conversation:
  `surya: endhuko telidu.` / `john: I don't know either.`
- Host-controlled per meeting, announced to everyone in the room, audited on
  both edges, with org policy over whether transcripts are kept and for how long
- A muted participant is never transcribed — enforced by the server, not just by
  the browser that stopped capturing

```bash
cd backend
npm run captions:setup    # rebuild whisper.cpp for this CPU, then fetch the model
npm run captions:check    # speak a sentence through it and report the speed
```

See [`documentation/captions.md`](documentation/captions.md).

**Messaging** — unchanged, and now able to start a call.

- Public and private channels
- Messages with author identity carried from Texor
- "Start a meeting" in any channel, which posts the joining link to the channel
- Soft-deleted messages — removed from view, retained for audit

> **Before production:** set `MEDIA_ANNOUNCED_ADDRESS` to an address
> participants can actually reach, and open the RTC port range. Leaving it at
> `127.0.0.1` gives you calls that connect and then carry no audio or video.
> See [Media](./documentation/media.md).

## What lives where

| Path | Responsibility |
|---|---|
| `backend/src/texor/` | The Texor SSO client — shared verbatim across every product |
| `backend/src/services/meeting.service.js` | Who may join, when, and who has to knock — the whole decision in one place |
| `backend/src/media/worker.js` | The mediasoup worker pool — the media server itself |
| `backend/src/media/room.js` | One Router per meeting, and the peers on it |
| `backend/src/media/signalling.js` | The WebSocket protocol, and where access is actually enforced |
| `backend/src/services/audit.service.js` | Appending and verifying the audit log |
| `backend/src/services/policy.service.js` | Org policy, and every "is this allowed" question |
| `backend/src/models/Channel.js` | Channels, and the read-access rule |
| `frontend/src/app/meetings/[code]/` | The green room, the lobby, and the call |
| `frontend/src/lib/room.js` | The browser half of the call — transports, producers, consumers |
| `frontend/src/components/VideoTile.js` | One participant's tile |
| `frontend/src/app/admin/` | Policy, live meetings and the audit log |
| `frontend/src/app/channels/[id]/` | The chat view |

## Tests

```bash
cd backend && npm test
```

An isolated API on `:4102` against a throwaway `_test` database — 139
assertions, including two real `mediasoup-client` peers negotiating transports
and exchanging producers against the SFU without a browser.

## Documentation

- [Getting started](./documentation/getting-started.md)
- [Meetings](./documentation/meetings.md) — joining, the lobby, roles, policy, audit
- [Media](./documentation/media.md) — the SFU, configuration, and the signalling protocol
- [Captions](./documentation/captions.md) — whisper.cpp, segmentation, and transcripts
- [Texor SSO](./documentation/texor-sso.md)
- [API reference](./documentation/api-reference.md)
- [Data model](./documentation/data-model.md)
