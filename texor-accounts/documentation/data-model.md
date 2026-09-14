# Data model

Five collections in the `texor_accounts` database.

## `users`

A Texor Account. `_id` is the `sub` claim in every token we issue — the single
identifier that follows a person across every product.

| Field | Notes |
|---|---|
| `email` | Unique, lowercased |
| `emailVerified`, `emailVerifiedAt` | |
| `passwordHash` | scrypt. **Nullable** — an account created through Google, Microsoft or LinkedIn has no password. `select: false`, so it is never loaded unless asked for explicitly |
| `hasPassword` | Queryable mirror of the above, kept in step by a `pre('save')` hook. Exists because `passwordHash` is `select: false` and the UI needs to know whether a password is an option without loading the credential |
| `passwordChangedAt` | |
| `name.given`, `name.family` | |
| `picture`, `locale`, `zoneinfo` | Profile claims |
| `status` | `active` · `suspended` · `deleted` — anything but `active` invalidates live sessions on next use |
| `roles` | `['user']`, plus `'admin'` for product registration |
| `failedLoginAttempts`, `lockedUntil` | Lockout after 10 failures, for 15 minutes |

`toClaims()` produces the OIDC claim set; `toJSON` strips `passwordHash`.

## `sessions`

The Texor SSO session — the `texor_sid` cookie, and the reason a second product
skips the login screen.

| Field | Notes |
|---|---|
| `user` | → `users` |
| `tokenHash` | SHA-256 of the cookie value. The raw token is never stored, so a database dump is not a set of usable logins |
| `userAgent`, `ip` | Shown on the "where you are signed in" screen |
| `lastSeenAt` | Updated at most every 5 minutes, to avoid a write per request |
| `expiresAt` | TTL index; Mongo reaps expired rows |
| `revokedAt` | Explicit sign-out |

Distinct from `oidc-provider`'s own `Session`, which lives in `oidcpayloads`.
See [architecture.md](./architecture.md#the-two-sessions).

## `clients`

One row per product. Registering `talk.texor.app` is a write here, not a
redeploy.

| Field | Notes |
|---|---|
| `clientId` | `finvoice`, `talk`, `payroll` |
| `clientSecretEncrypted` | AES-256-GCM envelope. **Encrypted, not hashed** — `oidc-provider` compares the secret a product presents against the registered value, so it has to be recoverable |
| `redirectUris` | Exact-match allowlist |
| `postLogoutRedirectUris` | |
| `allowedScopes` | What this product may ask for |
| `resourceIndicator` | API audience for its access tokens |
| `isFirstParty` | Skips the consent screen |
| `status` | `active` · `disabled`; the adapter only returns `active` clients |

`toProviderMetadata()` converts a row to the shape `oidc-provider` expects,
including the `first_party` and `resource_indicator` extra properties.

## `identities`

A link between a Texor Account and an upstream provider account. One user can
have several — signing in with Google and with Microsoft should land on the same
account, not create two.

| Field | Notes |
|---|---|
| `user` | → `users` |
| `provider` | `google` · `microsoft` · `linkedin` |
| `subject` | The provider's `sub` claim. **Never the email** — emails get reassigned, subjects do not |
| `email`, `emailVerified` | What the provider said at the last sign-in. Cached for display; never used to authenticate |
| `displayName`, `picture` | Same |
| `linkedAt`, `lastUsedAt` | |

Two unique indexes carry the rules: `{ provider, subject }` means one upstream
account maps to exactly one Texor account, and `{ user, provider }` means a
Texor account has at most one link per provider.

The policy governing when a link may be created is in
[social-sign-in.md](./social-sign-in.md) — it is the security-critical part.

## `oidcpayloads`

Everything `oidc-provider` needs to persist: grants, authorization codes, access
and refresh tokens, its own sessions, interactions. One document per object,
tagged with its model name.

| Field | Notes |
|---|---|
| `model` | `AccessToken`, `Grant`, `Session`, `Interaction`, … |
| `identifier` | The provider's id — unique per model, not globally |
| `payload` | The provider's own serialised object |
| `grantId`, `userCode`, `uid` | Secondary lookup keys the provider queries by |
| `consumedAt` | Set when a one-time artifact is used |
| `expiresAt` | TTL index |

Indexed `{ model: 1, identifier: 1 }` unique.

Two things the adapter does that are worth knowing:

- **Expiry is enforced on read**, not just by the TTL index. Mongo's TTL monitor
  runs about once a minute, so a document can outlive its logical expiry;
  `find()` returns `undefined` for anything past `expiresAt`.
- **`consume()` writes into the payload**, setting `payload.consumed`. The
  provider reads that flag back to detect a replayed authorization code, so it
  has to live inside the payload rather than beside it.

## Relationships

```
users ──1:N──▶ identities            (google / microsoft / linkedin links)
users ──1:N──▶ sessions              (texor_sid, the SSO session)
users ──1:N──▶ oidcpayloads          (Grant / AccessToken / … via payload.accountId)
clients ──1:N─▶ oidcpayloads          (via payload.clientId)
```

The "apps with access to your account" screen is assembled by querying
`oidcpayloads` for `model: 'Grant'` and `payload.accountId`, then joining to
`clients` for names and logos.
