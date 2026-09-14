# API reference

Base URL in development: `http://localhost:4000`

Two namespaces:

- `/oidc/*` — the OpenID Connect provider. Standards-defined; products talk to
  this. Start from the discovery document rather than hard-coding paths.
- `/api/*` — the Texor Account API. The account UI talks to this.

All `/api` responses are JSON. Errors share one shape:

```json
{ "error": { "code": "bad_request", "message": "Some fields need attention.",
             "details": [{ "field": "email", "message": "Enter a valid email address." }] } }
```

| Status | `code` | Meaning |
|---|---|---|
| 400 | `bad_request` | Validation failed; `details` lists the fields |
| 401 | `unauthorized` | No session, or wrong credentials |
| 403 | `forbidden` | Signed in, but not allowed |
| 404 | `not_found` | No such resource |
| 409 | `conflict` | Already exists |
| 429 | `rate_limited` | Too many attempts |
| 500 | `internal_error` | Unexpected; details only in development |

Authentication is the `texor_sid` cookie. Browsers must send
`credentials: 'include'`, and the origin must be listed in `CORS_ORIGINS`.

---

## OpenID Connect

| Endpoint | Purpose |
|---|---|
| `GET /oidc/.well-known/openid-configuration` | Discovery. Everything else is listed here. |
| `GET /oidc/jwks` | Public keys for verifying ID tokens |
| `GET /oidc/auth` | Authorization endpoint (code + PKCE required) |
| `POST /oidc/token` | Code exchange, refresh, client credentials |
| `GET /oidc/me` | UserInfo |
| `POST /oidc/token/introspection` | Token introspection |
| `POST /oidc/token/revocation` | Token revocation |
| `GET /oidc/session/end` | RP-initiated logout |

Supported scopes: `openid`, `profile`, `email`, `offline_access`.

Claims by scope:

| Scope | Claims |
|---|---|
| `openid` | `sub` |
| `profile` | `name`, `given_name`, `family_name`, `picture`, `locale`, `zoneinfo`, `updated_at` |
| `email` | `email`, `email_verified` |

---

## Authentication — `/api/auth`

### `POST /api/auth/signup`

```json
{ "email": "ada@example.com", "password": "…", "givenName": "Ada", "familyName": "Lovelace" }
```

Passwords need 12+ characters, mixed case and a digit. Sets `texor_sid` and
returns `{ user }`. `409` if the email is taken.

### `POST /api/auth/login`

```json
{ "email": "ada@example.com", "password": "…" }
```

Returns `{ user }` and sets `texor_sid`. Always `401` for both an unknown email
and a wrong password, so the endpoint cannot be used to discover which addresses
have Texor accounts. Ten failures locks the account for 15 minutes.

### `POST /api/auth/logout`

Revokes the session and clears the cookie. Follow with a visit to
`/api/auth/end-session-url` to also tear down the provider's session.

### `GET /api/auth/me`

`{ "user": … }` or `{ "user": null }`. Never errors on an absent session.

### `GET /api/auth/providers`

Which of Google, Microsoft and LinkedIn this deployment has credentials for.
Public — the sign-in screen reads it so it only renders buttons that work.

```json
{ "providers": [{ "id": "google", "displayName": "Google", "startUrl": "/api/auth/federated/google/start" }] }
```

### `GET /api/auth/federated/:provider/start`

Begins a federated sign-in. A browser navigation, not a fetch.

| Query | Purpose |
|---|---|
| `next` | Where to land afterwards. Must be a path within the account UI |
| `interaction` | Set when this began inside a product's authorization request; the callback finishes it |
| `mode=link` | Connect a provider to the account already signed in |

### `GET /api/auth/federated/:provider/callback`

Where the provider returns. Failures redirect back to `/signin?error=…` — or to
the interaction, or to `/account/security`, depending on where the flow started.

See [social-sign-in.md](./social-sign-in.md) for the linking rules.

### `GET /api/auth/end-session-url`

`{ "endSessionUrl": "http://localhost:4000/oidc/session/end" }`

---

## Account — `/api/account`

All require a session.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/profile` | The signed-in user |
| `PATCH` | `/profile` | Update `givenName`, `familyName`, `picture`, `locale`, `zoneinfo` |
| `POST` | `/password` | Change password |
| `GET` | `/sessions` | Every active session, with `current: true` on this one |
| `DELETE` | `/sessions` | Sign out everywhere else |
| `DELETE` | `/sessions/:id` | Sign out one device |
| `GET` | `/connected-apps` | Products with a live grant |
| `DELETE` | `/connected-apps/:grantId` | Revoke a product's access |
| `GET` | `/identities` | Connected sign-in providers, plus `hasPassword` |
| `DELETE` | `/identities/:provider` | Disconnect one. `409` if it is the only way in |

`POST /password` takes `{ currentPassword, newPassword, signOutOtherSessions }`.
`signOutOtherSessions` defaults to `true` — a password change should invalidate
anything an attacker already holds. `currentPassword` is omitted when the
account does not have one yet (it arrived through Google, Microsoft or
LinkedIn); a valid session is the proof of ownership in that case.

Revoking a connected app deletes the grant and every token issued under it, so
the product is signed out at its next refresh.

---

## Administration — `/api/admin`

Requires an account with the `admin` role.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/clients` | Every registered product |
| `POST` | `/clients` | Register a product — **returns `clientSecret` once** |
| `GET` | `/clients/:clientId` | One product |
| `PATCH` | `/clients/:clientId` | Update registration |
| `POST` | `/clients/:clientId/rotate-secret` | New secret, returned once |

See [adding-a-product.md](./adding-a-product.md) for the request body.

---

## Interaction — `/api/interaction`

Used only by the account UI during an authorization request. Identified by
`oidc-provider`'s interaction cookie, not by the `:uid` in the path.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/:uid` | What the provider needs: `{ prompt, params, client, user }` |
| `POST` | `/:uid/login` | Credentials, or `{ useExistingSession: true }` |
| `POST` | `/:uid/confirm` | Approve a consent prompt |
| `POST` | `/:uid/abort` | Decline — returns `access_denied` to the product |

Each returns `{ redirectTo }`. The UI performs a full navigation to it.

---

## Rate limits

| Scope | Limit |
|---|---|
| `/api/auth/login`, `/signup`, `/account/password`, interaction login | 20 per 15 minutes |
| Everything else under `/api` | 120 per minute |
