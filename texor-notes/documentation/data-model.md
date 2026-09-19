# Data model

MongoDB, database `notes`. Every collection is keyed to people by `texorId` —
the `sub` claim, the one identifier a person carries across every Texor product.

## `notes`

| Field | |
|---|---|
| `ownerTexorId`, `ownerName`, `ownerPicture` | Who it belongs to |
| `title`, `blocks` | The document — byte-compatible with Texor Talk's |
| `colour` | `default`, `yellow`, `green`, `blue`, `pink`, `purple`, `red`, `orange`, `grey` |
| `labels` | Label ids |
| `shares[]` | `{ texorId \| null, email, name, role, addedByTexorId, addedAt }` — `texorId` is null until somebody first signs in |
| `sharedTexorIds` | Derived from `shares`, for the "shared with me" index |
| `mentionedTexorIds` | Derived from the document's mention marks. Grants nothing |
| `pinned`, `archivedAt`, `deletedAt` | Board state. `deletedAt` is the trash |
| `version`, `lastEditedBy` | The conflict guard. Moves only when the document changes |
| `source` | `{ app, apiKey, externalId, url }` — `app: 'web'` for a note typed here |

Shares are embedded rather than a collection: a note is read with its shares on
every screen, and a join would add a query to the hottest path.

Indexes serve each list screen directly — the board, one label, shared with me,
the trash — plus a partial unique index on `(source.apiKey, source.externalId)`
that makes the API's upsert idempotent, and a text index over the title and
block text.

## `labels`

`{ ownerTexorId, name, colour, shares[], sharedTexorIds, locked, apiKey }`.
Unique on `(ownerTexorId, name)` under a case-insensitive collation. `locked`
marks an app's own label.

## `noteevents`

The activity trail: `{ note, at, actorTexorId, actorName, action, detail }`.
Consecutive edits by one person within ten minutes collapse into one row. It
records *that* something happened, not what the note said before.

## `apikeys`

`{ ownerTexorId, appName, prefix, hash, mode, trusted, label, webhookUrl,
webhookSecret, redirectUris, lastUsedAt, revokedAt }`. `hash` is the SHA-256 of
the key; the key itself is never stored.

## `connections`

`{ apiKey, texorId, email, name, tokenHash, label, revokedAt }` — one person
letting one `user`-mode app write into their account. Unique per (key, person).

## `users` and `sessions`

The local projection of a Texor Account and the browser session, as in every
other product. `users.signedInAt` is null for a placeholder created when a
trusted key filed a note for somebody who has never opened Notes.
