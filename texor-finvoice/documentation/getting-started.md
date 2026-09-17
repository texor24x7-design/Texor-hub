# Getting started

## Requirements

- Node 20.11+ (production runs 24)
- MongoDB **replica set** — issuing invoices and recording payments run in
  transactions. Atlas is one; a local `mongod` must be started with `--replSet`.
- Texor Account running (`texor-accounts`), with a `finvoice` client

## Backend environment

| Variable | Required | Notes |
|---|---|---|
| `MONGODB_URI` | yes | Must include a database name; tests derive `<name>_test` from it |
| `APP_ORIGIN`, `CORS_ORIGINS` | yes | The frontend's origin |
| `API_ORIGIN` | no | This API as browsers reach it; defaults to the origin of `TEXOR_REDIRECT_URI`. Set it when the API is served on a different host or port, since documents embed absolute URLs for the logo, signature and fonts |
| `TEXOR_*`, `COOKIE_SECRET` | yes | See [Texor SSO](./texor-sso.md) |
| `ENCRYPTION_KEY` | in production | `openssl rand -base64 32`. Encrypts Gmail refresh tokens, SMTP passwords and WhatsApp tokens |
| `PUBLIC_ORIGIN` | no | Where customer links (`/d/:token`) point; defaults to `APP_ORIGIN` |
| `UPLOAD_MAX_MB` | no | Default 5 |
| `GOOGLE_CLIENT_ID` / `_SECRET` / `_REDIRECT_URI` | no | Enables Gmail sending — see [Sending](./sending.md) |
| `PUPPETEER_EXECUTABLE_PATH` | no | Use a system Chromium instead of Puppeteer's |
| `DELIVERY_DRY_RUN` | tests only | Builds emails and WhatsApp payloads without sending. Refused in production |

## Frontend environment

| Variable | Notes |
|---|---|
| `NEXT_PUBLIC_API_ORIGIN` | The backend |
| `NEXT_PUBLIC_ACCOUNTS_ORIGIN` | Where "Texor Account" links go |

## Tests

```bash
cd backend
npm test                      # everything
npm test -- tax render        # only suites whose file name contains a word
TEST_PORT=4111 npm test       # if something already uses 4101
```

The runner rewrites the database name to `<name>_test`, refuses any database
that does not end that way, starts its own API process with
`DELIVERY_DRY_RUN=1`, and drops the test database afterwards.

| Suite | Covers |
|---|---|
| `money`, `india`, `tax`, `render` | Pure logic: paise, GSTIN checksum, GST against hand-worked invoices, HTML escaping |
| `foundation` | Onboarding, tenancy, verified-only invites, roles, hidden fields, custom modules, files, CSV |
| `documents` | Quote → invoice → issue → pay → void; serial numbers, stock, warranties, racing payments |
| `operations` | Designs and real PDFs, SMTP/WhatsApp payloads, attendance, claims, dashboard, search |
| `industries` | Every industry pack onboarded and billed end to end |
