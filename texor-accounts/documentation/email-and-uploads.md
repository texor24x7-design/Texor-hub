# Email, uploads and phone numbers

Three outbound concerns, plus the account fields that depend on them.

## Email (Resend)

One `sendMail()` for the whole application, behind a transport chosen at boot:

| Transport | When | Behaviour |
|---|---|---|
| `resend` | `RESEND_API_KEY` is set | Sends for real |
| `console` | It is not | Prints the message, link included, to the server log |

The fallback is not a stub for its own sake: without it a developer with no
Resend account cannot confirm an address locally, and sign-up is untestable. The
link is printed in full so it can be pasted into a browser.

Resend's REST API is a single POST, so it is called directly rather than through
the SDK — one less dependency to keep current, and full control over how
failures surface.

**Production requires it.** The app refuses to boot with `NODE_ENV=production`
and no `RESEND_API_KEY`, because without email nobody can verify an address or
recover a password, and both failures are silent until someone is stuck.

```env
APP_NAME=Texor
RESEND_API_KEY=re_...
MAIL_FROM=Texor <no-reply@texor.app>
MAIL_REPLY_TO=
```

`MAIL_FROM` must be a verified sender on your Resend account. The default,
`onboarding@resend.dev`, is Resend's shared sandbox and only delivers to your
own address — fine for a first look, useless for real users.
`npm run check:integrations` verifies the key and warns when the sending domain
is unverified.

### Verification and reset

Both work the same way, and `services/verification.service.js` is the whole of
it:

- Tokens are stored as a **SHA-256 hash**. A token is a bearer credential —
  whoever holds one can take the account — so a database dump must not contain
  usable ones.
- Issuing a token **retires any earlier one** for the same purpose, so a
  forwarded old email cannot be replayed after a new request.
- The address is **pinned at issue time**. A reset link minted before an email
  change does not validate against the new address.
- `POST /api/auth/forgot-password` answers **identically** whether or not the
  address has an account. Anything else makes it an enumeration oracle.
- A completed reset **revokes every session** and sends a "your password was
  changed" notice, because a reset is what someone does when they think they
  have lost control of the account.

Verification links last 24 hours; reset links 30 minutes. Both are single-use.

Confirming an address also signs the browser in — links get opened in whatever
browser the email client hands them to, and proving control of the inbox is the
same evidence the address rests on anyway.

Email-sending endpoints are rate limited to 8 per hour per IP, tighter than the
credential limiter, because the cost of abuse is somebody else's inbox and our
sending reputation.

## Uploads (Cloudinary)

The browser uploads **straight to Cloudinary**; the API only signs the request
and records the result. Image bytes never occupy a request worker, and there is
no upload endpoint here to point a firehose at.

```env
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
CLOUDINARY_FOLDER=texor/avatars
```

Optional. Without them the profile picture degrades to the URL field it
replaced, rather than the control vanishing.

### How the signature is constrained

`GET /api/account/picture/signature` returns a signature over a fixed parameter
set: a folder of `texor/avatars/<account id>/`, one `public_id`, and a
`c_fill,g_face,h_512,w_512` transformation so an enormous photograph does not
become an enormous avatar. The API secret never leaves the server.

### Why the result is validated

`PUT /api/account/picture` does not trust what comes back. It checks that the
`public_id` sits inside this account's folder and that the URL is on
`res.cloudinary.com` for our own cloud. Without that, the endpoint would be a
way to point anyone's avatar at any image on the internet — a tracking pixel, or
something unpleasant hosted under a Texor-looking URL.

Replacing a picture deletes the previous asset, but only after the new one is
safely recorded, and a deletion failure is logged rather than raised: failing to
tidy up must not stop someone setting a new picture.

> The signing scheme follows Cloudinary's documented algorithm (SHA-1 over the
> sorted parameters with the secret appended). It is exercised in
> `npm run test:account`, but no real upload has been performed — that needs
> live credentials, and is worth doing once before launch.

## Phone numbers

Collected optionally at sign-up and editable on the profile. Stored in **E.164**
(`+14155550123`) and validated against it, so the same number is never two
different strings.

Deliberately not a full national-format parser: a canonical single form is what
makes a number comparable and dialable, and asking for it plainly beats guessing
a country from a browser locale.

Changing the number clears `phoneVerified`. Nothing sets that flag yet — there
is no SMS verification, and the UI says "Unverified" rather than implying
otherwise.

The number is exposed through the standard OIDC **`phone` scope** as
`phone_number` / `phone_number_verified`, so an app has to ask for it rather
than receiving it with a profile. The scope is marked sensitive in the
catalogue, which sends an app back through review if it is added after
publication.

## Zoho

A fourth upstream sign-in provider, alongside Google, Microsoft and LinkedIn.

```env
ZOHO_CLIENT_ID=
ZOHO_CLIENT_SECRET=
ZOHO_REGION=com     # com · eu · in · com.au · jp · com.cn · ca
```

Zoho keeps an account in exactly one data centre, and each publishes its own
discovery document and signing keys. Pointing at the wrong region fails at token
verification rather than at sign-in, which is a confusing place to debug — hence
the explicit region.

Register the redirect URI in the
[Zoho API console](https://api-console.zoho.com):

```
{ISSUER_ORIGIN}/api/auth/federated/zoho/callback
```

Everything else — the account-linking rules, the `email_verified` requirement —
is the same as the other providers. See [social-sign-in.md](./social-sign-in.md).

## Checking it all works

```bash
npm run check:integrations
```

Confirms the Resend key is accepted and its sending domain verified, and that
the Cloudinary credentials and cloud name are right. Both fail in ways that are
invisible until a user is already stuck, which is the reason this exists.
