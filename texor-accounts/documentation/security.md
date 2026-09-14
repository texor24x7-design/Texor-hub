# Security

The decisions that matter, and the reasoning behind each.

## Passwords

Hashed with **scrypt** (N=32768, r=8, p=1) from `node:crypto`. Memory-hard, in
the standard library, and with no native build step — which keeps `npm install`
reliable across machines and CI images, a real consideration for the one service
every other service depends on.

Cost parameters are stored inside the hash string, so they can be raised later
and existing hashes still verify. `needsRehash()` upgrades a hash transparently
on the next successful sign-in.

Requirements: 12+ characters, mixed case, at least one digit. Length matters
more than symbol classes, which is why the floor is 12 rather than 8.

## Federated account linking

An upstream sign-in is matched onto an existing Texor account by email **only
when the provider asserts `email_verified: true`**. Otherwise anyone able to
obtain a token carrying someone else's address would be handed that person's
Texor Account, and with it every product in the ecosystem. The unverified case
is refused and pointed at the deliberate-link path in account settings, which
requires proving ownership of both sides.

Upstream accounts are identified by their `sub`, never their email. Emails get
reassigned; subjects do not.

An account must always retain at least one way in: disconnecting the last
provider from a passwordless account is refused, because there is no password
reset flow to rescue the owner afterwards. See
[social-sign-in.md](./social-sign-in.md).

## Account enumeration

`POST /api/auth/login` returns exactly the same `401` for an unknown email and
for a wrong password. When the email is unknown it still performs a hash so the
response time does not give the answer away either.

**Two deliberate exceptions**, both of which confirm that an address has a Texor
Account:

- `POST /api/auth/signup` answers `409` for a taken email.
- `POST /api/auth/login` answers `password_not_set` for an account that signs in
  only through Google, Microsoft or LinkedIn.

The second is the price of not stranding those users behind an error they can
never satisfy. The first is the more significant leak and the one to fix: doing
so properly means accepting the signup, sending a verification email, and
revealing nothing — which needs the mail transport listed below as missing.

## Brute force

- 10 consecutive failures locks an account for 15 minutes.
- Credential endpoints are limited to 20 requests per 15 minutes per IP;
  everything else under `/api` to 120 per minute.

Both matter: the lockout protects one account from a distributed attack, the
rate limit protects every account from one attacker.

## Session tokens

Only a SHA-256 hash of each session token is stored. A database dump therefore
yields no usable logins. Cookies are `httpOnly`, `sameSite=lax`, and `secure` in
production.

`sameSite=lax` rather than `strict` because the OIDC flow returns to us through
a cross-site redirect — `strict` would drop the session cookie precisely when it
is needed.

## Client secrets

**Encrypted, not hashed.** `oidc-provider` compares the secret a product
presents at the token endpoint against the registered value, so it needs the
original back; hashing is not an option. AES-256-GCM under
`SECRET_ENCRYPTION_KEY`, which lives outside the database.

The plaintext is returned exactly once, at registration or rotation. There is no
endpoint that reveals it afterwards.

## PKCE

Required for every client, including confidential ones
(`pkce: { required: () => true }`). It costs nothing and closes authorization
code interception on any client that ever gains a mobile or SPA variant.

## Token audiences

A product that requests `resource=https://api.finvoice.texor.app` receives a JWT
addressed to exactly that audience. Payroll's API rejects it. Without resource
indicators, one product's leaked token would be valid against every product's
API.

## Refresh token rotation

`rotateRefreshToken: true`. Each refresh returns a new token and invalidates the
old one, so a stolen refresh token stops working as soon as the legitimate
client next refreshes — and the mismatch is detectable.

## Signing keys

`OIDC_JWKS` holds the private signing key and is **required in production** —
the app refuses to boot without it. In development an ephemeral key is generated
at boot with a loud warning, because tokens then stop validating on restart.

To rotate: add the new key to the front of the array and keep the old one until
every issued token has expired. Both are published on the JWKS endpoint, so
verification keeps working through the overlap.

## Cookie signing keys

`COOKIE_KEYS` is a list. The first signs; the rest still verify. Rotate by
prepending a new key and dropping the last one a session lifetime later.

## Consent

First-party products skip the consent screen. This is a deliberate trust
decision, not an oversight — the ecosystem's own products are not third parties
to the account. Anything integrated later leaves `isFirstParty` false and gets
the standard prompt, and the user can revoke any grant from
`/account/apps` at any time.

## CORS

The allowlist is `CORS_ORIGINS`. An origin that is not on it gets a normal
response **without** an `Access-Control-Allow-Origin` header, which is what
stops a cross-origin script from reading it — enforcement happens in the
browser, not by refusing to answer.

The origin callback deliberately never returns an `Error`. Doing so does not add
protection, and it breaks top-level navigations that carry an `Origin` but need
no CORS at all: a cross-site redirect, such as an OAuth callback, arrives with
the literal origin `null`.

CORS is not a CSRF defence and is not relied on as one. State-changing requests
are protected by `sameSite=lax` cookies.

## Third-party apps

Anyone can register an app, so the platform assumes a registration is untrusted
until a human says otherwise.

- A self-service app is always created `testing` and never `isFirstParty`. Both
  are refused on the update path too, not merely omitted from the create path.
- `testing` restricts an app to its owner and the accounts that owner listed,
  enforced at authorization time by a check in the interaction policy. This is
  what stops a newly registered app from being aimed at the whole user base.
- Only an administrator publishes an app. Granting first-party status is logged
  at warn level, because it removes the consent screen for every user of that
  app.
- The consent screen tells the user when Texor has not reviewed an app. An
  unreviewed third-party app asking for access should look different from a
  Texor product, and it does.
- Update requests are filtered through an explicit allowlist of writable fields
  rather than merged, so a field added to the model later is not writable by
  accident.
- A developer reading another developer's app gets `404`, not `403` — the
  console does not confirm that an app id exists to someone unconnected with it.

Redirect URI rules and quotas are in
[developer-console.md](./developer-console.md).

## Redirect URIs

Exact-match only, no wildcards, enforced by `oidc-provider`. An open redirect
here would hand authorization codes to an attacker. Products also validate their
own post-login `returnTo` (`safeReturnTo` rejects anything not starting with a
single `/`) so it cannot become an open redirect either.

## What is deliberately not built yet

Honest gaps, not oversights:

- **Email verification** — `emailVerified` is set correctly for accounts that
  arrive through a provider that has verified the address, but a Texor account
  created with an email and password has no way to verify it. Sending
  verification mail is the next piece of work, and it is also what would let
  `POST /api/auth/signup` stop leaking which addresses are taken.
- **Password reset** — no forgot-password flow. Needs the same mail transport.
- **Multi-factor authentication** — no TOTP or WebAuthn. The account model has
  room for it; the interaction flow would gain an `mfa` prompt.
- **Backchannel logout** — signing out of Texor ends the provider session and
  the refresh tokens, but a product's own session cookie survives until it next
  refreshes. `oidc-provider` supports backchannel logout; wiring it up would
  make sign-out instant everywhere.
- **Audit log** — sign-ins and admin actions are logged to stdout, not to a
  queryable store.

## Production checklist

- [ ] `OIDC_JWKS` and `SECRET_ENCRYPTION_KEY` set from a secret manager, not `.env`
- [ ] `COOKIE_KEYS` set to real random values
- [ ] `NODE_ENV=production` (this is what makes cookies `Secure`)
- [ ] `COOKIE_DOMAIN=.texor.app`
- [ ] `CORS_ORIGINS` lists only real product origins
- [ ] TLS terminated in front, with `trust proxy` left enabled
- [ ] `SEED_ADMIN_PASSWORD` changed from the default
- [ ] MongoDB reachable only from the application network
