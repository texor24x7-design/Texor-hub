# Finvoice

Invoicing for the Texor ecosystem. `finvoice.texor.app`

Signs people in with their Texor Account — no separate password, no separate
profile.

```
texor-finvoice/
├── backend/         Express 5 + MongoDB API        (:4001)
├── frontend/        Next.js 16 app                  (:3001)
└── documentation/   setup, SSO, API, data model
```

## Quick start

Texor Account must be running first — see
[`texor-accounts`](../texor-accounts). Its `npm run seed` prints this product's
client secret.

```bash
cd backend
cp .env.example .env          # paste TEXOR_CLIENT_SECRET from the seed output
npm install
npm run check:texor           # confirms the Texor wiring before you debug redirects
npm run dev                   # http://localhost:4001

cd ../frontend
cp .env.example .env
npm install
npm run dev                   # http://localhost:3001
```

Open <http://localhost:3001> and click **Continue with Texor**.

## What it does

- Create, edit and delete invoices, with line items, tax rates and notes
- Totals calculated server-side and stored, so a sent invoice keeps the numbers
  it was sent with
- Status tracking: draft → sent → paid, plus overdue and void
- Search by invoice number or client, filter by status
- A dashboard of outstanding, paid and draft totals

## What lives where

| Path | Responsibility |
|---|---|
| `backend/src/texor/` | The Texor SSO client — shared verbatim across every product |
| `backend/src/controllers/auth.controller.js` | The four "sign in with Texor" endpoints |
| `backend/src/models/Invoice.js` | The invoice, and the one place totals are derived |
| `backend/src/controllers/invoice.controller.js` | Invoice CRUD, scoped by owner |
| `frontend/src/components/InvoiceForm.js` | Create/edit form with a live total preview |

## Documentation

- [Getting started](./documentation/getting-started.md)
- [Texor SSO](./documentation/texor-sso.md) — how sign-in works here
- [API reference](./documentation/api-reference.md)
- [Data model](./documentation/data-model.md)
