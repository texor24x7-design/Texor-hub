# Architecture

How Texor Account is put together, and why it is put together that way.

## The shape of it

```
                    browser
                       │
       ┌───────────────┼────────────────────────────┐
       │               │                            │
       ▼               ▼                            ▼
┌─────────────┐  ┌────────────────────────┐  ┌──────────────┐
│ Next.js     │  │ Express (:4000)        │  │ product app  │
│ account UI  │  │                        │  │ e.g. :3001   │
│ (:3000)     │  │  /oidc/*   provider    │  └──────┬───────┘
│             │  │  /api/*    account API │         │
│ sign-in     │──▶│                       │◀────────┘
│ consent     │  └───────────┬────────────┘   OIDC redirects
│ account mgmt│              │                 + token exchange
└─────────────┘              ▼
                       ┌──────────┐
                       │ MongoDB  │
                       └──────────┘
```

One Express process serves two different things:

- **`/oidc/*`** — `oidc-provider`, mounted as a Koa callback. This is the
  standards-compliant machinery: authorization, token, userinfo, JWKS,
  introspection, revocation, end-session.
- **`/api/*`** — our own API. Sign-up, sign-in, profile, sessions, connected
  apps, product registration. This is what the account UI talks to.

The Next.js app is a pure client of `/api`. It renders no tokens and holds no
secrets.

## Why the provider is mounted, not embedded

`oidc-provider` extends Koa. Its routes are registered *unprefixed*
(`/auth`, `/token`, …) but the URLs it advertises in its discovery document
include the issuer's path segment. So the two only agree if Express strips that
segment before handing the request over:

```js
// src/app.js
const OIDC_MOUNT_PATH = new URL(env.issuer).pathname;   // '/oidc'
app.use(OIDC_MOUNT_PATH, provider.callback());
```

Deriving the mount path from the issuer rather than hard-coding `'/oidc'` means
the two can never drift apart. Mounting at the app root instead produces a
provider that answers on `/auth` while telling everyone it lives at `/oidc/auth`
— a failure that only shows up at the token exchange.

## The two sessions

This is the part worth understanding properly, because there are genuinely two
session mechanisms and they do different jobs.

| | `texor_sid` (ours) | `_texor_oidc` (the provider's) |
|---|---|---|
| Created by | `services/session.service.js` | `oidc-provider` |
| Stored in | `sessions` collection, token hashed | `oidcpayloads`, model `Session` |
| Answers | "is someone signed in to the account UI?" | "has this browser authenticated for OIDC purposes?" |
| Used by | `/api/account/*`, the interaction endpoints | the authorization endpoint |

They are created together at sign-in and destroyed together at sign-out. The
reason for keeping our own rather than reading the provider's is that the
account UI is not an OIDC client of itself — making it one would mean a product
that redirects to a login page that redirects to a login page.

The SSO effect comes from `texor_sid` being scoped to `.texor.app`, so it is
present on the very first authorization request from any product.

## The interaction flow

`oidc-provider` decides *what* is needed; the account UI decides *how it looks*.

```
product          provider                      account UI
   │                 │                              │
   ├─ /oidc/auth ───▶│                              │
   │                 │  needs a login               │
   │                 ├── 303 /interaction/<uid> ───▶│
   │                 │                              │
   │                 │◀── GET /api/interaction/:uid │  what do you want?
   │                 │─── { prompt: 'login', … } ──▶│
   │                 │                              │
   │                 │◀── POST …/login  (email+pw)  │
   │                 │─── { redirectTo } ──────────▶│
   │                 │                              │
   │                 │◀── GET <redirectTo> ─────────┤  full navigation
   │◀── 303 ?code=… ─┤                              │
```

Two details that matter:

- The interaction endpoints return a `redirectTo` URL rather than a `303`.
  A `fetch()` cannot usefully follow a redirect chain that ends at a different
  origin, so the UI navigates deliberately. It also makes the flow legible in
  the network tab.
- `oidc-provider` normally scopes its interaction cookie to the exact
  interaction URL. Because our UI reads interaction details through
  `/api/interaction/:uid` instead, `cookies.short.path` is widened to `/`.

## Consent policy

`loadExistingGrant` in `oidc/provider.js` decides whether to show a consent
screen:

- An existing grant for this client → reuse it.
- No grant, but the client is flagged `first_party` → create one covering the
  requested scopes and continue silently.
- Otherwise → return `undefined`, and the provider raises a consent prompt.

You do not consent to Google showing you Gmail. Products we ship get the same
treatment; anything integrated later does not.

## Clients are data, not configuration

`clients: []` is left empty in the provider configuration, which makes
`oidc-provider` fall through to the adapter — and the adapter reads the
`clients` collection. Registering `talk.texor.app` is therefore a database
write through `POST /api/admin/clients`, not a redeploy of the identity
provider.

Two custom properties ride along via `extraClientMetadata`:

- `first_party` — drives the consent policy above
- `resource_indicator` — the API audience this product's access tokens may target

Note that extra metadata is **not** camelCased onto the Client instance the way
standard metadata is. It is read back as `client.first_party`, spelled exactly
as declared.

## Texor as a broker

Texor Account is both halves of an OIDC relationship: the **provider** for
finvoice, talk and payroll, and a **client** of Google, Microsoft and LinkedIn.

```
Google ┐
Microsoft ├─ OIDC ─▶ Texor Account ─ OIDC ─▶ finvoice / talk / payroll
LinkedIn ┘          (client here)   (provider here)
```

`src/federation/` holds the client half — one generic relying party, since all
three upstreams publish a discovery document, with the per-provider quirks in
`providers.js`. Products are unaffected: Finvoice asks Texor who you are, and
how Texor worked that out is not its concern.

The linking policy in `services/federation.service.js` is the security-critical
piece; see [social-sign-in.md](./social-sign-in.md).

## Token shapes

A product gets two useful tokens.

**The ID token** is what establishes identity. It carries the full profile
(`conformIdTokenClaims: false`), so a product does not need a second round trip
to `/userinfo` on every sign-in.

**The access token** comes in two forms:

- No `resource` on the authorization request → an opaque token, valid at
  `/oidc/me`.
- `resource=https://api.finvoice.texor.app` → a JWT with that audience, which
  the product's own API can verify offline and which cannot be replayed against
  a sibling product.

There is deliberately no `defaultResource`. If every token were audience-bound,
none of them would work at `/userinfo`, which is a surprising thing to discover
at runtime.

## Refresh tokens

The OIDC spec drops `offline_access` unless the request carries
`prompt=consent` — which would force a consent screen on every single sign-in
and destroy the seamless hand-off between products. So `issueRefreshToken` is
overridden: first-party products get a refresh token without that dance, third
parties still ask the standard way.

Refresh tokens remain bound to the Texor session, so signing out of the account
still ends them.

## Request lifecycle

```
helmet → cors → cookieParser → [/api] json+urlencoded → apiLimiter
  → attachSession → route → controller → service → model
  → notFound → errorHandler
```

`attachSession` runs on every `/api` route and is permissive — it leaves
`req.user` null rather than rejecting. `requireUser` and `requireAdmin` are the
gates. Controllers throw `ApiError`; anything else that escapes is logged and
reported as a generic 500, so an internal message never leaks to a caller.

Express 5 forwards rejected promises from async handlers to the error middleware
automatically, which is why there is no `asyncHandler` wrapper anywhere.
