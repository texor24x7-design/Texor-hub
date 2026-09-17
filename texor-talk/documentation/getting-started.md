# Getting started

## Prerequisites

- Node 20.11+
- MongoDB running locally, or a MongoDB Atlas connection string
- **Texor Account running** — Texor Talk cannot sign anyone in without it

## 1. Get a client secret

Texor Talk is registered with Texor Account as an OAuth client. If you ran
`npm run seed` in `texor-accounts/backend`, the secret was printed there.

If you no longer have it, rotate rather than re-register — sign in to
`accounts.texor.app` with an admin account, then:

```bash
curl -X POST http://localhost:4000/api/admin/clients/talk/rotate-secret \
  --cookie "texor_sid=<your session>"
```

## 2. Configure

```bash
cd backend
cp .env.example .env
npm install
```

The values that matter:

| Variable | Notes |
|---|---|
| `TEXOR_ISSUER` | `http://localhost:4000/oidc` in dev. Note the `/oidc` suffix |
| `TEXOR_CLIENT_ID` | `talk` |
| `TEXOR_CLIENT_SECRET` | From step 1 |
| `TEXOR_REDIRECT_URI` | Must match the registration **exactly**. Points at the *backend* |
| `TEXOR_RESOURCE` | The API audience for this product's access tokens |
| `COOKIE_SECRET` | Signs the short-lived PKCE transaction cookie |
| `COOKIE_DOMAIN` | Empty in dev; `.texor.app` in production |

For meetings, the defaults work with nothing to sign up for — the media server
is a dependency, not a service:

| Variable | Notes |
|---|---|
| `MEDIA_ANNOUNCED_ADDRESS` | `127.0.0.1` on one machine. **The setting that decides whether calls work** |
| `MEDIA_RTC_MIN_PORT` / `MAX` | `40000-40100`. Open these in the firewall |
| `ADMIN_EMAILS` | Put your own address here, or `/admin` is unreachable |
| `ORG_EMAIL_DOMAINS` | Your domains. Empty means nobody counts as an external guest |

> `npm install` in `backend/` compiles mediasoup's C++ worker, so the first
> install takes a few minutes and needs Python 3 and a C++17 toolchain. On macOS
> that is the Xcode command line tools; on Debian, `build-essential` and
> `python3-pip`.

> Testing across two devices means changing `MEDIA_ANNOUNCED_ADDRESS` to the
> machine's LAN address. Leaving it at `127.0.0.1` gives you a call that connects
> and then carries no audio or video — see [media.md](./media.md).

## 3. Check the wiring

```bash
npm run check:texor
```

Verifies the issuer is reachable and that the client id and secret authenticate,
then prints the exact authorization URL. Run this whenever sign-in stops working
— it isolates a bad secret or a wrong issuer in one step, without reading
redirect logs.

## 4. Run

```bash
npm run dev                   # :4002
```

```bash
cd ../frontend
cp .env.example .env
npm install
npm run dev                   # :3002
```

## 5. Try a meeting

Open <http://localhost:3002/meetings>, hit **New meeting**, and join. To see the
waiting room, set the meeting's lobby to "Everyone knocks" on its details page,
then open the joining link in another browser signed in as somebody else — the
host's call panel offers to admit them.

## Running the tests

```bash
cd backend
npm test
```

Boots a second API on `:4102` against a **separate `<yourdb>_test` database**,
runs both suites against it, and drops it afterwards. Your dev server and your
data are untouched.

The suites wipe collections, so each one refuses to start unless the database
name ends in `_test`. Running a test file directly with `--env-file=.env` stops
with an error rather than touching your data.

## Captions

Optional, and two steps beyond `npm install` — both in `backend/`:

```bash
npm run captions:setup     # rebuild whisper.cpp for this CPU, then fetch the model (~148 MB)
npm run captions:check     # speak a sentence through it and report the speed
```

The rebuild takes a minute or two and needs `cmake` and a C++ compiler. It is
not optional if captions are going to be used: `smart-whisper` ships no
instruction-set flags, so a plain `npm install` compiles ggml's scalar fallback
kernels and recognition runs roughly ten times slower — slower than the speech
going into it, which means captions fall behind and get dropped rather than
merely being sluggish.

`captions:check` prints the real-time factor. Below 1 is what you want.

Skipping all of this is fine. `smart-whisper` is an optional dependency, so the
product installs and runs without it; captions simply report themselves
unavailable, with a reason, and nothing else changes.

See [Captions](./captions.md).

## Troubleshooting

**Redirected to `/signin?error=…`** — the message is the real one. Common
causes: `TEXOR_CLIENT_SECRET` is wrong (`invalid_client`), or the sign-in took
more than ten minutes so the PKCE transaction cookie expired.

**`invalid_redirect_uri` on the Texor screen** — `TEXOR_REDIRECT_URI` is not in
the client's registered `redirectUris`. Exact match, including port and path.

**Signed in, then immediately signed out** — the browser is not keeping
`talk_sid`. In dev, make sure you are reaching the app over `localhost` and
not `127.0.0.1`; the two are different cookie hosts.

**Sign-in works but every product asks for a password** — `COOKIE_DOMAIN` is not
set on Texor Account, so its session cookie is scoped to the accounts host alone.

**Everyone joins but nobody can hear anything** — `MEDIA_ANNOUNCED_ADDRESS`. It
is almost always this: the browser is sending media to an address it cannot
reach. Check the RTC port range is open for UDP too.

**Creating a meeting fails with a duplicate key error on `roomName`** — a
database from before the SFU change still has the old unique index. Run
`npm run migrate:media` once.

**Joined, but no camera or microphone** — browsers only release devices on a
secure origin. `localhost` counts as secure; a LAN address like
`192.168.1.5:3002` does not.

**`host_not_present` when joining** — the lobby applies to you and nobody is in
the meeting yet to admit you. This is deliberate: without it, someone waits in
front of a door with nobody behind it. Have the host join first.

**`/admin` returns 403** — your address is not in `ADMIN_EMAILS` and you are not
in the policy's admin list. `ADMIN_EMAILS` is read at boot, so restart the API
after changing it.

**The caption button says captions are unavailable** — ask `/api/captions`; the
reason is in the response. It is almost always the model: run
`npm run captions:model` in `backend/`. If `smart-whisper` itself is missing,
the machine had no C++ toolchain at `npm install` time — install `cmake` and a
compiler and reinstall.

**Captions appear seconds late, or not at all under load** — recognition is
slower than speech on that machine. Run `npm run captions:check`; if the
real-time factor is above 1, run `npm run captions:build` first, which is
usually the whole gap. After that, `CAPTIONS_INTERIM=false`, then a smaller
`WHISPER_MODEL`.

**A transcript is full of "Thank you." and "[BLANK_AUDIO]"** — that is whisper
answering silence with the most common phrases in its training data, and the
filter in `backend/src/utils/transcript.js` is what is supposed to catch it.
If new variants get through, add them there and to
`backend/tests/transcript.test.mjs` — never to a caller.

**Nothing is captioned even with captions on** — check the microphone is not
muted. A muted participant is never transcribed, and the server enforces that
independently of the browser, so it holds even if the tap is misbehaving.
