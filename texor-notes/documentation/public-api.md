# The notes API

For other platforms: put notes into a Texor account, keep them up to date, and
hear about it when somebody edits them there.

Base URL: `https://notes.texor.app/api/v1` (development: `http://localhost:4004/api/v1`)

---

## Keys

Create one at **Settings → The notes API**. You get `ntk_live_…` exactly once —
only its SHA-256 is stored, so there is nothing to show you a second time. Send
it on every request:

```
X-API-Key: ntk_live_kQ9v…
```

Every key gets a **label named after your app**. Notes you create are filed
under it, so the person finds them in their sidebar next to the ones they typed.
The label cannot be renamed or deleted while the key lives; revoking the key
unlocks it and leaves every note where it is.

Rate limit: **600 requests a minute per key**. Over it is a `429` with a
`Retry-After` header.

## Whose account a note goes into

| Key | The note belongs to |
|---|---|
| `owner` mode (default) | The person who made the key. Right for an integration you run for yourself |
| `user` mode | The person named by `X-Notes-User: ntu_…`, from the [connect flow](#the-connect-flow). Right when your app has its own users |
| trusted | Whoever the body's `owner` names. First-party Texor products only — see below |

A key is *trusted* only when the account that made it is listed in the
deployment's `TRUSTED_KEY_EMAILS`. It cannot be granted from inside the product.
An ordinary key that sends `owner` gets a `403`.

## Start here

```bash
curl https://notes.texor.app/api/v1/me -H "X-API-Key: ntk_live_…"
```

```json
{ "app": "Acme CRM", "mode": "owner", "trusted": false,
  "owner": { "texorId": "…", "email": "you@acme.com", "name": "You" },
  "label": "6710…", "webhook": false }
```

One call that proves the key, the account and the label before you debug
anything else.

## Notes

| Method | Path | |
|---|---|---|
| `GET` | `/notes?externalId=&limit=` | Notes **this key** created. Nothing else in the account is visible to a key |
| `POST` | `/notes` | Create — or update, when `externalId` has been seen before |
| `GET` | `/notes/:id` | `:id` is ours, or `external:<yourId>` |
| `PATCH` | `/notes/:id` | Change it |
| `DELETE` | `/notes/:id` | Moves it to the person's trash. They can get it back |

```bash
curl -X POST https://notes.texor.app/api/v1/notes \
  -H "X-API-Key: ntk_live_…" -H "content-type: application/json" \
  -d '{
        "externalId": "crm-deal-8812",
        "title": "Acme renewal — call notes",
        "colour": "yellow",
        "url": "https://crm.acme.com/deals/8812",
        "blocks": [
          { "type": "heading", "text": "Outcome", "level": 2 },
          { "type": "paragraph", "text": "Renewing at 40 seats.",
            "marks": [{ "type": "highlight", "start": 13, "end": 21, "color": "green" }] },
          { "type": "todo", "text": "Send the revised quote", "done": false }
        ]
      }'
```

`201` the first time, `200` every time after — same `externalId`, same note.
That is what makes a retry safe: two identical requests racing each other still
produce one note. Without an `externalId` every `POST` is a new note.

### The document

Blocks of plain text with mark ranges over them — never HTML. Markup you send is
stored as the characters you typed.

| Block `type` | Extra fields |
|---|---|
| `paragraph` | `align`, `indent` |
| `heading` | `level`: 1, 2 or 3 |
| `bullet`, `numbered` | `indent` |
| `todo` | `done` |
| `quote` | `speakerName`, `speakerTexorId`, `at` |

| Mark `type` | Extra fields |
|---|---|
| `bold`, `italic`, `underline`, `strike`, `code` | — |
| `highlight` | `color`: yellow, green, blue, pink, purple |
| `color` | `color`: red, orange, green, blue, purple, grey |
| `link` | `href`: http, https, mailto or tel only |
| `mention` | `texorId`, `name` |

`start` and `end` are UTF-16 offsets into `text`. Out-of-range marks are
clamped, unknown block types become paragraphs and unknown marks are dropped —
a request is refused only when it is not a document at all.

Note `colour` is one of `default`, `yellow`, `green`, `blue`, `pink`, `purple`,
`red`, `orange`, `grey`.

## Hearing about edits

Give the key a webhook address when you create it. When the person edits,
trashes or restores one of your notes in Notes, we `POST`:

```json
{ "event": "note.updated", "note": { "id": "…", "externalId": "crm-deal-8812", "title": "…", "blocks": [ … ], "version": 4, "deletedAt": null } }
```

`event` is `note.updated` or `note.deleted`. The request carries
`X-Notes-Signature: sha256=<hex>` — an HMAC-SHA256 of the raw body under the
webhook secret you were shown beside the key. Verify it over the exact bytes you
received, before parsing, with a constant-time comparison.

A change your app made is never sent back to it, so you cannot loop. We try three
times over a few seconds; answer `2xx` to accept, any `4xx` to refuse without a
retry.

## The connect flow

For a key in `user` mode, register the addresses your app may be sent back to,
then send each of your users to:

```
https://notes.texor.app/connect?app=<key prefix>&redirect_uri=<registered address>&state=<yours>
```

The prefix is the `ntk_live_xxxx` shown in the key list — never the key itself,
which does not belong in a URL. They sign in with Texor, approve, and come back
with `?code=…&state=…`. Exchange the code within five minutes, server to server:

```bash
curl -X POST https://notes.texor.app/api/v1/connect/exchange \
  -H "X-API-Key: ntk_live_…" -H "content-type: application/json" \
  -d '{ "code": "…" }'
# → { "userToken": "ntu_…", "user": { "texorId", "email", "name" } }
```

Store the `ntu_…` token for that user and send it as `X-Notes-User` alongside
your key. They can disconnect your app from their settings at any time.

## Errors

The same shape as every Texor API:

```json
{ "error": { "code": "unauthorized", "message": "That API key is not valid." } }
```

| Status | Meaning |
|---|---|
| `400` | Not a document, or a field is the wrong type — `details` names it |
| `401` | No key, a revoked key, or an invalid `X-Notes-User` |
| `403` | The key is not allowed to do that — usually naming an `owner` without being trusted |
| `404` | No note by that id **that this key created** |
| `409` | Two requests for the same `externalId` raced; retry and it is an update |
| `429` | Over the rate limit; see `Retry-After` |
