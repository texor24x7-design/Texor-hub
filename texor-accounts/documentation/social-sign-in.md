# Sign in with Google, Microsoft and LinkedIn

Texor Account is both halves of an OIDC relationship. It is the **provider** for
finvoice, talk and payroll — and a **client** of Google, Microsoft and LinkedIn.
This document covers the second half.

Products are unaffected by any of it. Finvoice asks Texor who you are; how Texor
worked that out is not its concern.

## Setting a provider up

Each provider needs one redirect URI registered in its own console:

```
{ISSUER_ORIGIN}/api/auth/federated/{provider}/callback
```

In development that is `http://localhost:4000/api/auth/federated/google/callback`.

| Provider | Where | Notes |
|---|---|---|
| Google | [console.cloud.google.com](https://console.cloud.google.com/apis/credentials) → OAuth 2.0 Client ID, type *Web application* | Enable the *People API* only if you want more than name/email |
| Microsoft | [entra.microsoft.com](https://entra.microsoft.com) → App registrations → *Web* redirect URI | Add a client secret under *Certificates & secrets* |
| LinkedIn | [linkedin.com/developers/apps](https://www.linkedin.com/developers/apps) | Request the **Sign In with LinkedIn using OpenID Connect** product |

Then set the credentials:

```env
GOOGLE_CLIENT_ID=…
GOOGLE_CLIENT_SECRET=…

MICROSOFT_CLIENT_ID=…
MICROSOFT_CLIENT_SECRET=…
MICROSOFT_TENANT=common      # or a tenant GUID to restrict to one organisation

LINKEDIN_CLIENT_ID=…
LINKEDIN_CLIENT_SECRET=…
```

A provider appears on the sign-in screen **only when both its id and secret are
set**. Enabling Google alone needs no code change, and the UI fetches the list
from `GET /api/auth/providers` rather than hard-coding buttons that might not
work.

The flip side is that a provider you forgot to configure is simply *absent*,
which looks exactly like a bug. Three things make that legible:

```bash
npm run check:providers
```

confirms which providers are configured, fetches each one's discovery document
to prove it is reachable, and prints the exact redirect URI to register. The
backend also names the configured providers in its boot log, and in development
the sign-in screen says so when the list is empty.

## Troubleshooting

**No buttons on the sign-in screen.** Nothing is configured, or only one half of
a pair is. `curl localhost:4000/api/auth/providers` returns exactly what the UI
renders; if it is `{"providers":[]}`, the credentials are not being read. Note
that `.env` is loaded at boot, so restart the backend after editing it —
`node --watch` does not reload it.

**`discovery unreachable` with a relative URL.** The provider's issuer resolved
to an empty string. `*_ISSUER` overrides are declared with a default of `''`, so
a present-but-empty line is a value, not an absence; `resolveIssuer` handles
that, and `npm run check:providers` will show the issuer it ended up with.

**`redirect_uri_mismatch` at the provider.** The URI registered in the
provider's console must match byte for byte, including the port and the trailing
path. `check:providers` prints the exact string to paste. Note that it belongs
in *Authorized redirect URIs*, not *Authorized JavaScript origins* — the latter
does not accept a path. Remember to add the production URI alongside the
localhost one rather than replacing it.

**`Origin null is not allowed by CORS` on the callback.** Fixed, but worth
understanding if you touch the CORS configuration. Browsers send the literal
`Origin: null` on a cross-site redirect navigation, which is precisely what
returning from Google is. The origin callback must answer `callback(null, false)`
for anything it does not recognise, never an `Error`: omitting the
`Access-Control-Allow-Origin` header is what enforces the policy, since the
browser then blocks the calling script from reading the response. Throwing adds
no protection and turns every unrecognised navigation into a 500.

## The account-linking rule

This is the part worth reading carefully, because getting it wrong is an account
takeover.

When someone signs in through Google, one of four things happens:

1. **The upstream account is already linked.** Resolve by the provider's `sub`
   and sign them in. No email reasoning at all — this is the common case.
2. **Not linked, and no Texor account has that email.** Create a new Texor
   Account with no password and link it.
3. **Not linked, a Texor account has that email, and the upstream says
   `email_verified: true`.** Link them and sign in.
4. **Not linked, a Texor account has that email, and the upstream has *not*
   verified it.** **Refuse**, and tell the user to sign in to Texor first and
   connect the provider from account settings.

Case 4 is the whole point. Some providers will issue a token carrying an email
address the holder never proved they own. If Texor matched on email alone,
anyone able to obtain such a token for `you@example.com` would be handed your
Texor Account — and with it every product in the ecosystem. Requiring
`email_verified` closes that, and the deliberate-link path from account settings
gives the legitimate user a way through that requires proving both sides.

`sub` is used as the upstream identifier throughout, never the email. Emails get
reassigned; subjects do not.

## Accounts without passwords

An account created through Google has no password. Three consequences, all
handled:

- **Signing in with a password** returns `401 password_not_set` with a message
  naming the providers the account actually uses. It would otherwise be a
  generic "incorrect email or password" that the user can never satisfy, with no
  password reset flow to rescue them.
- **Setting a first password** does not require a current one — holding a valid
  session is the proof. `POST /api/account/password` with only `newPassword`.
- **Disconnecting the last provider** is refused. Removing the only way into an
  account locks its owner out permanently. Set a password first.

`hasPassword` is a stored field on the user, kept in step with the hash by a
`pre('save')` hook, because `passwordHash` is `select: false` and the sign-in
screen needs to know whether a password is even an option without loading the
credential.

## Federated sign-in inside a product's request

When a user clicks "Continue with Google" on the sign-in screen that Finvoice
sent them to, they must end up back **in Finvoice**, not on their Texor profile.

The interaction uid travels with the federated transaction:

```
finvoice → /oidc/auth → /interaction/<uid> → "Continue with Google"
        → /api/auth/federated/google/start?interaction=<uid>
        → Google → /api/auth/federated/google/callback
        → create Texor session, then provider.interactionResult(...)
        → back to finvoice with an authorization code
```

If the interaction has expired by the time they return, the user is still signed
in to Texor — the product just needs to ask again, and that second attempt is
silent.

## Provider quirks

**Microsoft multi-tenant issuers.** The `common` discovery document advertises a
literal `https://login.microsoftonline.com/{tenantid}/v2.0` placeholder, while
real tokens carry the signing tenant's GUID. Exact-matching the issuer therefore
rejects every valid token. `providers.js` supplies a `validateIssuer` that
pattern-matches for multi-tenant configurations and exact-matches for
single-tenant ones.

**LinkedIn and PKCE.** LinkedIn's OIDC implementation does not document PKCE
support and is strict about unexpected parameters, so its connector sets
`usePkce: false`. `state` and `nonce` are still required and checked. Google and
Microsoft both use PKCE.

**Thin ID tokens.** If an ID token is missing an email or a name, the client
falls back to the userinfo endpoint — but only to *fill gaps*, never to override
a signed claim, and only when the userinfo `sub` matches the ID token's.

**Names without parts.** A provider that sends only a full `name` with no
`given_name`/`family_name` gets the whole string stored as the given name rather
than split on a space. Guessing where a name divides is wrong for a great many
people.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/auth/providers` | Which providers this deployment offers. Public |
| `GET` | `/api/auth/federated/:provider/start` | Begin. `?next=`, `?interaction=`, `?mode=link` |
| `GET` | `/api/auth/federated/:provider/callback` | The provider returns here |
| `GET` | `/api/account/identities` | Connected providers, plus `hasPassword` |
| `DELETE` | `/api/account/identities/:provider` | Disconnect one |

`start` and `callback` are full browser navigations, not fetches — the user has
to actually arrive at the provider for their session there to be in play.

## Testing it

```bash
npm run test:federation
```

The real providers cannot be driven from a test: they need registered
credentials and a human at a consent screen. So the suite stands up a small but
protocol-accurate OIDC provider — real discovery document, real JWKS, real
RS256 ID tokens, real PKCE verification — and points the `google` connector at
it with `GOOGLE_ISSUER`. What is under test is our side: the relying party, the
linking policy, and the interaction resume.

26 checks, including the case-4 refusal, a tampered `state`, the passwordless
sign-in message, and the unlink-the-last-method guard.

Live credentials still need a manual pass before launch — the double cannot
reproduce a provider's own consent screen or its exact error wording.

## Adding a fourth provider

Anything with an OIDC discovery document needs only a definition in
`src/federation/providers.js` and a pair of env variables. GitHub and Apple both
fit; a plain OAuth 2.0 provider without OIDC would need a claims adapter, since
`client.js` assumes a verifiable ID token.
