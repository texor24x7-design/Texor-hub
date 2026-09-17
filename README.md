# Texor

A software ecosystem built around one account.

```
                        ┌──────────────────────────────┐
                        │      accounts.texor.app      │
                        │       Texor Account          │
                        │  OpenID Connect provider     │
                        │  users · sessions · consent  │
                        └──────────────┬───────────────┘
                                       │
                    OpenID Connect (authorization code + PKCE)
                                       │
        ┌──────────────────────┬───────┴────────┬──────────────────────┐
        │                      │                │                      │
┌───────┴────────┐   ┌─────────┴──────┐   ┌─────┴──────────┐   ┌───────┴────────┐
│ finvoice       │   │ talk           │   │ payroll        │   │ …the next one  │
│ .texor.app     │   │ .texor.app     │   │ .texor.app     │   │                │
│ invoicing      │   │ meetings       │   │ payroll runs   │   │                │
└────────────────┘   └────────────────┘   └────────────────┘   └────────────────┘
```

Sign in once at `accounts.texor.app` and every product recognises you — the same
way a Google account carries you across Gmail, Drive and Calendar. Products never
see a password. They receive a signed token describing who you are, and that is
the only thing they trust.

## Repositories

Each product is its own repository, with the same three folders inside:

| Repository | What it is | Ports (dev) |
|---|---|---|
| [`texor-accounts`](./texor-accounts) | Texor Account — the identity provider everything else depends on | api `4000`, web `3000` |
| [`texor-finvoice`](./texor-finvoice) | Finvoice — invoicing, inventory, warranties and staff, shaped per industry | api `4001`, web `3001` |
| [`texor-talk`](./texor-talk) | Texor Talk — meetings (self-hosted SFU) and team messaging | api `4002`, web `3002` |
| [`texor-payroll`](./texor-payroll) | Texor Payroll — payroll runs and payslips | api `4003`, web `3003` |

```
texor-<product>/
├── backend/         Express + MongoDB API
├── frontend/        Next.js app
└── documentation/   how it works, and how to run it
```

## The stack

Plain JavaScript throughout — no TypeScript, no build step on the backend.

- **Frontend** — Next.js 16 (App Router), React 19
- **Backend** — Node 20+, Express 5, ES modules
- **Database** — MongoDB via Mongoose
- **Identity** — `oidc-provider` 9, a certified OpenID Connect implementation,
  configured and hosted by us rather than rented from a vendor

## Start here

Texor Account has to be running before any product can sign anyone in.

```bash
# 1. the identity provider
cd texor-accounts/backend && cp .env.example .env
npm install && npm run keys:generate     # paste the output into .env
npm run seed                             # creates an admin + registers the products
npm run dev                              # http://localhost:4000

cd ../frontend && cp .env.example .env
npm install && npm run dev               # http://localhost:3000

# 2. any product — the seed output gave you its client secret
cd ../../texor-finvoice/backend && cp .env.example .env
npm install && npm run check:texor       # confirms the wiring before you debug redirects
npm run dev                              # http://localhost:4001

cd ../frontend && cp .env.example .env
npm install && npm run dev               # http://localhost:3001
```

Then open <http://localhost:3001>, click **Continue with Texor**, and create an
account. Open <http://localhost:3002> afterwards and you will already be signed in.

Full instructions, including MongoDB setup, are in
[`texor-accounts/documentation/getting-started.md`](./texor-accounts/documentation/getting-started.md).

## How single sign-on actually works

1. You click *Continue with Texor* in Finvoice. Its backend redirects you to
   `accounts.texor.app` with a PKCE challenge.
2. Texor Account checks for its own session cookie. If you are already signed in,
   it skips straight to step 4.
3. If not, the account UI collects your password and creates a Texor session.
4. Texor sends you back to Finvoice with a one-time authorization code.
5. Finvoice's backend exchanges that code for tokens, verifies the ID token
   signature against Texor's published keys, and opens its own session.

Because step 2 reads a cookie on `.texor.app`, the second product you visit never
reaches step 3. That is the whole trick.

First-party products skip the consent screen — you do not consent to Google
showing you Gmail. Any third-party integration added later omits that flag and
gets the standard "app X wants access to your account" prompt.

## Signing up

A Texor Account can be created with an email and password, or through **Google,
Microsoft or LinkedIn**. Either way it is the same account, and every product
sees the same `sub`. Providers are enabled per deployment by setting their
credentials — no code change — and an upstream sign-in is only ever matched onto
an existing account when the provider has actually verified the email address.
See [social sign-in](./texor-accounts/documentation/social-sign-in.md).

## Adding a product to the ecosystem

Register it with Texor Account, then copy `backend/src/texor/` from any existing
product. The full walkthrough is in
[`texor-accounts/documentation/adding-a-product.md`](./texor-accounts/documentation/adding-a-product.md).

## Verifying the whole thing works

```bash
cd texor-accounts/backend
npm run test:smoke        # the OIDC provider, end to end
npm run test:federation   # Google / Microsoft / LinkedIn sign-in
```

The first boots the provider against a throwaway in-memory MongoDB and drives a
complete browser-shaped flow — discovery, authorization, login, consent, token
exchange, userinfo, refresh, and a second product signing in silently.

The second drives federated sign-in against a protocol-accurate OIDC double
(real discovery, JWKS, RS256 tokens and PKCE), covering the account-linking
rules, a tampered `state`, and a federated sign-in that completes a product's
authorization request. No mocks in either.
