# Deployment

## Topology

Texor Account can be laid out two ways. Both work; the first is simpler.

**Same host** — one origin, `accounts.texor.app`, with a reverse proxy sending
`/api` and `/oidc` to the backend and everything else to Next.js. Cookies are
first-party throughout and CORS never enters the picture.

**Split hosts** — `accounts.texor.app` for the UI, `api.accounts.texor.app` for
the backend. Also fine: both are under `texor.app`, so they are same-site and
`sameSite=lax` cookies still flow. You will need the UI origin in
`CORS_ORIGINS`.

Whichever you pick, `ISSUER_ORIGIN` must be the origin the **browser** uses to
reach `/oidc`, because that is what goes into the discovery document and into
every `iss` claim.

## Environment

```env
NODE_ENV=production
PORT=4000

ISSUER_ORIGIN=https://accounts.texor.app
ACCOUNTS_WEB_ORIGIN=https://accounts.texor.app
CORS_ORIGINS=https://accounts.texor.app

MONGODB_URI=mongodb+srv://…

COOKIE_DOMAIN=.texor.app
COOKIE_KEYS=<random>,<previous>

OIDC_JWKS=<from npm run keys:generate>
SECRET_ENCRYPTION_KEY=<from npm run keys:generate>
```

`COOKIE_DOMAIN=.texor.app` is what makes single sign-on work across products.
Without it the Texor session is scoped to the accounts host alone and every
product prompts for a password.

## DNS

| Record | Points at |
|---|---|
| `accounts.texor.app` | Texor Account |
| `finvoice.texor.app` | Finvoice |
| `talk.texor.app` | Texor Talk |
| `payroll.texor.app` | Texor Payroll |

A wildcard `*.texor.app` works too, and makes adding the next product a
deployment rather than a DNS change.

## Running the backend

Plain Node, no build step:

```bash
npm ci --omit=dev
node src/server.js
```

Behind a process manager or as a container. `trust proxy` is enabled, so
`X-Forwarded-Proto` and `X-Forwarded-For` are honoured — make sure your proxy
actually sets them, or `secure` cookies and client IPs will both be wrong.

`SIGTERM` and `SIGINT` close the server and disconnect MongoDB before exiting.

## Running the frontend

```bash
npm ci
npm run build
npm start
```

`NEXT_PUBLIC_API_ORIGIN` is read at build time, so it must be set **before**
`npm run build`, not just at runtime.

## Scaling out

The backend is stateless — all session and OIDC state is in MongoDB, which is
exactly why the provider uses a Mongo adapter rather than its default in-memory
one. Run as many instances as you like behind a load balancer, with no sticky
sessions required.

Two things must be identical across every instance:

- `OIDC_JWKS` — otherwise a token signed by one instance fails verification at
  another
- `COOKIE_KEYS` — otherwise signed cookies do not survive a hop between instances

## Indexes

Mongoose creates them on boot in development. In production set
`autoIndex: false` and create them as part of a release step, so a deploy does
not block behind an index build.

## Health checks

| Endpoint | Use |
|---|---|
| `GET /api/health` | Liveness |
| `GET /oidc/.well-known/openid-configuration` | Readiness — proves the provider initialised and its keys loaded |

## Backups

`users` and `clients` are the irreplaceable collections. `sessions` and
`oidcpayloads` are recoverable state: losing them signs everyone out, which is
disruptive but not destructive.

## Key rotation

Signing keys, without downtime:

1. Generate a new key with `npm run keys:generate`.
2. Put it at the **front** of the `OIDC_JWKS` array, keeping the old one.
3. Deploy. New tokens sign with the new key; both are published on the JWKS
   endpoint, so tokens signed with the old one still verify.
4. Once the longest token lifetime has passed (30 days, the refresh token TTL),
   remove the old key and deploy again.
