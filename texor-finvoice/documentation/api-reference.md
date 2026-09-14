# Finvoice API reference

Base URL in development: `http://localhost:4001`

Authentication is the `finvoice_sid` cookie, established by the Texor SSO flow.
Browser calls need `credentials: 'include'`, and the origin must be listed in
`CORS_ORIGINS`.

Errors share the ecosystem-wide shape:

```json
{ "error": { "code": "bad_request", "message": "Some fields need attention.",
             "details": [{ "field": "number", "message": "This number is already used." }] } }
```

---

## Authentication

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/auth/login?returnTo=/invoices` | Redirects to Texor. A browser navigation, not a fetch |
| `GET` | `/api/auth/callback` | Texor returns here with a code |
| `POST` | `/api/auth/logout` | `{ ok, redirectTo }` — navigate to `redirectTo` to end the Texor session too |
| `GET` | `/api/auth/me` | `{ user }` or `{ user: null }` |

---

## Invoices

All require a session. Every query is scoped to the signed-in user.

### `GET /api/invoices`

| Query | Notes |
|---|---|
| `status` | `draft` · `sent` · `paid` · `overdue` · `void` |
| `search` | Matches invoice number or client name |
| `limit` | 1–100, default 50 |

Returns `{ invoices: [...] }`, newest issue date first.

### `POST /api/invoices`

```json
{
  "number": "INV-001",
  "client": { "name": "Northwind Trading", "email": "ap@northwind.test", "address": "12 Dock Rd" },
  "lineItems": [
    { "description": "Design retainer", "quantity": 1, "unitPrice": 2400, "taxRate": 20 }
  ],
  "currency": "USD",
  "dueDate": "2026-04-30",
  "status": "draft",
  "notes": "Payable within 30 days."
}
```

`subtotal`, `taxTotal` and `total` are computed server-side and ignored if sent.
`409` if you already have an invoice with that number — numbers are unique per
user, so two customers can both have an `INV-001`.

### `GET /api/invoices/:id`
### `PATCH /api/invoices/:id`

Accepts any subset of the create body. Setting `status` to `paid` stamps
`paidAt`; setting it to anything else clears it.

### `DELETE /api/invoices/:id`

### `GET /api/summary`

```json
{ "summary": { "count": 12, "outstanding": 8400, "paid": 15200, "draft": 3 } }
```

`outstanding` is the total of `sent` and `overdue` invoices.

---

## Health

`GET /api/health` → `{ "status": "ok", "service": "finvoice" }`
