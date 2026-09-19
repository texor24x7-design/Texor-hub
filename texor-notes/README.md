# Texor Notes

Notes, labels and shared thinking for the Texor ecosystem — with an API, so the
software you already run can write notes too. `notes.texor.app`

Signs people in with their Texor Account — the same account that opens Talk,
Finvoice and Payroll.

```
texor-notes/
├── backend/         Express 5 + MongoDB API        (:4004)
├── frontend/        Next.js 16 app                  (:3004)
└── documentation/   setup, SSO, API, data model, the public API
```

## Quick start

Texor Account must be running first — see [`texor-accounts`](../texor-accounts).
Its `npm run seed` registers `notes` and prints this product's client secret.

```bash
cd backend
cp .env.example .env          # paste TEXOR_CLIENT_SECRET from the seed output
npm install
npm run check:texor
npm run dev                   # http://localhost:4004

cd ../frontend
cp .env.example .env
npm install
npm run dev                   # http://localhost:3004
```

## What it does

- Notes that save as you type — headings, lists, checklists, quotes,
  highlights and @mentions, in the same document format as Texor Talk
- Colour, pin, archive, and a trash you can get things back out of
- Flat labels, many per note, and search across everything
- Sharing a note — or a whole label — to read or to edit, including with
  somebody who has not signed in yet
- Two people on one note without either losing a paragraph: a stale save is
  refused and both versions offered, and an Activity panel says who did what
- Downloads as Word, PDF, Markdown, HTML or plain text, built in the browser
- **The notes API** — keys for other platforms, an idempotent `externalId`,
  per-app labels, signed webhooks back out, and a connect flow so an app can
  write into its own users' accounts
- **Texor Talk's meeting notes**, mirrored here in the account of whoever wrote
  them, and edits made here carried back

## What lives where

| Path | Responsibility |
|---|---|
| `backend/src/texor/` | The Texor SSO client — shared verbatim across every product |
| `backend/src/models/Note.js` | The document (Talk's, unchanged), shares, labels, version, source |
| `backend/src/services/access.service.js` | Every permission decision, in one place |
| `backend/src/services/notes.service.js` | The sanitiser: clamp, don't refuse |
| `backend/src/middleware/apiKey.js` | Who an API call is acting for |
| `backend/src/controllers/public.controller.js` | The `/api/v1` surface other platforms call |
| `frontend/src/lib/notes-doc.js` | The editor's document algebra, lifted from Talk |
| `frontend/src/components/Board.js` | Every screen that is a wall of notes |

## Documentation

- [Getting started](./documentation/getting-started.md)
- [Texor SSO](./documentation/texor-sso.md)
- [API reference](./documentation/api-reference.md) — the app's own API
- [The notes API](./documentation/public-api.md) — for other platforms
- [Data model](./documentation/data-model.md)
- [How notes work](./documentation/notes.md) — sharing, conflicts, the trail, sync

> **Before production.** Set `COOKIE_DOMAIN=.texor.app`, a long random
> `COOKIE_SECRET`, and `TRUSTED_KEY_EMAILS` to the one account that creates
> Texor Talk's key — nobody else. The rate limiter and the connect-flow codes
> live in process memory, so run one API process until they move to Mongo.
