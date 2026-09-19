# Texor Notes API reference

The app's own API — what the frontend at `notes.texor.app` calls. Other
platforms use [the notes API](./public-api.md) instead.

Base URL in development: `http://localhost:4004`

Authentication is the `notes_sid` cookie, established by the Texor SSO flow.
Browser calls need `credentials: 'include'`. Errors share the ecosystem-wide
shape:

```json
{ "error": { "code": "forbidden", "message": "You can read this note but not change it." } }
```

A note you may not read is always `404`, never `403`, so a guessed id cannot
confirm a note exists. A note you *can* read but may not change is an honest `403`.

---

## Authentication

| Method | Path | |
|---|---|---|
| `GET` | `/api/auth/login?returnTo=/notes` | Redirects to Texor |
| `GET` | `/api/auth/callback` | Texor returns here with a code; also claims any shares waiting for this address |
| `POST` | `/api/auth/logout` | `{ ok, redirectTo }` |
| `GET` | `/api/auth/me` | `{ user }` or `{ user: null }` |

## Notes

| Method | Path | |
|---|---|---|
| `GET` | `/api/notes?scope=&label=&q=&limit=` | `scope`: `notes` (default), `shared`, `archive`, `trash`. `label` is its own scope and includes notes shared through it. `q` is whole-word search |
| `POST` | `/api/notes` | `{ title?, blocks?, colour?, labels? }` |
| `GET` | `/api/notes/:id` | The document, the caller's `role`, `canEdit`, `canShare`, and — for the owner — `shares` |
| `PATCH` | `/api/notes/:id` | `{ title?, blocks?, colour?, pinned?, archived?, version? }`. A document change against a stale `version` is `409 stale_version`, with the current note in `details` |
| `DELETE` | `/api/notes/:id` | To the trash. Owner only |
| `POST` | `/api/notes/:id/restore` | Out of the trash |
| `DELETE` | `/api/notes/:id/purge` | Gone for good. Only from the trash |
| `PUT` | `/api/notes/:id/labels` | `{ labels: [id] }` — only the caller's own labels are honoured |
| `GET` | `/api/notes/:id/activity` | The trail: who did what, newest first |
| `POST` | `/api/notes/:id/shares` | `{ email, role: 'viewer' \| 'editor' }`. Owner only |
| `DELETE` | `/api/notes/:id/shares/:email` | The owner removes anybody; anybody removes themselves |

## Labels

| Method | Path | |
|---|---|---|
| `GET` | `/api/labels` | Mine, then those shared with me, each with my `role` |
| `POST` | `/api/labels` | `{ name, colour? }`. A name you already have, in any capitals, is `409` |
| `PATCH` | `/api/labels/:id` | `{ name?, colour? }`. An app's label refuses a new name |
| `DELETE` | `/api/labels/:id` | Unfiles its notes, never deletes them. An app's label refuses |
| `POST` | `/api/labels/:id/shares` | Share everything filed under it |
| `DELETE` | `/api/labels/:id/shares/:email` | |

## People

| Method | Path | |
|---|---|---|
| `GET` | `/api/people?q=` | People you already share something with, plus an exact address. Not a directory |

## Keys and connected apps

| Method | Path | |
|---|---|---|
| `GET` | `/api/keys` | Never includes a key or a secret |
| `POST` | `/api/keys` | `{ appName, mode?, webhookUrl?, redirectUris? }` → the only response carrying `token` (and `webhookSecret`) |
| `DELETE` | `/api/keys/:id` | Revokes immediately. Its label and notes stay |
| `GET` | `/api/connections` | Apps you have let write into your account |
| `DELETE` | `/api/connections/:id` | Disconnect one |
| `GET` | `/api/connect?app=&redirect_uri=` | What the consent screen draws |
| `POST` | `/api/connect` | `{ app, redirectUri }` → `{ redirectTo }` carrying a one-time code |

## Health

`GET /api/health` → `{ "status": "ok", "service": "notes" }`
