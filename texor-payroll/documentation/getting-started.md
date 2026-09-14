# Getting started

## Prerequisites

- Node 20.11+
- MongoDB running locally, or a MongoDB Atlas connection string
- **Texor Account running** — Texor Payroll cannot sign anyone in without it

## 1. Get a client secret

Texor Payroll is registered with Texor Account as an OAuth client. If you ran
`npm run seed` in `texor-accounts/backend`, the secret was printed there.

If you no longer have it, rotate rather than re-register — sign in to
`accounts.texor.app` with an admin account, then:

```bash
curl -X POST http://localhost:4000/api/admin/clients/payroll/rotate-secret \
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
| `TEXOR_CLIENT_ID` | `payroll` |
| `TEXOR_CLIENT_SECRET` | From step 1 |
| `TEXOR_REDIRECT_URI` | Must match the registration **exactly**. Points at the *backend* |
| `TEXOR_RESOURCE` | The API audience for this product's access tokens |
| `COOKIE_SECRET` | Signs the short-lived PKCE transaction cookie |
| `COOKIE_DOMAIN` | Empty in dev; `.texor.app` in production |

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
npm run dev                   # :4003
```

```bash
cd ../frontend
cp .env.example .env
npm install
npm run dev                   # :3003
```

## Troubleshooting

**Redirected to `/signin?error=…`** — the message is the real one. Common
causes: `TEXOR_CLIENT_SECRET` is wrong (`invalid_client`), or the sign-in took
more than ten minutes so the PKCE transaction cookie expired.

**`invalid_redirect_uri` on the Texor screen** — `TEXOR_REDIRECT_URI` is not in
the client's registered `redirectUris`. Exact match, including port and path.

**Signed in, then immediately signed out** — the browser is not keeping
`payroll_sid`. In dev, make sure you are reaching the app over `localhost` and
not `127.0.0.1`; the two are different cookie hosts.

**Sign-in works but every product asks for a password** — `COOKIE_DOMAIN` is not
set on Texor Account, so its session cookie is scoped to the accounts host alone.
