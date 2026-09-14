# Adding a product to the Texor ecosystem

What it takes to make `newthing.texor.app` sign people in with their Texor
Account. Roughly twenty minutes.

## 1. Register the client

Products are rows in the `clients` collection, so this is an API call rather
than a code change. You need an admin session cookie (sign in at
`accounts.texor.app` with an admin account).

```bash
curl -X POST http://localhost:4000/api/admin/clients \
  -H 'content-type: application/json' \
  --cookie "texor_sid=<your session>" \
  -d '{
    "clientId": "newthing",
    "clientName": "New Thing",
    "description": "Does the new thing.",
    "redirectUris": ["http://localhost:4004/api/auth/callback"],
    "postLogoutRedirectUris": ["http://localhost:3004/"],
    "appUrl": "http://localhost:3004",
    "resourceIndicator": "https://api.newthing.texor.app",
    "isFirstParty": true
  }'
```

The response contains `clientSecret`. **It is shown once.** Put it straight into
the product's `.env`; if you lose it, rotate rather than re-register:

```bash
curl -X POST http://localhost:4000/api/admin/clients/newthing/rotate-secret \
  --cookie "texor_sid=<your session>"
```

### The fields that matter

| Field | Notes |
|---|---|
| `redirectUris` | Must match the product's `TEXOR_REDIRECT_URI` **exactly** — scheme, host, port, path. This points at the product's *backend*, because the backend performs the code exchange. |
| `isFirstParty` | `true` skips the consent screen. Only for products you ship. Anything built by someone else should be `false`. |
| `resourceIndicator` | The audience for this product's API tokens. Lets the product's own backend verify a token offline and reject one minted for a sibling product. |
| `tokenEndpointAuthMethod` | Leave as `client_secret_basic` for a server-side app. Use `none` only for a genuinely public client that cannot hold a secret. |

Alternatively, add the product to the `PRODUCTS` array in
`backend/scripts/seed.js` so a fresh database comes up with it registered.

## 2. Copy the SSO client

Every product carries the same relying-party implementation. Copy it from any
existing product:

```bash
cp -r texor-finvoice/backend/src/texor texor-newthing/backend/src/texor
```

Three files, no product-specific logic in any of them:

- `client.js` — the OIDC relying party: discovery, PKCE, code exchange, ID token
  verification, refresh, end-session
- `transaction.js` — carries the PKCE verifier, state and nonce across the round
  trip in a short signed cookie
- `index.js` — the configured singleton, built from the product's env

> This is destined to become a published `@texor/auth-sdk` package. Until then,
> a fix in one copy should be applied to the others.

You also need `models/Session.js`, `services/session.service.js`,
`middleware/session.js` and `controllers/auth.controller.js` — copy those too and
change the session cookie name (`finvoice_sid` → `newthing_sid`) and the
product-specific fields on the local user projection.

## 3. Configure the product

```env
TEXOR_ISSUER=http://localhost:4000/oidc
TEXOR_CLIENT_ID=newthing
TEXOR_CLIENT_SECRET=<from step 1>
TEXOR_REDIRECT_URI=http://localhost:4004/api/auth/callback
TEXOR_SCOPE=openid profile email offline_access
TEXOR_RESOURCE=https://api.newthing.texor.app
COOKIE_SECRET=<random>
COOKIE_DOMAIN=            # empty in dev; .texor.app in production
```

Verify before you write any UI:

```bash
npm run check:texor
```

## 4. Wire up the four endpoints

```js
router.get('/auth/login', startLogin);        // → redirect to Texor
router.get('/auth/callback', handleCallback); // ← code, exchange, open session
router.post('/auth/logout', logout);          // end both sessions
router.get('/auth/me', me);                   // who is signed in
```

Then protect the product's own routes with `requireUser`.

## 5. Mirror the account locally

Identity lives in Texor; product data lives in the product. The bridge is a
local `users` collection keyed by the `sub` claim:

```js
const user = await User.upsertFromClaims(claims);
```

That gives you a stable `_id` to hang product data off, and a cached name and
picture so listing a hundred records does not mean a hundred calls to the
identity provider.

**Scope every product query by that user.** In Finvoice and Payroll it is
`{ owner: req.user._id }` in the query itself, not a check afterwards — a filter
in the query cannot be accidentally dropped by a later refactor.

## 6. Production checklist

- [ ] `redirectUris` updated to the real `https://` callback
- [ ] `COOKIE_DOMAIN=.texor.app` on the product *and* on Texor Account
- [ ] `NODE_ENV=production` so cookies are `Secure`
- [ ] `CORS_ORIGINS` lists the product's real web origin
- [ ] The product's web origin added to Texor Account's `CORS_ORIGINS` if it
      calls the account API directly
