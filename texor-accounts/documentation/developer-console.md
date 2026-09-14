# The Texor developer console

Texor Account is a platform, not just an internal identity provider. Anyone with
a Texor Account can register an app at `/console`, get a client ID and secret,
and add "Sign in with Texor" — the same mechanism Finvoice, Talk and Payroll
use.

Texor's own products are registered the same way. The only difference is two
flags an administrator sets, described below.

## The shape of it

One app is one OAuth client. There is no project layer between a developer and
their credentials — the app *is* the registration, the consent screen config and
the client, in one place. That is a deliberate departure from Google Cloud
Console, where the split between a project and its OAuth clients is the part
people most often get lost in. If an app ever needs several clients, adding
that is additive.

## The publishing lifecycle

```
   testing  ──submit──▶  in_review  ──publish──▶  published
      ▲                      │
      └───────reject─────────┘
```

| Status | Who can sign in | Consent screen |
|---|---|---|
| `testing` | The owner, plus accounts they list | Warns that Texor has not reviewed the app |
| `in_review` | Same as testing | Same |
| `published` | Anyone with a Texor Account | No warning |

This is the platform's main anti-abuse protection. Without it, anyone could
register an app in thirty seconds, name it something trustworthy, and point it
at the whole user base. A developer **cannot publish their own app** — that is
an administrator decision.

Rejection returns an app to `testing` rather than blocking it, with notes the
developer sees, so they keep working with their test accounts while they fix
whatever came back.

## What a developer cannot do

These are enforced in `services/app.service.js` rather than in the controllers,
so a second entry point cannot skip them:

- **Set `isFirstParty`.** That flag skips the consent screen entirely. An app
  that could set it on itself could take tokens without ever asking.
- **Publish their own app.** See above.
- **Write arbitrary fields.** Updates are filtered through an explicit
  `DEVELOPER_WRITABLE` allowlist; anything else in the request body is ignored
  rather than trusted.
- **Reach another developer's app.** A non-owner gets `404`, not `403`, so the
  console does not confirm that an app id exists to someone unconnected with it.

## Redirect URI rules

Exact-match registration is only as good as what gets registered, so the shapes
that make exact matching meaningless are rejected:

| Rejected | Why |
|---|---|
| `http://` anywhere but loopback | Authorization codes in plaintext |
| Wildcards (`https://*.example.com`) | Defeats exact matching entirely |
| Fragments (`...#/cb`) | Never sent to the server; a sign of a misunderstanding |
| Relative or non-absolute URLs | Cannot be matched at all |

`http://localhost`, `http://127.0.0.1` and `http://[::1]` are allowed, because
that is where people develop and the traffic never leaves the machine.

## Post-logout redirect URIs

An app that signs people out of Texor as well as itself sends them to the
provider's `end_session_endpoint` with a `post_logout_redirect_uri`. That value
is matched as an exact string against the app's registered list, exactly like a
redirect URI.

The trap is the trailing slash: `https://example.com` and `https://example.com/`
are different strings, and a product that builds the value from an origin
setting sends the bare form while a hand-typed registration tends to carry the
slash. Registering one and sending the other produces
`post_logout_redirect_uri not registered` at the very end of a session, which
reads like a bug in sign-out rather than a configuration mismatch.

Texor's own products register both spellings (see `scripts/seed.js`). The
console does not silently add the sibling form to a developer's list — entries
nobody typed are their own kind of confusing — so the console explains the rule
instead.

## Scopes

The catalogue lives in `src/config/scopes.js` and is the single place scope
wording is written: the console offers them, and the consent screen explains
them in the same words.

`openid` is added automatically — it is what makes this OIDC rather than plain
OAuth. A scope marked `sensitive` sends an app back through review when it is
added to an already-published app. None of the current four are sensitive; the
flag exists so that the first one that is does not need new machinery.

## Test accounts

While an app is in `testing`, its owner lists the accounts that may use it. They
are entered as email addresses, because a developer knows their testers' emails
and not their Texor account ids. An address with no Texor Account is reported
back rather than silently dropped — a tester who cannot sign in and does not
know why is a support ticket waiting to happen.

Enforcement happens at authorization time, through a check added to the
interaction policy in `oidc/provider.js`:

```js
policy.get('consent').checks.unshift(appAvailabilityCheck);
```

It hangs off the consent prompt because it needs to know *who* is signing in,
which is only true once the login prompt has resolved. It is placed first so an
unavailable app is reported ahead of any missing consent, which would otherwise
be the more confusing message. The account UI renders that reason as a plain
"this app is not available yet" screen rather than asking someone to approve
access to something they cannot use.

## Endpoints

### `/api/console` — any signed-in account

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/scopes` | The scope catalogue, quotas and the issuer |
| `GET` | `/apps` | Your apps |
| `POST` | `/apps` | Register one — **returns `clientSecret` once** |
| `GET` | `/apps/:clientId` | One app, with its test account emails |
| `PATCH` | `/apps/:clientId` | Update. Unknown fields ignored |
| `DELETE` | `/apps/:clientId` | Delete |
| `POST` | `/apps/:clientId/rotate-secret` | New secret, returned once; the old one dies immediately |
| `PUT` | `/apps/:clientId/test-accounts` | Set testers by email |
| `POST` | `/apps/:clientId/submit-review` | Ask to be published |

### `/api/admin` — administrators only

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/apps?status=in_review` | The review queue, with owner emails |
| `GET` | `/apps/:clientId` | One app |
| `PATCH` | `/apps/:clientId` | Set `isFirstParty`, disable, adjust scopes |
| `POST` | `/apps/:clientId/publish` | Publish, with notes |
| `POST` | `/apps/:clientId/reject` | Back to `testing`, with notes |

## Quotas

| Limit | Value |
|---|---|
| Apps per developer | 25 |
| Redirect URIs per app | 10 |
| Test accounts per app | 100 |

In `LIMITS` in `services/app.service.js`.

## Registering a Texor product

Texor's own products are provisioned by the seed rather than through the
console, which is what lets them be first-party and published from the outset:

```js
await registerClient({
  clientId: 'finvoice',
  clientName: 'Finvoice',
  redirectUris: ['https://finvoice.texor.app/api/auth/callback'],
  isFirstParty: true,          // skips the consent screen
});
```

`services/client.service.js` is that operator path; `services/app.service.js` is
the self-service one. They are deliberately separate files, because the
difference between them is exactly the difference between "we built this" and
"someone signed up".

An existing self-service app can be promoted by an administrator with
`PATCH /api/admin/apps/:clientId { "isFirstParty": true }`. That is logged at
warn level, since it silently removes the consent screen for every user of that
app.

## Testing

```bash
npm run test:console
```

36 checks: registration, redirect URI validation, the escalation attempts a
developer might make, cross-developer isolation, a full authorization against a
registered app, the testing-status gate before and after adding a test account,
review and publish, secret rotation invalidating the old secret, and deletion.
