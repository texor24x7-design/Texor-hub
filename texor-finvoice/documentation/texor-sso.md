# Texor SSO in Finvoice

How "Continue with Texor" actually works here.

## The flow

```
browser            finvoice backend            accounts.texor.app
   │                      │                            │
   ├─ click "Continue" ──▶│                            │
   │                      │ build PKCE challenge       │
   │◀── 302 + texor_tx ───┤ (state, nonce, verifier)   │
   │                      │                            │
   ├──────────── GET /oidc/auth?… ────────────────────▶│
   │                      │            already signed in? ──▶ yes: skip ahead
   │◀───────────── sign-in / consent screen ───────────┤
   │                      │                            │
   ├─────────────── credentials ──────────────────────▶│
   │◀────────── 303 /api/auth/callback?code=… ─────────┤
   │                      │                            │
   ├─ GET callback ──────▶│                            │
   │                      ├── POST /oidc/token ───────▶│
   │                      │◀── id_token + tokens ──────┤
   │                      │ verify signature, nonce    │
   │                      │ upsert local user          │
   │◀── 302 + finvoice_sid┤ open session               │
```

The redirect to Texor is a **full browser navigation**, not a `fetch`. That is
the point: the user has to actually arrive at `accounts.texor.app` so their
Texor session cookie is in play. That cookie is what lets the second product
they open skip the password screen entirely.

## The four endpoints

| Endpoint | Does |
|---|---|
| `GET /api/auth/login` | Builds the PKCE challenge, stores it in a signed cookie, redirects to Texor |
| `GET /api/auth/callback` | Exchanges the code, verifies the ID token, opens a Finvoice session |
| `POST /api/auth/logout` | Revokes the session, returns Texor's end-session URL |
| `GET /api/auth/me` | The signed-in user, or `null` |

## What Finvoice trusts

Only the ID token, and only after verifying its signature against Texor's
published JWKS, plus the issuer, audience, expiry and nonce. Everything the
product believes about who you are comes from `verifyIdToken` in
`src/texor/client.js`.

## Where the tokens live

Server-side, in the `sessions` collection. The browser holds an opaque handle
(`finvoice_sid`) and nothing else. Access and refresh tokens never reach the
client, so an XSS bug in the frontend cannot exfiltrate a Texor credential.

Access tokens are refreshed automatically. `resolveSession` checks expiry on
every request and renews a minute before the token actually dies, so a slow
request never goes out with a token that expires in flight.

## Identity vs. product data

Texor owns identity. Finvoice owns invoices. The bridge is a local `users`
collection keyed by the `sub` claim:

```js
const user = await User.upsertFromClaims(claims);
```

The local record caches the name and picture so listing a hundred invoices does
not mean a hundred calls to the identity provider. It is refreshed from the ID
token on every sign-in — profile edits belong at `accounts.texor.app`, not here.

## Signing out

`POST /api/auth/logout` revokes the Finvoice session, then returns Texor's
`end_session_endpoint`. The frontend navigates there so the Texor session ends
too.

Skipping the second step is the classic mistake: the user appears signed out,
clicks "Continue with Texor" again, and is instantly signed straight back in
with no prompt. It looks like logout is broken, and in every way that matters,
it is.

## The shared client

`src/texor/` is identical in every Texor product:

| File | Responsibility |
|---|---|
| `client.js` | Discovery, PKCE, code exchange, ID token verification, refresh, end-session |
| `transaction.js` | Carries state, nonce and verifier across the round trip in a signed cookie |
| `index.js` | The configured singleton |

It is destined to become a published `@texor/auth-sdk`. Until then, a fix here
should be copied to the other products.
