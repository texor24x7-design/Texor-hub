# Getting started

## Prerequisites

- Node 20.11 or newer
- A MongoDB — the same cluster as the other products is fine; this uses its own
  `notes` database
- Texor Account running locally (`texor-accounts`, ports 4000/3000)

## 1. Register with Texor Account

`notes` is in the `PRODUCTS` list of `texor-accounts/backend/scripts/seed.js`.
Run the seed and it registers anything missing, skips what already exists, and
prints the new client's secret once:

```bash
cd texor-accounts/backend
npm run seed
```

Lost the secret? Read it back rather than rotating — rotating would sign out
every deployment that still holds the current one:

```bash
cd texor-accounts/backend
npm run client:secret -- notes
```

## 2. Configure

```bash
cd texor-notes/backend
cp .env.example .env
npm install
```

| Variable | Notes |
|---|---|
| `TEXOR_ISSUER` | `http://localhost:4000/oidc` in dev. Note the `/oidc` suffix |
| `TEXOR_CLIENT_ID` | `notes` |
| `TEXOR_CLIENT_SECRET` | From step 1 |
| `TEXOR_REDIRECT_URI` | `http://localhost:4004/api/auth/callback` — must match **exactly** |
| `TEXOR_RESOURCE` | `https://api.notes.texor.app` |
| `COOKIE_DOMAIN` | Empty in dev; `.texor.app` in production |
| `TRUSTED_KEY_EMAILS` | Accounts allowed to make a *trusted* key. See [the notes API](./public-api.md) |

## 3. Check the wiring

```bash
npm run check:texor
```

It confirms the issuer is reachable and the client secret authenticates, before
you spend any time reading redirect logs.

## 4. Run

```bash
npm run dev                          # api on :4004
cd ../frontend && cp .env.example .env && npm install && npm run dev   # web on :3004
```

Open <http://localhost:3004>, choose **Start writing**, and sign in with Texor.

## 5. Connect Texor Talk (optional)

1. Put your own address in Notes' `TRUSTED_KEY_EMAILS` and restart the API.
2. Sign in to Notes as that address, open **Settings → The notes API**, and
   create a key called `Texor Talk` with the webhook address
   `http://localhost:4002/api/integrations/notes`.
3. Copy the key and the webhook secret into `texor-talk/backend/.env`:

   ```
   NOTES_API_ORIGIN=http://localhost:4004
   NOTES_API_KEY=ntk_live_…
   NOTES_WEBHOOK_SECRET=…
   ```

4. Restart Talk. A note taken in a meeting now appears in Notes under **Texor
   Talk**, in the account of whoever wrote it — and an edit made in Notes is
   back in Talk a moment later.

Leave the three variables unset and Talk behaves exactly as it did before.

## Running the tests

```bash
cd backend
npm test
```

The runner derives a `notes_test` database from `MONGODB_URI`, refuses to run
against anything whose name does not end in `_test`, starts its own API on port
4104 so a dev server can keep running, and drops the database afterwards. Pure
suites run first, then the frontend's, then the end-to-end ones.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `invalid_redirect_uri` at sign-in | `TEXOR_REDIRECT_URI` differs from the registration by a character |
| Signed in, bounced back to `/signin` | The API origin in the frontend `.env` is wrong, or `CORS_ORIGINS` lacks `:3004` |
| A key returns 403 when it names an owner | The key is not trusted — its maker is not in `TRUSTED_KEY_EMAILS` |
| Talk notes never appear | Talk's key is not trusted, or `NOTES_API_ORIGIN`/`NOTES_API_KEY` is unset |
| Edits in Notes never reach Talk | `NOTES_WEBHOOK_SECRET` is missing in Talk, or the key has no webhook address |
