# Texor Account

The identity provider for the Texor ecosystem. One account, every product.

This is an OpenID Connect provider we run ourselves. `finvoice`, `talk` and
`payroll` are OAuth clients of it, and nothing else in the ecosystem stores a
password.

It is also a **platform**: anyone with a Texor Account can register their own
app at `/console` and add "Sign in with Texor", the same way developers register
an app with Google. Texor's own products are registered through the same
machinery — see [the developer console](./documentation/developer-console.md).

```
texor-accounts/
├── backend/         Express 5 + MongoDB + oidc-provider   (:4000)
├── frontend/        Next.js 16 account UI                  (:3000)
└── documentation/   architecture, setup, API, security
```

## Quick start

```bash
cd backend
cp .env.example .env
npm install
npm run keys:generate    # paste the three lines it prints into .env
npm run seed             # first admin + registers finvoice, talk, payroll
npm run dev              # http://localhost:4000

cd ../frontend
cp .env.example .env
npm install
npm run dev              # http://localhost:3000
```

Check it is alive:

```bash
curl http://localhost:4000/oidc/.well-known/openid-configuration | head
```

## What lives where

| Path | Responsibility |
|---|---|
| `backend/src/oidc/provider.js` | The OIDC configuration — scopes, claims, token lifetimes, consent policy |
| `backend/src/oidc/adapter.js` | Persists provider state (grants, codes, tokens) to MongoDB |
| `backend/src/controllers/interaction.controller.js` | The bridge between the provider and the account UI |
| `backend/src/services/session.service.js` | The `texor_sid` SSO session — what makes the second product skip the login screen |
| `backend/src/federation/` | The relying-party half: signing in *through* Google, Microsoft or LinkedIn |
| `backend/src/services/app.service.js` | Self-service app registration and its guard rails |
| `frontend/src/app/console/` | The developer console |
| `backend/src/mail/` | Transactional email, with a console transport for local development |
| `backend/src/services/verification.service.js` | Email confirmation and password recovery |
| `backend/src/services/upload.service.js` | Cloudinary signing, and validating what comes back |
| `frontend/src/components/AppShell.js` | Sidebar on desktop, drawer on mobile |
| `backend/src/services/federation.service.js` | The account-linking policy — the security-critical part |
| `frontend/src/app/interaction/[uid]/` | The sign-in and consent screens products send users to |

## Documentation

- [Getting started](./documentation/getting-started.md) — running it locally, end to end
- [Architecture](./documentation/architecture.md) — how the pieces fit, and why
- [Adding a product](./documentation/adding-a-product.md) — joining a new app to the ecosystem
- [Developer console](./documentation/developer-console.md) — third-party app registration, review and publishing
- [Social sign-in](./documentation/social-sign-in.md) — Google, Microsoft, LinkedIn and Zoho
- [Email, uploads and phone](./documentation/email-and-uploads.md) — Resend, Cloudinary, E.164
- [API reference](./documentation/api-reference.md) — every endpoint
- [Data model](./documentation/data-model.md) — the collections
- [Security](./documentation/security.md) — the decisions and their reasoning
- [Deployment](./documentation/deployment.md) — going to production

## Tests

```bash
npm run test:smoke        # full OIDC flow against an in-memory MongoDB
npm run test:federation   # Google/Microsoft/LinkedIn sign-in against a protocol-accurate double
npm run test:console      # the developer console and its guard rails
npm run test:account      # verification, password reset, uploads, phone numbers
npm run check:providers   # is social sign-in actually configured and reachable?
npm run check:integrations # are Resend and Cloudinary actually working?
```
