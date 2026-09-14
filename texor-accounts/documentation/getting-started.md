# Getting started

Running Texor Account locally, from nothing to a working sign-in.

## Prerequisites

- **Node 20.11 or newer** (`node -v`)
- **MongoDB** — either running locally, or a free MongoDB Atlas cluster

No local MongoDB? Any of these works:

```bash
# Homebrew
brew tap mongodb/brew && brew install mongodb-community && brew services start mongodb-community

# Docker
docker run -d -p 27017:27017 --name texor-mongo mongo:7

# Atlas — create a free cluster and use its connection string as MONGODB_URI
```

## 1. Configure the backend

```bash
cd texor-accounts/backend
cp .env.example .env
npm install
```

Generate the secrets. This prints three lines — paste each into `.env`,
replacing the placeholder values:

```bash
npm run keys:generate
```

| Variable | What it does |
|---|---|
| `OIDC_JWKS` | The private key that signs every ID token. Ephemeral keys are generated at boot if this is empty, which means tokens stop validating on restart — fine for a first look, not for real work. |
| `SECRET_ENCRYPTION_KEY` | Encrypts registered product client secrets at rest. |
| `COOKIE_KEYS` | Signs cookies. Comma-separated so you can rotate: the first signs, the rest still verify. |

## 2. Seed the database

```bash
npm run seed
```

This creates the first administrator (from `SEED_ADMIN_EMAIL` /
`SEED_ADMIN_PASSWORD`) and registers Finvoice, Talk and Payroll as first-party
OAuth clients.

**Keep the output.** It prints each product's client secret exactly once —
that is what goes into each product's `TEXOR_CLIENT_SECRET`. If you lose one,
rotate it rather than re-seeding:

```bash
curl -X POST http://localhost:4000/api/admin/clients/finvoice/rotate-secret \
  --cookie "texor_sid=<your admin session>"
```

## 3. Run it

```bash
npm run dev        # backend  → http://localhost:4000
```

In a second terminal:

```bash
cd ../frontend
cp .env.example .env
npm install
npm run dev        # account UI → http://localhost:3000
```

Open <http://localhost:3000>. You will be sent to the sign-in screen; use the
seeded admin, or create a new account.

## 4. Connect a product

```bash
cd ../../texor-finvoice/backend
cp .env.example .env
```

Paste the `TEXOR_CLIENT_SECRET` the seed printed, then confirm the wiring before
you go hunting through redirect logs:

```bash
npm install
npm run check:texor
```

It verifies the issuer is reachable, that the client id and secret authenticate,
and prints the exact authorization URL the product will use. Then:

```bash
npm run dev                                    # :4001
cd ../frontend && cp .env.example .env && npm install && npm run dev   # :3001
```

Open <http://localhost:3001> and click **Continue with Texor**.

## Verifying single sign-on

Start Talk as well (`texor-talk`, ports 4002/3002) and open
<http://localhost:3002>. You will land straight in the app without a password
prompt — the browser still holds the Texor session from Finvoice.

## Ports

| Service | API | Web |
|---|---|---|
| Texor Account | 4000 | 3000 |
| Finvoice | 4001 | 3001 |
| Texor Talk | 4002 | 3002 |
| Texor Payroll | 4003 | 3003 |

## Troubleshooting

**`Invalid environment configuration`** — a variable in `.env` is missing or
malformed. The error names every offending key; it is thrown at boot on purpose,
so a typo cannot become a confusing runtime failure later.

**Sign-in loops back to the login screen** — the browser is not keeping the
Texor session cookie. In development both apps must be on `localhost` (different
ports are fine); in production they must share the `.texor.app` parent domain
with `COOKIE_DOMAIN=.texor.app`.

**`invalid_redirect_uri`** — the product's `TEXOR_REDIRECT_URI` is not in the
client's registered `redirectUris`. It must match exactly, including scheme,
port and path. `npm run check:texor` in the product prints both for comparison.

**`invalid_client` at the token endpoint** — `TEXOR_CLIENT_SECRET` does not
match. Rotate the secret and update the product's `.env`.

**`invalid_client` at the *authorization* endpoint**, before any sign-in screen
appears — the product is not registered at all, or its stored secret cannot be
decrypted. Check both:

```bash
npm run seed        # registers finvoice, talk and payroll; safe to re-run
```

If the seed reports `SECRET_ENCRYPTION_KEY must be exactly 32 bytes`, that key
was never generated — run `npm run keys:generate` and paste all three values
into `.env` first. Client secrets are encrypted with it, so nothing can be
registered until it is set, and an authorization request answers
`invalid_client` with no other clue. The backend now warns about this at boot.

Note that `.env` is read once at startup: restart the backend after editing it.

**`post_logout_redirect_uri not registered` when signing out** — the value the
product sends is not, character for character, one of the app's registered
post-logout URIs. Almost always a trailing slash: `http://localhost:3001` and
`http://localhost:3001/` are different strings. Re-run `npm run seed`, which
registers both spellings, or add the missing one in the console.

**Tokens stop validating after a restart** — `OIDC_JWKS` is empty, so a new
signing key was generated at boot. Run `npm run keys:generate` and set it.
