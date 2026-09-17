# Finvoice

Invoicing, inventory, warranties and staff for small businesses, shaped around
the business's own trade. `finvoice.texor.app`

Sign-in is a Texor Account. A business onboards into a **workspace**, picks its
industry, and Finvoice arranges itself around it: a car wash gets job cards,
vehicles and wash packages priced by vehicle type; a restaurant gets a menu,
tables and thermal receipts. Everything that template sets up can be renamed,
reordered, extended or switched off.

```
texor-finvoice/
├── backend/         Express 5 + MongoDB API                    (:4001)
├── frontend/        Next.js 16 app                              (:3001)
│   └── src/lib/shared/   tax, money, GSTIN and document renderer — used by both
└── documentation/
```

## Editions

| Finvoice Lite | Finvoice Pro (locked modules today) |
|---|---|
| Customers, quotations, invoices, payments | Reports: P&L, payment modes, stock valuation |
| Products with stock, services, variants | GST filing (GSTR-1/3B), e-invoice, e-way bill |
| Warranties and claims | CRM pipeline, calendar |
| Staff attendance | Marketing campaigns, integrations hub, POS/KOT |
| Roles & permissions, custom modules & fields, document designer | |
| Gmail, SMTP and WhatsApp sending | |

Both editions are one workspace with an `edition` flag, so upgrading moves no data.

## Quick start

Texor Account must be running first — see [`texor-accounts`](../texor-accounts).

```bash
cd backend
cp .env.example .env          # TEXOR_CLIENT_SECRET from texor-accounts' seed
npm install                   # also downloads Chromium for PDFs
npm run check:texor
npm run dev                   # http://localhost:4001

cd ../frontend
cp .env.example .env
npm install
npm run dev                   # http://localhost:3001
```

Open <http://localhost:3001>, sign in with Texor and choose an industry.

```bash
cd backend && npm test        # ~280 end-to-end checks against a throwaway _test database
```

## Documentation

- [Getting started](./documentation/getting-started.md) — setup, environment, tests
- [Architecture](./documentation/architecture.md) — workspaces, access control, the metadata engine, documents
- [Industry packs](./documentation/industry-packs.md) — how a template shapes a workspace, and adding one
- [Sending](./documentation/sending.md) — Gmail, SMTP, WhatsApp, and what each needs
- [Texor SSO](./documentation/texor-sso.md) — how sign-in works here
